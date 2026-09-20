//! Durable, provider-native JSONL transports. Approval requests are retained
//! separately from the bounded event journal and are never auto-answered.
const std = @import("std");
const os = @import("os.zig");
const a = os.allocator;
const c = os.c;
const agents = @import("agents.zig");
pub const Event = struct { seq: u64, line: []const u8 };
pub const Session = struct {
    id: u32,
    provider: agents.Provider,
    child: std.process.Child,
    ready: bool = false,
    exited: bool = false,
    state: agents.State = .unknown,
    attention: agents.Attention = .none,
    input: std.ArrayList(u8) = .empty,
    output: std.ArrayList(u8) = .empty,
    deferred: std.ArrayList(u8) = .empty,
    events: std.ArrayList(Event) = .empty,
    approvals: std.ArrayList([]const u8) = .empty,
    active_threads: std.StringHashMapUnmanaged(void) = .empty,
    journal_bytes: usize = 0,
    next_seq: u64 = 1,
    pub fn start(id: u32, provider: agents.Provider, cwd: []const u8) !Session {
        var argv: std.ArrayList([]const u8) = .empty;
        defer argv.deinit(a);
        const bin = try @import("discovery.zig").resolve(provider, cwd);
        defer a.free(bin);
        switch (provider) {
            .codex => try argv.appendSlice(a, &.{ bin, "app-server", "--listen", "stdio://" }),
            .claude => try argv.appendSlice(a, &.{ bin, "--print", "--verbose", "--input-format", "stream-json", "--output-format", "stream-json", "--permission-prompt-tool", "stdio" }),
            .other => return error.BadProvider,
        }
        var child = std.process.Child.init(argv.items, a);
        var env = try std.process.getEnvMap(a);
        defer env.deinit();
        env.remove("WRANGLER_PANE");
        child.env_map = &env;
        child.stdin_behavior = .Pipe;
        child.stdout_behavior = .Pipe;
        child.stderr_behavior = .Inherit;
        child.cwd = cwd;
        child.pgid = 0;
        try child.spawn();
        try child.waitForSpawn();
        os.nonblock(child.stdout.?.handle);
        os.nonblock(child.stdin.?.handle);
        os.cloexec(child.stdout.?.handle);
        os.cloexec(child.stdin.?.handle);
        var result: Session = .{ .id = id, .provider = provider, .child = child, .ready = provider == .claude };
        if (provider == .codex) try result.queue(.{ .id = "__wrangler_init", .method = "initialize", .params = .{ .clientInfo = .{ .name = "wrangler", .version = "0.1.0" } } });
        return result;
    }
    pub fn destroy(s: *Session) void {
        if (!s.exited) {
            _ = c.kill(-s.child.id, c.SIGKILL);
            var status: c_int = 0;
            _ = c.waitpid(s.child.id, &status, 0);
        }
        if (s.child.stdin) |f| f.close();
        if (s.child.stdout) |f| f.close();
        for (s.events.items) |event| a.free(event.line);
        for (s.approvals.items) |line| a.free(line);
        var threads = s.active_threads.keyIterator();
        while (threads.next()) |key| a.free(key.*);
        s.active_threads.deinit(a);
        s.events.deinit(a);
        s.approvals.deinit(a);
        s.input.deinit(a);
        s.output.deinit(a);
        s.deferred.deinit(a);
    }
    fn queue(s: *Session, v: anytype) !void {
        const line = try std.json.Stringify.valueAlloc(a, v, .{});
        defer a.free(line);
        if (s.output.items.len + line.len > 1024 * 1024) return error.NativeBackpressure;
        try s.output.appendSlice(a, line);
        try s.output.append(a, '\n');
    }
    pub fn send(s: *Session, v: std.json.Value) !void {
        if (s.exited) return error.NativeExited;
        if (v != .object) return error.InvalidMessage;
        if (eq(agents.str(v, "id"), "__wrangler_init")) return error.ReservedRequestId;
        if (s.ready) try s.queue(v) else {
            const line = try std.json.Stringify.valueAlloc(a, v, .{});
            defer a.free(line);
            if (s.deferred.items.len + line.len > 1024 * 1024) return error.NativeBackpressure;
            try s.deferred.appendSlice(a, line);
            try s.deferred.append(a, '\n');
        }
        // Explicit provider responses remove only their matching pending request.
        const response_id = responseId(s.provider, v);
        if (response_id) |id| {
            var i: usize = 0;
            var removed = false;
            while (i < s.approvals.items.len) {
                const parsed = try std.json.parseFromSlice(std.json.Value, a, s.approvals.items[i], .{});
                defer parsed.deinit();
                if (requestId(s.provider, parsed.value)) |pending_id| {
                    if (std.meta.activeTag(id) == std.meta.activeTag(pending_id) and ((id == .string and eq(id.string, pending_id.string)) or (id == .integer and id.integer == pending_id.integer))) {
                        a.free(s.approvals.orderedRemove(i));
                        removed = true;
                        continue;
                    }
                }
                i += 1;
            }
            if (removed and s.approvals.items.len == 0) {
                s.attention = .none;
                s.state = .working;
            }
        }
    }
    pub fn poll(s: *Session) !bool {
        if (s.exited) return false;
        while (s.output.items.len > 0) {
            const n = c.write(s.child.stdin.?.handle, s.output.items.ptr, s.output.items.len);
            if (n <= 0) break;
            const count: usize = @intCast(n);
            std.mem.copyForwards(u8, s.output.items[0 .. s.output.items.len - count], s.output.items[count..]);
            s.output.items.len -= count;
        }
        var ding = false;
        var buf: [16384]u8 = undefined;
        for (0..8) |_| {
            const n = c.read(s.child.stdout.?.handle, &buf, buf.len);
            if (n <= 0) break;
            try s.input.appendSlice(a, buf[0..@intCast(n)]);
            if (s.input.items.len > 4 * 1024 * 1024) return error.NativeMessageTooLarge;
            var consumed: usize = 0;
            while (std.mem.indexOfScalarPos(u8, s.input.items, consumed, '\n')) |end| {
                const line = s.input.items[consumed..end];
                const parsed = std.json.parseFromSlice(std.json.Value, a, line, .{}) catch {
                    consumed = end + 1;
                    continue;
                };
                defer parsed.deinit();
                const v = parsed.value;
                if (s.provider == .codex and eq(agents.str(v, "id"), "__wrangler_init")) {
                    if (v == .object and v.object.contains("error")) return error.NativeInitializeFailed;
                    try s.queue(.{ .method = "initialized" });
                    try s.output.appendSlice(a, s.deferred.items);
                    s.deferred.clearRetainingCapacity();
                    s.ready = true;
                }
                const old = s.state;
                const method = agents.str(v, "method");
                const kind = agents.str(v, "type");
                const params = if (v == .object) v.object.get("params") orelse .null else .null;
                const thread_id = agents.str(params, "threadId");
                if (requestId(s.provider, v) != null) {
                    if (s.approvals.items.len >= 64) return error.TooManyNativeRequests;
                    try s.approvals.append(a, try a.dupe(u8, line));
                    s.state = .blocked;
                    s.attention = .needs_input;
                } else if (eq(method, "turn/started") or eq(kind, "assistant")) {
                    if (thread_id.len > 0 and !s.active_threads.contains(thread_id)) try s.active_threads.put(a, try a.dupe(u8, thread_id), {});
                    s.state = .working;
                    s.attention = .none;
                } else if (eq(method, "turn/completed") or eq(kind, "result")) {
                    if (s.active_threads.fetchRemove(thread_id)) |entry| a.free(entry.key);
                    s.state = if (s.active_threads.count() > 0) .working else .idle;
                    if (s.state == .idle) s.attention = .finished;
                }
                if (s.approvals.items.len > 0) {
                    s.state = .blocked;
                    s.attention = .needs_input;
                }
                if (s.state != old and s.attention != .none) ding = true;
                while (s.events.items.len > 0 and (s.events.items.len >= 128 or s.journal_bytes + line.len > 4 * 1024 * 1024)) {
                    const discarded = s.events.orderedRemove(0);
                    s.journal_bytes -= discarded.line.len;
                    a.free(discarded.line);
                }
                try s.events.append(a, .{ .seq = s.next_seq, .line = try a.dupe(u8, line) });
                s.journal_bytes += line.len;
                s.next_seq += 1;
                consumed = end + 1;
            }
            std.mem.copyForwards(u8, s.input.items[0 .. s.input.items.len - consumed], s.input.items[consumed..]);
            s.input.items.len -= consumed;
        }
        return ding;
    }
};
fn requestId(provider: agents.Provider, v: std.json.Value) ?std.json.Value {
    if (v != .object) return null;
    if (provider == .codex) {
        if (agents.str(v, "method").len == 0) return null;
        return v.object.get("id");
    }
    if (eq(agents.str(v, "type"), "control_request")) return v.object.get("request_id");
    return null;
}
fn responseId(provider: agents.Provider, v: std.json.Value) ?std.json.Value {
    if (provider == .codex) {
        if (!v.object.contains("result") and !v.object.contains("error")) return null;
        return v.object.get("id");
    }
    if (!eq(agents.str(v, "type"), "control_response")) return null;
    const response = v.object.get("response") orelse return null;
    return if (response == .object) response.object.get("request_id") else null;
}
fn eq(x: []const u8, y: []const u8) bool {
    return std.mem.eql(u8, x, y);
}
