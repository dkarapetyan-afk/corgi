const std = @import("std");
const terminal = @import("terminal.zig");
const vt = terminal.vt;

pub const Surface = struct {
    pane: u32,
    cols: u16,
    rows: u16,
    lines: []const []const u8,
    cursor: ?struct { x: u16, y: u16 },
};

/// Each line starts with its own style and ends with SGR reset. Coordinates,
/// cursor visibility, and all surrounding UI belong to the consuming viewer.
pub fn capture(allocator: std.mem.Allocator, id: u32, t: *terminal.Terminal) !Surface {
    try t.updateRender();
    const state = &t.render;
    const lines = try allocator.alloc([]const u8, state.rows);
    var used: usize = 0;
    errdefer {
        for (lines[0..used]) |line| allocator.free(line);
        allocator.free(lines);
    }
    for (lines, 0..) |*line, row| {
        var out: std.Io.Writer.Allocating = .init(allocator);
        defer out.deinit();
        try writeRow(&out.writer, state, row, state.cols, false);
        line.* = try out.toOwnedSlice();
        used += 1;
    }
    return .{
        .pane = id,
        .cols = state.cols,
        .rows = state.rows,
        .lines = lines,
        .cursor = if (state.cursor.visible) if (state.cursor.viewport) |pos| .{ .x = pos.x, .y = pos.y } else null else null,
    };
}

pub fn writeRow(w: *std.Io.Writer, state: *const vt.RenderState, row: usize, cols: u16, dimmed: bool) !void {
    const cells = state.row_data.items(.cells)[row];
    var last_style: ?vt.Style = null;
    var last_fg: ?vt.color.RGB = null;
    var last_bg: ?vt.color.RGB = null;
    for (cells.items(.raw), 0..) |cell, col| {
        if (col >= cols) break;
        if (cell.wide == .spacer_tail or cell.wide == .spacer_head) continue;
        const style: terminal.vt.Style = if (cell.style_id == 0) .{} else cells.items(.style)[col];
        var fg = style.fg(.{ .default = state.colors.foreground, .palette = &state.colors.palette });
        var bg = style.bg(&cell, &state.colors.palette) orelse state.colors.background;
        if (dimmed) {
            fg = dim(fg);
            bg = dim(bg);
        }
        const selected = if (state.row_data.items(.selection)[row]) |range| col >= range[0] and col <= range[1] else false;
        if (style.flags.inverse != selected) std.mem.swap(terminal.vt.color.RGB, &fg, &bg);
        if (last_style == null or !last_style.?.eql(style) or !std.meta.eql(last_fg.?, fg) or !std.meta.eql(last_bg.?, bg)) {
            try w.print("\x1b[0;38;2;{d};{d};{d};48;2;{d};{d};{d}m", .{ fg.r, fg.g, fg.b, bg.r, bg.g, bg.b });
            if (style.flags.bold) try w.writeAll("\x1b[1m");
            if (style.flags.faint) try w.writeAll("\x1b[2m");
            if (style.flags.italic) try w.writeAll("\x1b[3m");
            if (style.flags.underline != .none) try w.writeAll("\x1b[4m");
            if (style.flags.strikethrough) try w.writeAll("\x1b[9m");
            last_style = style;
            last_fg = fg;
            last_bg = bg;
        }
        const cp = cell.codepoint();
        var bytes: [4]u8 = undefined;
        const len = try std.unicode.utf8Encode(if (cp == 0 or style.flags.invisible) ' ' else cp, &bytes);
        try w.writeAll(bytes[0..len]);
        if (cell.content_tag == .codepoint_grapheme and !style.flags.invisible) for (cells.items(.grapheme)[col]) |extra| {
            const n = try std.unicode.utf8Encode(extra, &bytes);
            try w.writeAll(bytes[0..n]);
        };
    }
    try w.writeAll("\x1b[0m");
}

fn dim(color: vt.color.RGB) vt.color.RGB {
    return .{ .r = color.r / 2, .g = color.g / 2, .b = color.b / 2 };
}
