const std = @import("std");
const os = @import("os.zig");
const a = os.allocator;
const common = [_][]const u8{ "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop", "SessionEnd", "PreCompact" };
pub fn hook(provider: []const u8, path: []const u8) !void {
    const pane = os.env("WRANGLER_PANE") orelse return;
    const id = std.fmt.parseInt(u32, pane, 10) catch return;
    var input: std.ArrayList(u8) = .empty;
    defer input.deinit(a);
    var buf: [8192]u8 = undefined;
    while (input.items.len < 1024 * 1024) {
        const n = os.c.read(0, &buf, buf.len);
        if (n <= 0) break;
        try input.appendSlice(a, buf[0..@intCast(n)]);
    }
    const parsed = std.json.parseFromSlice(std.json.Value, a, input.items, .{}) catch return;
    defer parsed.deinit();
    const fd = os.connect(path) catch return;
    defer _ = os.c.close(fd);
    try os.sendJson(fd, .{ .op = "hook", .provider = provider, .pane = id, .event = parsed.value, .seq = std.time.microTimestamp() });
}
pub fn config(provider: []const u8, executable: []const u8) ![]u8 {
    const command = try hookCommand(provider, executable);
    defer a.free(command);
    var hooks: std.json.ObjectMap = .init(a);
    defer {
        var it = hooks.iterator();
        while (it.next()) |entry| {
            var groups = entry.value_ptr.array;
            var group = groups.items[0].object;
            var handlers = group.get("hooks").?.array;
            var handler = handlers.items[0].object;
            handler.deinit();
            handlers.deinit();
            group.deinit();
            groups.deinit();
        }
        hooks.deinit();
    }
    for (common) |event| try addHook(&hooks, event, command);
    if (std.mem.eql(u8, provider, "claude")) {
        try addHook(&hooks, "Notification", command);
        try addHook(&hooks, "PostToolUseFailure", command);
    } else if (std.mem.eql(u8, provider, "codex")) try addHook(&hooks, "Interrupt", command) else return error.BadProvider;
    var root: std.json.ObjectMap = .init(a);
    defer root.deinit();
    try root.put("hooks", .{ .object = hooks });
    return std.json.Stringify.valueAlloc(a, std.json.Value{ .object = root }, .{ .whitespace = .indent_2 });
}
fn addHook(hooks: *std.json.ObjectMap, event: []const u8, command: []const u8) !void {
    var handler: std.json.ObjectMap = .init(a);
    try handler.put("type", .{ .string = "command" });
    try handler.put("command", .{ .string = command });
    try handler.put("timeout", .{ .integer = 2 });
    var handlers: std.array_list.Managed(std.json.Value) = .init(a);
    try handlers.append(.{ .object = handler });
    var group: std.json.ObjectMap = .init(a);
    try group.put("hooks", .{ .array = handlers });
    var groups: std.array_list.Managed(std.json.Value) = .init(a);
    try groups.append(.{ .object = group });
    try hooks.put(event, .{ .array = groups });
}
fn hookCommand(provider: []const u8, executable: []const u8) ![]u8 {
    const quoted = try shellQuote(executable);
    defer a.free(quoted);
    return std.fmt.allocPrint(a, "{s} hook {s}", .{ quoted, provider });
}
pub fn shellQuote(text: []const u8) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    try out.append(a, '\'');
    for (text) |ch| if (ch == '\'') try out.appendSlice(a, "'\\''") else try out.append(a, ch);
    try out.append(a, '\'');
    return out.toOwnedSlice(a);
}
pub fn launch(provider: []const u8, args: []const []const u8, executable: []const u8) !noreturn {
    if (os.env("WRANGLER_PANE") == null) return error.LaunchInsideWrangler;
    var argv: std.ArrayList([]const u8) = .empty;
    const provider_kind = std.meta.stringToEnum(@import("agents.zig").Provider, provider) orelse return error.BadProvider;
    const binary = try @import("discovery.zig").resolve(provider_kind, null);
    defer a.free(binary);
    try argv.append(a, binary);
    if (std.mem.eql(u8, provider, "claude")) {
        try argv.appendSlice(a, &.{ "--settings", try config(provider, executable) });
    } else if (std.mem.eql(u8, provider, "codex")) {
        const command = try hookCommand(provider, executable);
        const quoted = try std.json.Stringify.valueAlloc(a, command, .{});
        for (common) |event| {
            const override = try std.fmt.allocPrint(a, "hooks.{s}=[{{hooks=[{{type=\"command\",command={s},timeout=2}}]}}]", .{ event, quoted });
            try argv.appendSlice(a, &.{ "-c", override });
        }
        const interrupt = try std.fmt.allocPrint(a, "hooks.Interrupt=[{{hooks=[{{type=\"command\",command={s},timeout=2}}]}}]", .{quoted});
        try argv.appendSlice(a, &.{ "-c", interrupt });
    } else return error.BadProvider;
    try argv.appendSlice(a, args);
    return os.exec(argv.items);
}
test "shell quoting protects binary paths containing shell syntax" {
    const result = try shellQuote("/tmp/a'b$(echo bad)/wrangler");
    defer a.free(result);
    try std.testing.expectEqualStrings("'/tmp/a'\\''b$(echo bad)/wrangler'", result);
}
