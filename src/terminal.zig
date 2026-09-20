const std = @import("std");
pub const vt = @import("ghostty-vt");
const os = @import("os.zig");
const c = os.c;
const a = os.allocator;
pub const Terminal = struct {
    vt: vt.Terminal,
    stream: vt.TerminalStream,
    render: vt.RenderState = .empty,
    fd: c_int = -1,
    pid: c_int = -1,
    exited: bool = false,
    exit_status: c_int = 0,
    pending: std.ArrayList(u8) = .empty,

    pub fn create(cols: u16, rows: u16) !*Terminal {
        const t = try a.create(Terminal);
        errdefer a.destroy(t);
        t.* = .{ .vt = try vt.Terminal.init(a, .{ .cols = @max(1, cols), .rows = @max(1, rows), .max_scrollback = 10_000 }), .stream = undefined };
        var handler = t.vt.vtHandler();
        handler.effects.write_pty = reply;
        handler.effects.device_attributes = attributes;
        t.stream = .initAlloc(a, handler);
        return t;
    }
    fn reply(handler: *vt.TerminalStream.Handler, bytes: [:0]const u8) void {
        const t: *Terminal = @fieldParentPtr("vt", handler.terminal);
        t.send(bytes) catch {};
    }
    const AttrCallback = @typeInfo(@FieldType(vt.TerminalStream.Handler.Effects, "device_attributes")).optional.child;
    const Attributes = @typeInfo(@typeInfo(AttrCallback).pointer.child).@"fn".return_type.?;
    fn attributes(_: *vt.TerminalStream.Handler) Attributes {
        return .{};
    }
    pub fn select(t: *Terminal, start_x: u16, start_y: u16, end_x: u16, end_y: u16) !void {
        const screen = t.vt.screens.active;
        const start = screen.pages.pin(.{ .viewport = .{ .x = @min(start_x, t.vt.cols - 1), .y = @min(start_y, t.vt.rows - 1) } }) orelse return;
        const end = screen.pages.pin(.{ .viewport = .{ .x = @min(end_x, t.vt.cols - 1), .y = @min(end_y, t.vt.rows - 1) } }) orelse return;
        try screen.select(vt.Selection.init(start, end, false));
    }
    pub fn selectedText(t: *Terminal) ![]const u8 {
        const screen = t.vt.screens.active;
        if (screen.selection) |sel| return screen.selectionString(a, .{ .sel = sel });
        return t.text();
    }
    pub fn search(t: *Terminal, needle: []const u8, skip: usize) !bool {
        if (needle.len == 0) return false;
        const screen = t.vt.screens.active;
        var finder = try vt.search.PageList.init(a, needle, &screen.pages, screen.pages.pages.last orelse return false);
        defer finder.deinit();
        var index: usize = 0;
        while (true) {
            while (finder.next()) |sel| {
                if (index == skip) {
                    try screen.select(vt.Selection.init(sel.startPin(), sel.endPin(), false));
                    const point = screen.pages.pointFromPin(.screen, sel.startPin()) orelse return false;
                    t.vt.scrollViewport(.{ .row = point.screen.y });
                    return true;
                }
                index += 1;
            }
            if (!try finder.feed()) break;
        }
        return false;
    }
    pub fn spawn(t: *Terminal, cwd: []const u8, socket: []const u8, id: u32, executable: []const u8, command: ?[]const u8) !void {
        var ws = std.mem.zeroes(c.struct_winsize);
        ws.ws_col = t.vt.cols;
        ws.ws_row = t.vt.rows;
        const pid = c.forkpty(&t.fd, null, null, &ws);
        if (pid < 0) return error.ForkFailed;
        if (pid == 0) {
            const dir = a.dupeZ(u8, cwd) catch c._exit(127);
            if (c.chdir(dir) != 0) c._exit(127);
            os.setenv("TERM", "xterm-256color") catch c._exit(127);
            os.setenv("COLORTERM", "truecolor") catch c._exit(127);
            os.setenv("WRANGLER_SOCKET", socket) catch c._exit(127);
            os.setenv("WRANGLER_BIN", executable) catch c._exit(127);
            const path = std.fmt.allocPrint(a, "{s}:{s}", .{ std.fs.path.dirname(executable) orelse ".", os.env("PATH") orelse "/usr/bin:/bin" }) catch c._exit(127);
            os.setenv("PATH", path) catch c._exit(127);
            const pane = std.fmt.allocPrint(a, "{d}", .{id}) catch c._exit(127);
            os.setenv("WRANGLER_PANE", pane) catch c._exit(127);
            const shell = os.env("SHELL") orelse "/bin/sh";
            if (command) |cmd| os.exec(&.{ shell, "-lc", cmd }) catch c._exit(127) else os.exec(&.{ shell, "-l" }) catch c._exit(127);
        }
        t.pid = pid;
        os.nonblock(t.fd);
        os.cloexec(t.fd);
    }
    // Release the process/PTY while retaining the Ghostty screen and scrollback.
    pub fn stop(t: *Terminal) void {
        if (t.fd >= 0) _ = c.close(t.fd);
        if (t.pid > 0 and !t.exited) {
            _ = c.kill(-t.pid, c.SIGHUP);
            _ = c.kill(t.pid, c.SIGHUP);
        }
        t.fd = -1;
        t.pid = -1;
        t.exited = true;
        t.pending.clearRetainingCapacity();
    }
    pub fn destroy(t: *Terminal) void {
        t.stop();
        t.pending.deinit(a);
        t.stream.deinit();
        t.render.deinit(a);
        t.vt.deinit(a);
        a.destroy(t);
    }
    // Replay content into a fresh terminal, without restoring input modes or
    // parser state left behind by the old process (e.g. mouse/alternate screen).
    pub fn snapshot(t: *Terminal) ![]u8 {
        var out: std.Io.Writer.Allocating = .init(a);
        defer out.deinit();
        if (t.vt.screens.active_key == .alternate) {
            const primary: vt.formatter.ScreenFormatter = .init(t.vt.screens.get(.primary).?, .{ .emit = .vt, .unwrap = true });
            try primary.format(&out.writer);
            try out.writer.writeAll("\x1b[0m\r\n");
        }
        const formatter: vt.formatter.ScreenFormatter = .init(t.vt.screens.active, .{ .emit = .vt, .unwrap = true });
        try formatter.format(&out.writer);
        return out.toOwnedSlice();
    }
    pub fn resize(t: *Terminal, cols: u16, rows: u16) !void {
        const w = @max(1, cols);
        const h = @max(1, rows);
        if (t.vt.cols == w and t.vt.rows == h) return;
        try t.vt.resize(a, w, h);
        var ws = std.mem.zeroes(c.struct_winsize);
        ws.ws_col = w;
        ws.ws_row = h;
        if (t.fd >= 0) _ = c.ioctl(t.fd, c.TIOCSWINSZ, &ws);
    }
    pub fn feed(t: *Terminal, bytes: []const u8) void {
        t.stream.nextSlice(bytes);
    }
    pub fn send(t: *Terminal, bytes: []const u8) !void {
        if (t.pending.items.len + bytes.len > 1024 * 1024) return error.InputBackpressure;
        try t.pending.appendSlice(a, bytes);
        t.flush();
    }
    pub fn flush(t: *Terminal) void {
        while (t.pending.items.len > 0 and t.fd >= 0) {
            const n = c.write(t.fd, t.pending.items.ptr, t.pending.items.len);
            if (n <= 0) break;
            const used: usize = @intCast(n);
            std.mem.copyForwards(u8, t.pending.items[0 .. t.pending.items.len - used], t.pending.items[used..]);
            t.pending.items.len -= used;
        }
    }
    pub fn read(t: *Terminal) bool {
        var bytes: [16384]u8 = undefined;
        var dirty = false;
        // Bound each pane's slice so a noisy process can't starve hooks or input.
        for (0..8) |_| {
            const n = c.read(t.fd, &bytes, bytes.len);
            if (n <= 0) break;
            t.feed(bytes[0..@intCast(n)]);
            dirty = true;
        }
        if (!t.exited) {
            var status: c_int = 0;
            if (c.waitpid(t.pid, &status, c.WNOHANG) == t.pid) {
                t.exited = true;
                t.exit_status = status;
                dirty = true;
            }
        }
        return dirty;
    }
    pub fn text(t: *Terminal) ![]u8 {
        try t.render.update(a, &t.vt);
        var out: std.ArrayList(u8) = .empty;
        errdefer out.deinit(a);
        for (t.render.row_data.items(.cells)) |cells| {
            for (cells.items(.raw), 0..) |cell, i| {
                if (cell.wide == .spacer_tail or cell.wide == .spacer_head) continue;
                var buf: [4]u8 = undefined;
                const cp = cell.codepoint();
                const len = try std.unicode.utf8Encode(if (cp == 0) ' ' else cp, &buf);
                try out.appendSlice(a, buf[0..len]);
                if (cell.content_tag == .codepoint_grapheme) for (cells.items(.grapheme)[i]) |extra| {
                    const n = try std.unicode.utf8Encode(extra, &buf);
                    try out.appendSlice(a, buf[0..n]);
                };
            }
            try out.append(a, '\n');
        }
        return out.toOwnedSlice(a);
    }
};
test "Ghostty keeps fragmented escapes, unicode, alternate screen and resize" {
    const t = try Terminal.create(20, 4);
    defer t.destroy();
    t.feed("hello\x1b[");
    t.feed("2;1Hworld");
    const before = try t.text();
    defer a.free(before);
    try std.testing.expect(std.mem.indexOf(u8, before, "hello") != null);
    try std.testing.expect(std.mem.indexOf(u8, before, "world") != null);
    t.feed("\x1b[?1049halt\x1b[?1049l");
    try t.resize(30, 5);
    const after = try t.text();
    defer a.free(after);
    try std.testing.expect(std.mem.indexOf(u8, after, "hello") != null);
}

test "snapshot restores primary history and alternate output without input modes" {
    const old = try Terminal.create(30, 4);
    defer old.destroy();
    old.feed("EARLY_HISTORY\r\n1\r\n2\r\n3\r\n4\r\n5\r\n");
    old.feed("\x1b[?1049h\x1b[?1000h\x1b[?2004h\x1b[31mALT_OUTPUT\x1b[");
    old.stop();
    const saved = try old.snapshot();
    defer a.free(saved);
    const fresh = try Terminal.create(30, 4);
    defer fresh.destroy();
    fresh.feed(saved);
    fresh.feed("\x1b[0m\r\nNEW_SHELL");
    try std.testing.expectEqual(.primary, fresh.vt.screens.active_key);
    try std.testing.expectEqual(.none, fresh.vt.flags.mouse_event);
    try std.testing.expect(!fresh.vt.modes.get(.bracketed_paste));
    try std.testing.expect(try fresh.search("EARLY_HISTORY", 0));
    try std.testing.expect(try fresh.search("ALT_OUTPUT", 0));
    try std.testing.expect(try fresh.search("NEW_SHELL", 0));
}
