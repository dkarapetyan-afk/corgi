const std = @import("std");
const os = @import("os.zig");
const c = os.c;
const a = os.allocator;
const keyboard = @import("keyboard.zig");
const agents = @import("agents.zig");
var keyboard_enabled = false;
var restore: ?c.struct_termios = null;
fn cleanup() void {
    if (restore) |*term| {
        _ = c.tcsetattr(0, c.TCSAFLUSH, term);
        if (keyboard_enabled) {
            os.writeAll(1, keyboard.disable) catch {};
            keyboard_enabled = false;
        }
        os.writeAll(1, "\x1b[?2026l\x1b[0m\x1b[?25h\x1b[?1002l\x1b[?1006l\x1b[?1004l\x1b[?2004l\x1b[?1049l") catch {};
        restore = null;
    }
}
fn signalHandler(_: c_int) callconv(.c) void {
    cleanup();
    c._exit(0);
}
pub fn attach(path: []const u8) !void {
    if (c.isatty(0) == 0 or c.isatty(1) == 0) return error.TerminalRequired;
    const fd = try os.connect(path);
    defer _ = c.close(fd);
    var original: c.struct_termios = undefined;
    if (c.tcgetattr(0, &original) != 0) return error.TerminalRequired;
    restore = original;
    defer cleanup();
    _ = c.signal(c.SIGTERM, signalHandler);
    _ = c.signal(c.SIGHUP, signalHandler);
    _ = c.signal(c.SIGPIPE, os.sig_ignore);
    var raw = original;
    c.cfmakeraw(&raw);
    if (c.tcsetattr(0, c.TCSAFLUSH, &raw) != 0) return error.TerminalRequired;
    var input: std.ArrayList(u8) = .empty;
    defer input.deinit(a);
    var probe: @import("theme.zig").Probe = .{};
    try probe.query(&input);
    try os.writeAll(1, "\x1b[?1049h\x1b[?1002h\x1b[?1006h\x1b[?1004h\x1b[?2004h" ++ keyboard.enable);
    keyboard_enabled = true;
    var size = dimensions();
    const cwd = try std.process.getCwdAlloc(a);
    defer a.free(cwd);
    try os.sendJson(fd, .{ .op = "attach", .cols = size.ws_col, .rows = size.ws_row, .cwd = cwd, .theme = probe.theme });
    var pending: std.ArrayList(u8) = .empty;
    defer pending.deinit(a);
    while (true) {
        try probe.expire(&input);
        if (probe.changed) {
            try os.sendJson(fd, .{ .op = "theme", .theme = probe.theme });
            probe.changed = false;
        }
        var input_end = input.items.len;
        while (input_end > 0 and !std.unicode.utf8ValidateSlice(input.items[0..input_end])) : (input_end -= 1) {}
        if (input_end > 0) {
            try os.sendJson(fd, .{ .op = "input", .data = input.items[0..input_end] });
            std.mem.copyForwards(u8, input.items[0 .. input.items.len - input_end], input.items[input_end..]);
            input.items.len -= input_end;
        }
        if (input.items.len > 4) input.clearRetainingCapacity();
        const current = dimensions();
        if (current.ws_col != size.ws_col or current.ws_row != size.ws_row) {
            size = current;
            try os.sendJson(fd, .{ .op = "size", .cols = size.ws_col, .rows = size.ws_row });
        }
        var polls = [_]c.struct_pollfd{
            .{ .fd = 0, .events = c.POLLIN, .revents = 0 },
            .{ .fd = fd, .events = c.POLLIN, .revents = 0 },
        };
        _ = c.poll(&polls, 2, 100);
        if (polls[0].revents & c.POLLIN != 0) {
            var buf: [8192]u8 = undefined;
            const n = c.read(0, &buf, buf.len);
            if (n <= 0) return;
            try probe.feed(buf[0..@intCast(n)], &input);
        }
        if (polls[1].revents & (c.POLLIN | c.POLLHUP | c.POLLERR) != 0) {
            var buf: [65536]u8 = undefined;
            const n = c.read(fd, &buf, buf.len);
            if (n <= 0) return;
            try pending.appendSlice(a, buf[0..@intCast(n)]);
            if (pending.items.len > 8 * 1024 * 1024) return error.FrameTooLarge;
            var consumed: usize = 0;
            while (std.mem.indexOfScalarPos(u8, pending.items, consumed, '\n')) |end| {
                const parsed = try std.json.parseFromSlice(std.json.Value, a, pending.items[consumed..end], .{});
                defer parsed.deinit();
                const v = parsed.value;
                const kind = agents.str(v, "type");
                if (std.mem.eql(u8, kind, "frame")) try os.writeAll(1, agents.str(v, "data"));
                if (std.mem.eql(u8, kind, "detach")) return;
                if (std.mem.eql(u8, kind, "bell")) try @import("sound.zig").play(agents.str(v, "kind"));
                const err = agents.str(v, "err");
                if (err.len > 0) {
                    cleanup();
                    std.debug.print("corgi: {s}\n", .{err});
                    return error.ServerRejected;
                }
                consumed = end + 1;
            }
            std.mem.copyForwards(u8, pending.items[0 .. pending.items.len - consumed], pending.items[consumed..]);
            pending.items.len -= consumed;
        }
    }
}
fn dimensions() c.struct_winsize {
    var size = std.mem.zeroes(c.struct_winsize);
    _ = c.ioctl(0, c.TIOCGWINSZ, &size);
    if (size.ws_col == 0) size.ws_col = 100;
    if (size.ws_row == 0) size.ws_row = 30;
    return size;
}
