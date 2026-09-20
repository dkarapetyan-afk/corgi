const std = @import("std");
const agents = @import("agents.zig");
const layout = @import("layout.zig");

pub const max_entries = layout.max_panes + 16;
pub const Target = union(enum) { pane: u32, native: u32 };
pub const Entry = struct {
    target: Target,
    provider: agents.Provider,
    state: agents.State,
    attention: agents.Attention,
    focused: bool = false,
    ready: bool = true,
    title: [80]u8 = .{0} ** 80,
    title_len: usize = 0,
    activity: []const u8 = "",

    pub fn setTitle(e: *Entry, title: []const u8) void {
        e.title_len = agents.clean(&e.title, title);
    }
    pub fn status(e: Entry) []const u8 {
        if (e.state == .done) return "ended";
        if (e.state == .blocked or e.attention == .needs_input) return "needs you";
        if (e.attention == .finished) return "finished";
        return switch (e.state) {
            .unknown => if (e.ready) "ready" else "starting",
            .idle => "idle",
            .working => "working",
            .blocked => unreachable,
            .done => unreachable,
        };
    }
    fn detail(e: Entry) []const u8 {
        if (e.state == .done) return "Session ended";
        if (e.state == .unknown) return if (e.ready) "Ready for a request" else "Connecting...";
        if (e.state == .idle) return if (e.attention == .finished) "Turn finished" else "Ready for a prompt";
        if (std.mem.eql(u8, e.activity, "PermissionRequest")) return "Permission requested";
        if (std.mem.eql(u8, e.activity, "Notification")) return "Input requested";
        if (std.mem.eql(u8, e.activity, "PreCompact")) return "Compacting context";
        if (std.mem.eql(u8, e.activity, "UserPromptSubmit") or e.activity.len == 0) return if (e.state == .blocked) "Input requested" else "Thinking...";
        return e.activity;
    }
};

pub const Hit = union(enum) { none, toggle, previous, next, entry: usize };
pub const View = struct {
    cols: u16,
    rows: u16,
    width: u16,
    count: usize,
    offset: usize,
    capacity: usize,

    pub fn widthFor(cols: u16, open: bool) u16 {
        return if (open and cols >= 64) 28 else 0;
    }
    pub fn init(cols: u16, rows: u16, open: bool, offset: usize, count: usize) View {
        const capacity = @max(1, (rows -| 4) / 3);
        return .{ .cols = cols, .rows = rows, .width = if (rows >= 7) widthFor(cols, open) else 0, .count = count, .capacity = capacity, .offset = @min(offset, count -| capacity) };
    }
    pub fn area(v: View) layout.Rect {
        return .{ .x = v.width, .y = 1, .w = v.cols - v.width, .h = v.rows -| 2 };
    }
    pub fn tabX(v: View) u16 {
        return if (v.width > 0) v.width else if (v.cols >= 64) 3 else 0;
    }
    pub fn hit(v: View, x: u16, y: u16) Hit {
        if (v.width == 0) return if (v.cols >= 64 and x < 3 and y == 0) .toggle else .none;
        if (x >= v.width - 1 or y >= v.rows - 1) return .none;
        if (y == 0 and x >= v.width - 5) return .toggle;
        if (y == v.rows - 2 and v.count > v.capacity) return if (x < v.width / 2) .previous else .next;
        if (y < 2 or y >= v.rows - 2) return .none;
        const index = (y - 2) / 3;
        if (index >= v.capacity or v.offset + index >= v.count) return .none;
        return .{ .entry = v.offset + index };
    }
    pub fn draw(v: View, w: *std.Io.Writer, entries: []const Entry) !void {
        const panel = "\x1b[0;38;2;155;163;175;48;2;24;27;32m";
        if (v.width == 0) {
            if (v.cols >= 64) try w.writeAll("\x1b[1;1H\x1b[1;38;2;161;194;178m > \x1b[0m");
            return;
        }
        for (0..v.rows - 1) |row| {
            try w.print("\x1b[{d};1H{s}", .{ row + 1, panel });
            try w.splatByteAll(' ', v.width - 1);
            try w.writeAll("\x1b[38;2;55;61;70m│");
        }
        try v.line(w, 0, "agents", "\x1b[1;38;2;226;230;233m");
        try w.print("\x1b[1;{d}H{s} < ", .{ v.width - 4, panel });
        if (entries.len == 0) {
            try v.line(w, 2, "No agents yet", panel);
            try v.line(w, 4, "Launch inside a pane:", panel);
            try v.line(w, 5, "wrangler agent codex", panel);
            try v.line(w, 6, "wrangler agent claude", panel);
        }
        for (entries[v.offset..@min(entries.len, v.offset + v.capacity)], 0..) |e, index| {
            const y: u16 = @intCast(2 + index * 3);
            const bg = if (e.focused) "\x1b[48;2;35;40;47m" else "\x1b[48;2;24;27;32m";
            for (0..3) |row| {
                if (y + row >= v.rows - 2) break;
                try w.print("\x1b[{d};1H\x1b[0m{s}", .{ y + row + 1, bg });
                try w.splatByteAll(' ', v.width - 1);
            }
            const color = if (e.state == .blocked or e.attention == .needs_input) "\x1b[1;38;2;243;189;113m" else if (e.attention == .finished) "\x1b[1;38;2;166;218;149m" else "\x1b[1;38;2;161;194;178m";
            var text: [128]u8 = undefined;
            const heading = try std.fmt.bufPrint(&text, "{s}  {s}", .{ @tagName(e.provider), e.status() });
            try v.line(w, y, heading, color);
            try v.line(w, y + 1, e.title[0..e.title_len], "\x1b[22;38;2;226;230;233m");
            try v.line(w, y + 2, e.detail(), "\x1b[22;38;2;125;132;143m");
        }
        if (v.count > v.capacity) {
            var text: [64]u8 = undefined;
            const footer = try std.fmt.bufPrint(&text, "< {d}-{d}/{d} >", .{ v.offset + 1, @min(v.count, v.offset + v.capacity), v.count });
            try v.line(w, v.rows - 2, footer, panel);
        }
        try w.writeAll("\x1b[0m");
    }
    fn line(v: View, w: *std.Io.Writer, y: u16, text: []const u8, style: []const u8) !void {
        if (y >= v.rows - 1) return;
        try w.print("\x1b[{d};2H{s}", .{ y + 1, style });
        try w.writeAll(text[0..@min(text.len, v.width - 3)]);
    }
};
