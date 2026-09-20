const std = @import("std");

pub const Target = union(enum) { rename: u32, create: []const u8 }; // The server owns create's cwd.
pub const Result = enum { none, save, cancel };
pub const Hit = union(enum) { none, save, clear, cancel, field: usize };
pub const Dialog = struct {
    target: Target,
    text: [80]u8 = .{0} ** 80,
    len: usize = 0,
    cursor: usize = 0,
    selected: bool = true,
    failed: bool = false,

    pub fn init(target: Target, initial: []const u8) Dialog {
        var d: Dialog = .{ .target = target };
        d.len = @min(initial.len, d.text.len);
        for (initial[0..d.len], 0..) |ch, i| d.text[i] = if (ch >= 32 and ch < 127) ch else '_';
        d.cursor = d.len;
        return d;
    }
    pub fn name(d: *const Dialog) []const u8 {
        return std.mem.trim(u8, d.text[0..d.len], " ");
    }
    pub fn clear(d: *Dialog) void {
        d.len = 0;
        d.cursor = 0;
        d.selected = false;
        d.failed = false;
    }
    pub fn typeByte(d: *Dialog, byte: u8) void {
        if (byte < 32 or byte >= 127) return;
        if (d.selected) d.clear();
        if (d.len == d.text.len) return;
        std.mem.copyBackwards(u8, d.text[d.cursor + 1 .. d.len + 1], d.text[d.cursor..d.len]);
        d.text[d.cursor] = byte;
        d.len += 1;
        d.cursor += 1;
        d.failed = false;
    }
    pub fn key(d: *Dialog, byte: u8) Result {
        switch (byte) {
            27 => return .cancel,
            13 => return .save,
            3, 21 => d.clear(),
            1 => d.position(0),
            5 => d.position(d.len),
            8, 127 => {
                if (d.selected) d.clear() else if (d.cursor > 0) {
                    std.mem.copyForwards(u8, d.text[d.cursor - 1 .. d.len - 1], d.text[d.cursor..d.len]);
                    d.cursor -= 1;
                    d.len -= 1;
                }
            },
            else => d.typeByte(byte),
        }
        return .none;
    }
    pub fn position(d: *Dialog, cursor: usize) void {
        d.cursor = @min(cursor, d.len);
        d.selected = false;
    }
    pub fn sequence(d: *Dialog, seq: []const u8) void {
        if (eq(seq, "\x1b[D") or eq(seq, "\x1bOD")) d.position(if (d.selected) 0 else d.cursor -| 1) else if (eq(seq, "\x1b[C") or eq(seq, "\x1bOC")) d.position(if (d.selected) d.len else d.cursor + 1) else if (eq(seq, "\x1b[H") or eq(seq, "\x1bOH") or eq(seq, "\x1b[1~")) d.position(0) else if (eq(seq, "\x1b[F") or eq(seq, "\x1bOF") or eq(seq, "\x1b[4~")) d.position(d.len) else if (eq(seq, "\x1b[3~")) {
            if (d.selected) d.clear() else if (d.cursor < d.len) {
                std.mem.copyForwards(u8, d.text[d.cursor .. d.len - 1], d.text[d.cursor + 1 .. d.len]);
                d.len -= 1;
            }
        }
    }
};

pub const View = struct {
    x: u16,
    y: u16,
    width: u16,
    height: u16,
    title_y: u16,
    field_y: u16,
    buttons_y: u16,
    offset: usize,
    const Button = struct { x: u16, width: u16, label: []const u8, padded: bool };
    pub fn init(width: u16, height: u16, d: Dialog) View {
        const w = @min(width, @max(10, @max(@min(width -| 2, 36), @min(width * 3 / 5, 70))));
        const h = @min(height, 7);
        const y = (height - h) / 2;
        const field_y = y + @as(u16, if (h >= 7) 3 else if (h >= 5) 2 else 1);
        return .{ .x = (width - w) / 2, .y = y, .width = w, .height = h, .title_y = y + @as(u16, if (h >= 5) 1 else 0), .field_y = field_y, .buttons_y = field_y + 1, .offset = d.cursor -| (w - 3) };
    }
    fn buttons(v: View) [3]Button {
        const inner = v.width - 2;
        const full = inner >= 32;
        const compact = inner >= 23;
        const labels: [3][]const u8 = if (full) .{ "↵ save", "^C clear", "esc cancel" } else if (compact) .{ "save", "clear", "cancel" } else .{ "↵", "^C", "esc" };
        const widths: [3]u16 = if (full) .{ 8, 10, 12 } else if (compact) .{ 6, 7, 8 } else .{ 1, 2, 3 };
        var x = v.x + 1 + (inner - widths[0] - widths[1] - widths[2] - 2) / 2;
        var result: [3]Button = undefined;
        for (labels, widths, 0..) |label, w, i| {
            result[i] = .{ .x = x, .width = w, .label = label, .padded = full or compact };
            x += w + 1;
        }
        return result;
    }
    pub fn hit(v: View, x: u16, y: u16) Hit {
        if (x < v.x or x >= v.x + v.width or y < v.y or y >= v.y + v.height) return .cancel;
        if (y == v.field_y and x > v.x and x < v.x + v.width - 1) return .{ .field = v.offset + x - v.x - 1 };
        if (y == v.buttons_y) for (v.buttons(), 0..) |b, i| {
            if (x >= b.x and x < b.x + b.width) return switch (i) {
                0 => .save,
                1 => .clear,
                else => .cancel,
            };
        };
        return .none;
    }
    pub fn draw(v: View, d: Dialog, w: *std.Io.Writer, number: usize) !void {
        const panel = "\x1b[0;38;2;205;214;244;48;2;24;24;37m";
        const border = "\x1b[0;38;2;137;180;250;48;2;24;24;37m";
        for (0..v.height) |row| {
            try w.print("\x1b[{d};{d}H{s}", .{ v.y + row + 1, v.x + 1, border });
            if (row == 0 or row + 1 == v.height) {
                try w.writeAll(if (row == 0) "┌" else "└");
                for (0..v.width - 2) |_| try w.writeAll("─");
                try w.writeAll(if (row == 0) "┐" else "┘");
            } else {
                try w.writeAll("│");
                try w.writeAll(panel);
                try w.splatByteAll(' ', v.width - 2);
                try w.writeAll(border);
                try w.writeAll("│");
            }
        }
        const title = if (d.target == .create) "new tab" else "rename tab";
        try w.print("\x1b[{d};{d}H{s}\x1b[1m{s}", .{ v.title_y + 1, v.x + 2, panel, title[0..@min(title.len, v.width - 2)] });
        if (d.failed and v.height >= 7) {
            const msg = "Could not save. Check the directory or tab limit.";
            try w.print("\x1b[{d};{d}H{s}\x1b[38;2;243;139;168m{s}", .{ v.title_y + 2, v.x + 2, panel, msg[0..@min(msg.len, v.width - 2)] });
        }
        try w.print("\x1b[{d};{d}H\x1b[0;38;2;205;214;244;48;2;49;50;68m", .{ v.field_y + 1, v.x + 2 });
        try w.splatByteAll(' ', v.width - 2);
        try w.print("\x1b[{d};{d}H", .{ v.field_y + 1, v.x + 2 });
        if (d.len == 0) {
            // This is a preview of the current position, never an editable/saved name.
            try w.print("\x1b[38;2;125;132;143m{d}", .{number});
        } else {
            if (d.selected) try w.writeAll("\x1b[38;2;24;27;32;48;2;137;180;250m");
            const end = @min(d.len, v.offset + v.width - 2);
            try w.writeAll(d.text[v.offset..end]);
        }
        for (v.buttons(), 0..) |b, i| {
            try w.print("\x1b[{d};{d}H{s}", .{ v.buttons_y + 1, b.x + 1, if (i == 0) "\x1b[1;38;2;24;27;32;48;2;137;180;250m" else "\x1b[1;38;2;205;214;244;48;2;49;50;68m" });
            if (b.padded) try w.writeByte(' ');
            try w.writeAll(b.label);
            if (b.padded) try w.writeByte(' ');
        }
        try w.print("\x1b[0m\x1b[{d};{d}H\x1b[?25h", .{ v.field_y + 1, v.x + 2 + d.cursor - v.offset });
    }
};
fn eq(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}

test "name editing supports selection, insertion, cursor movement and clear" {
    var d = Dialog.init(.{ .rename = 1 }, "original");
    _ = d.key('a');
    _ = d.key('c');
    d.sequence("\x1b[D");
    _ = d.key('b');
    try std.testing.expectEqualStrings("abc", d.name());
    d.sequence("\x1b[3~");
    try std.testing.expectEqualStrings("ab", d.name());
    _ = d.key(127);
    try std.testing.expectEqualStrings("a", d.name());
    _ = d.key(3);
    try std.testing.expectEqual(@as(usize, 0), d.len);
    try std.testing.expectEqualStrings("", d.name());
}
