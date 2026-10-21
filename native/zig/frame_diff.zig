//! The host terminal's screen as the viewer last left it. A frame that changes
//! only cells is written as the runs that differ. Kitty commands that leave
//! the cursor in place travel separately; other controls keep the full-frame fallback.
const std = @import("std");
const vt = @import("ghostty-vt");
const os = @import("os.zig");
const a = os.allocator;

pub const Differ = struct {
    vt: vt.Terminal,
    stream: vt.TerminalStream,
    render: vt.RenderState = .empty,
    cols: u16,
    rows: u16,
    /// One hash per cell, as the host shows it.
    cells: []u64,
    next: []u64,
    /// The frame's non-cell sequences, which must match to send only cells.
    controls: u64 = 0,
    images: u64 = 0,
    images_stale: bool = false,
    has_images: bool = false,
    image_fallback: bool = false,
    cursor: Cursor = .{},
    /// The host shows something else: the next frame goes whole.
    stale: bool = true,

    const Cursor = struct { x: u16 = 0, y: u16 = 0, visible: bool = false };

    pub fn create(cols: u16, rows: u16) !*Differ {
        const d = try a.create(Differ);
        errdefer a.destroy(d);
        const count = @as(usize, cols) * rows;
        const cells = try a.alloc(u64, count);
        errdefer a.free(cells);
        const next = try a.alloc(u64, count);
        errdefer a.free(next);
        d.* = .{
            .vt = try vt.Terminal.init(os.io(), a, .{ .cols = cols, .rows = rows, .max_scrollback_bytes = 0 }),
            .stream = undefined,
            .cols = cols,
            .rows = rows,
            .cells = cells,
            .next = next,
        };
        d.stream = .init(.{ .handler = d.vt.vtHandler(), .allocator = a });
        return d;
    }
    pub fn destroy(d: *Differ) void {
        d.stream.deinit();
        d.render.deinit(a);
        d.vt.deinit(a);
        a.free(d.cells);
        a.free(d.next);
        a.destroy(d);
    }

    /// What to write so the host shows `frame`, which starts from a clear
    /// screen. Empty when the host already shows it.
    pub fn diff(d: *Differ, out: *std.Io.Writer, frame: []const u8) !void {
        var hasher = std.hash.Wyhash.init(0);
        var images: std.Io.Writer.Allocating = .init(a);
        defer images.deinit();
        var image_fallback = false;
        var chunks = false;
        var resets_images = std.mem.indexOfAny(u8, frame, "\n\x0b\x0c") != null;
        var start: usize = 0;
        var i: usize = 0;
        while (std.mem.indexOfScalarPos(u8, frame, i, 0x1b)) |at| {
            const sequence = scan(frame[at..]);
            i = at + sequence.len;
            if (sequence.kind == .cells) continue;
            d.stream.nextSlice(frame[start..at]);
            if (sequence.kind == .image) {
                if (!imageCommand(frame[at..i], &chunks)) image_fallback = true;
                // Placements and cursor-relative deletes use the cursor at
                // this point in the original frame, including save/restore.
                const cursor = d.vt.screens.active.cursor;
                try images.writer.print("\x1b[{d};{d}H", .{ cursor.y + 1, cursor.x + 1 });
                try images.writer.writeAll(frame[at..i]);
            } else {
                if (sequence.kind == .reset) resets_images = true;
                hasher.update(frame[at..i]);
                d.stream.nextSlice(frame[at..i]);
            }
            start = i;
        }
        d.stream.nextSlice(frame[start..]);
        const controls = hasher.final();
        const image_bytes = images.written();
        const image_hash = std.hash.Wyhash.hash(0, image_bytes);
        // Never split an upload across independently replaceable frames, or
        // move graphics past a clear that removes their placements or data.
        image_fallback = image_fallback or chunks or
            (resets_images and (image_bytes.len > 0 or d.has_images));
        try d.render.update(a, &d.vt);
        d.hashCells(d.next);
        const screen = d.vt.screens.active;
        const cursor: Cursor = .{ .x = @intCast(screen.cursor.x), .y = @intCast(screen.cursor.y), .visible = d.vt.modes.get(.cursor_visible) };
        defer {
            std.mem.swap([]u64, &d.cells, &d.next);
            d.controls = controls;
            d.images = image_hash;
            d.images_stale = false;
            d.has_images = image_bytes.len > 0;
            d.image_fallback = image_fallback;
            d.cursor = cursor;
            d.stale = false;
        }
        if (d.stale or controls != d.controls or image_fallback or d.image_fallback) return out.writeAll(frame);
        const changed = !std.mem.eql(u64, d.cells, d.next);
        const images_changed = d.images_stale or image_hash != d.images;
        if (!changed and !images_changed and std.meta.eql(cursor, d.cursor)) return;
        try out.writeAll("\x1b[?2026h\x1b[?25l");
        var paint: Paint = .{};
        if (changed) for (0..d.rows) |row| {
            const line = row * d.cols;
            const old = d.cells[line..][0..d.cols];
            const new = d.next[line..][0..d.cols];
            var first = std.mem.indexOfDiff(u64, old, new) orelse continue;
            const raw = d.render.row_data.items(.cells)[row].items(.raw);
            while (first > 0 and raw[first].wide == .spacer_tail) first -= 1;
            try out.print("\x1b[{d};{d}H", .{ row + 1, first + 1 });
            while (first < d.cols) {
                var end = first + 1;
                while (end < d.cols and (old[end] != new[end] or raw[end].wide == .spacer_tail)) end += 1;
                try d.writeCells(out, &paint, row, first, end);
                var next = end;
                while (next < d.cols and old[next] == new[next]) next += 1;
                if (next == d.cols) break;
                while (next > end and raw[next].wide == .spacer_tail) next -= 1;
                if (d.bridgeGap(paint, row, end, next)) {
                    try d.writeCells(out, &paint, row, end, next);
                } else try out.print("\x1b[{d};{d}H", .{ row + 1, next + 1 });
                first = next;
            }
        };
        if (paint.open != null) try out.writeAll("\x1b]8;;\x1b\\");
        if (paint.style != null) try out.writeAll("\x1b[0m");
        // Replay the image batch in order: a delete may invalidate a later
        // placement, and a transmission's continuation chunks belong together.
        if (images_changed) try out.writeAll(image_bytes);
        try out.print("\x1b[{d};{d}H", .{ cursor.y + 1, cursor.x + 1 });
        if (cursor.visible) try out.writeAll("\x1b[?25h");
        try out.writeAll("\x1b[?2026l");
    }

    fn hashCells(d: *Differ, into: []u64) void {
        @memset(into, 0);
        const pins = d.render.row_data.items(.pin);
        for (d.render.row_data.items(.cells)[0..@min(d.rows, d.render.rows)], 0..) |cells, row| {
            const raw = cells.items(.raw);
            for (raw[0..@min(d.cols, raw.len)], 0..) |cell, col| {
                var h = std.hash.Wyhash.init(0);
                var content = cell;
                content.style_id = 0;
                content.hyperlink = false;
                content.semantic_content = .output;
                h.update(std.mem.asBytes(&@as(u64, @bitCast(content))));
                if (cell.style_id != 0) hashStyle(&h, cells.items(.style)[col]);
                if (cell.content_tag == .codepoint_grapheme) h.update(std.mem.sliceAsBytes(cells.items(.grapheme)[col]));
                if (cell.hyperlink) if (link(pins[row], col)) |target| {
                    h.update(target.uri);
                    h.update(target.id orelse "");
                };
                into[row * d.cols + col] = h.final();
            }
        }
    }

    const Paint = struct { style: ?vt.Style = null, open: ?Link = null };

    // Only short gaps can beat a cursor move. Compare the actual bytes,
    // including the next cell's style/link transition, in bounded stack space.
    fn bridgeGap(d: *Differ, paint: Paint, row: usize, from: usize, to: usize) bool {
        const move_bytes = 4 + digits(row + 1) + digits(to + 1);
        if (to - from > move_bytes) return false;
        const cells = d.render.row_data.items(.cells)[row];
        const raw = cells.items(.raw);
        // A uniform gap leaves the next cell's style transition unchanged.
        // Count its UTF-8 bytes directly instead of formatting it twice.
        if (paint.open == null) if (paint.style) |style| {
            var bytes: usize = 0;
            var col = from;
            while (col < to) : (col += 1) {
                const cell = raw[col];
                if (cell.wide == .spacer_tail) continue;
                if (cell.hyperlink or !style.eql(cellStyle(cells, col))) break;
                bytes += if (cell.wide == .spacer_head or cell.codepoint() == 0)
                    1
                else
                    std.unicode.utf8CodepointSequenceLength(cell.codepoint()) catch 1;
                if (cell.content_tag == .codepoint_grapheme) for (cells.items(.grapheme)[col]) |extra| {
                    bytes += std.unicode.utf8CodepointSequenceLength(extra) catch 1;
                };
                if (bytes > move_bytes) return false;
            }
            if (col == to) return true;
        };
        var across_bytes: [256]u8 = undefined;
        var jump_bytes: [256]u8 = undefined;
        var across: std.Io.Writer = .fixed(&across_bytes);
        var jump: std.Io.Writer = .fixed(&jump_bytes);
        var across_paint = paint;
        var jump_paint = paint;
        d.writeCells(&across, &across_paint, row, from, to + 1) catch return false;
        jump.print("\x1b[{d};{d}H", .{ row + 1, to + 1 }) catch return false;
        d.writeCells(&jump, &jump_paint, row, to, to + 1) catch return false;
        return across.end <= jump.end;
    }

    fn cellStyle(cells: anytype, col: usize) vt.Style {
        const cell = cells.items(.raw)[col];
        return switch (cell.content_tag) {
            .bg_color_palette => .{ .bg_color = .{ .palette = cell.content.color_palette.data } },
            .bg_color_rgb => .{ .bg_color = .{ .rgb = .{ .r = cell.content.color_rgb.r, .g = cell.content.color_rgb.g, .b = cell.content.color_rgb.b } } },
            else => if (cell.style_id == 0) .{} else cells.items(.style)[col],
        };
    }

    fn digits(value: usize) usize {
        var n = value;
        var count: usize = 1;
        while (n >= 10) : (n /= 10) count += 1;
        return count;
    }

    fn writeCells(d: *Differ, out: *std.Io.Writer, paint: *Paint, row: usize, first: usize, end: usize) !void {
        const cells = d.render.row_data.items(.cells)[row];
        const pin = d.render.row_data.items(.pin)[row];
        const raw = cells.items(.raw);
        for (first..end) |col| {
            const cell = raw[col];
            if (cell.wide == .spacer_tail) continue;
            const current = cellStyle(cells, col);
            const target = if (cell.hyperlink) link(pin, col) else null;
            if (!sameLink(paint.open, target)) {
                if (paint.open != null) try out.writeAll("\x1b]8;;\x1b\\");
                if (target) |t| try out.print("\x1b]8;{s}{s};{s}\x1b\\", .{ if (t.id != null) "id=" else "", t.id orelse "", t.uri });
                paint.open = target;
            }
            if (paint.style == null or !paint.style.?.eql(current)) {
                if (paint.style) |previous| {
                    try writeStyle(out, previous, current);
                } else {
                    try out.print("{f}", .{current.formatterVt()});
                }
                paint.style = current;
            }
            const text = cell.codepoint();
            if (cell.wide == .spacer_head or text == 0 or cell.content_tag == .bg_color_palette or cell.content_tag == .bg_color_rgb) {
                try out.writeByte(' ');
                continue;
            }
            try writeCodepoint(out, text);
            if (cell.content_tag == .codepoint_grapheme) for (cells.items(.grapheme)[col]) |extra| try writeCodepoint(out, extra);
        }
    }
};

/// Only detach graphics whose execution cannot change the text cursor.
/// Ghostty parses the header; payload bytes are forwarded without decoding.
fn imageCommand(bytes: []const u8, chunks: *bool) bool {
    if (!std.mem.startsWith(u8, bytes, "\x1b_G") or !std.mem.endsWith(u8, bytes, "\x1b\\")) return false;
    const body = bytes[3 .. bytes.len - 2];
    const header = body[0 .. std.mem.indexOfScalar(u8, body, ';') orelse body.len];
    const command = vt.kitty.graphics.CommandParser.parseString(a, header) catch return false;
    defer command.deinit(a);
    if (chunks.* and command.control != .transmit) return false;
    switch (command.control) {
        .display, .transmit_and_display => {
            if (command.display().?.cursor_movement != .none) return false;
        },
        .transmit, .delete => {},
        else => return false,
    }
    chunks.* = if (command.transmission()) |t| t.more_chunks else false;
    return true;
}

/// A frame starts with a complete style; later cells only change attributes
/// that differ. SGR 22 clears both bold and faint, so restore either survivor.
fn writeStyle(out: *std.Io.Writer, previous: vt.Style, next: vt.Style) !void {
    if (next.default()) return out.writeAll("\x1b[0m");
    const old = previous.flags;
    const new = next.flags;
    if ((old.bold and !new.bold) or (old.faint and !new.faint)) {
        try out.writeAll("\x1b[22m");
        if (new.bold) try out.writeAll("\x1b[1m");
        if (new.faint) try out.writeAll("\x1b[2m");
    } else {
        if (!old.bold and new.bold) try out.writeAll("\x1b[1m");
        if (!old.faint and new.faint) try out.writeAll("\x1b[2m");
    }
    inline for (.{
        .{ "italic", 3, 23 },
        .{ "blink", 5, 25 },
        .{ "inverse", 7, 27 },
        .{ "invisible", 8, 28 },
        .{ "strikethrough", 9, 29 },
        .{ "overline", 53, 55 },
    }) |flag| {
        if (@field(old, flag[0]) != @field(new, flag[0]))
            try out.print("\x1b[{d}m", .{if (@field(new, flag[0])) @as(u8, flag[1]) else @as(u8, flag[2])});
    }
    if (old.underline != new.underline) try out.writeAll(switch (new.underline) {
        .none => "\x1b[24m",
        .single => "\x1b[4m",
        .double => "\x1b[4:2m",
        .curly => "\x1b[4:3m",
        .dotted => "\x1b[4:4m",
        .dashed => "\x1b[4:5m",
    });
    if (!previous.fg_color.eql(next.fg_color)) try writeColor(out, 38, next.fg_color);
    if (!previous.bg_color.eql(next.bg_color)) try writeColor(out, 48, next.bg_color);
    if (!previous.underline_color.eql(next.underline_color)) try writeColor(out, 58, next.underline_color);
}

fn writeColor(out: *std.Io.Writer, prefix: u8, color: vt.Style.Color) !void {
    switch (color) {
        .none => try out.print("\x1b[{d}m", .{prefix + 1}),
        .palette => |index| try out.print("\x1b[{d};5;{d}m", .{ prefix, index }),
        .rgb => |rgb| try out.print("\x1b[{d};2;{d};{d};{d}m", .{ prefix, rgb.r, rgb.g, rgb.b }),
    }
}

const Link = struct { uri: []const u8, id: ?[]const u8 };
fn link(pin: vt.Pin, col: usize) ?Link {
    const page = pin.node.page();
    const cell = page.getRowAndCell(@intCast(col), pin.y).cell;
    const id = page.lookupHyperlink(cell) orelse return null;
    const entry = page.hyperlink_set.get(page.memory, id);
    return .{
        .uri = entry.uri.slice(page.memory),
        .id = switch (entry.id) {
            .explicit => |value| value.slice(page.memory),
            .implicit => null,
        },
    };
}
fn sameLink(lhs: ?Link, rhs: ?Link) bool {
    const l = lhs orelse return rhs == null;
    const r = rhs orelse return false;
    return std.mem.eql(u8, l.uri, r.uri) and std.mem.eql(u8, l.id orelse "", r.id orelse "") and (l.id == null) == (r.id == null);
}
fn hashStyle(h: *std.hash.Wyhash, style: vt.Style) void {
    for ([_]vt.Style.Color{ style.fg_color, style.bg_color, style.underline_color }) |color| switch (color) {
        .none => h.update(&.{0}),
        .palette => |index| h.update(&.{ 1, index }),
        .rgb => |rgb| h.update(&.{ 2, rgb.r, rgb.g, rgb.b }),
    };
    h.update(std.mem.asBytes(&@as(u16, @bitCast(style.flags))));
}
fn writeCodepoint(out: *std.Io.Writer, cp: u21) !void {
    var bytes: [4]u8 = undefined;
    const n = std.unicode.utf8Encode(cp, &bytes) catch return out.writeByte(' ');
    try out.writeAll(bytes[0..n]);
}

const Sequence = struct {
    len: usize,
    kind: enum { cells, image, control, reset },
};
/// Sorts the escape sequence at the start of `bytes`. Cells are what the
/// mirror can redraw: text, styles, links, cursor moves and erases within
/// the screen. Everything else is a control.
fn scan(bytes: []const u8) Sequence {
    if (bytes.len < 2) return .{ .len = bytes.len, .kind = .cells };
    switch (bytes[1]) {
        '_' => {
            const end = std.mem.indexOfPos(u8, bytes, 2, "\x1b\\") orelse return .{ .len = bytes.len, .kind = .image };
            return .{ .len = end + 2, .kind = .image };
        },
        ']' => {
            var end: usize = 2;
            const len = while (end < bytes.len) : (end += 1) {
                if (bytes[end] == 0x07) break end + 1;
                if (bytes[end] == 0x1b and end + 1 < bytes.len and bytes[end + 1] == '\\') break end + 2;
            } else bytes.len;
            return .{ .len = len, .kind = if (std.mem.startsWith(u8, bytes[2..], "8;")) .cells else .control };
        },
        '[' => {
            var end: usize = 2;
            while (end < bytes.len and (bytes[end] < 0x40 or bytes[end] > 0x7e)) end += 1;
            if (end == bytes.len) return .{ .len = bytes.len, .kind = .cells };
            const params = bytes[2..end];
            const kind: @FieldType(Sequence, "kind") = switch (bytes[end]) {
                // Cursor visibility is the cursor's; the frame's own
                // synchronized update is replaced by the diff's.
                'h', 'l' => if (std.mem.eql(u8, params, "?25") or std.mem.eql(u8, params, "?2026"))
                    .cells
                else if (std.mem.eql(u8, params, "?1049") or std.mem.eql(u8, params, "?1047") or std.mem.eql(u8, params, "?47"))
                    .reset
                else
                    .control,
                // A full clear also drops the host's images.
                'J' => if (std.mem.eql(u8, params, "2") or std.mem.eql(u8, params, "3")) .reset else .cells,
                // Scrolling can move image anchors along with the text.
                'S', 'T', 'L', 'M' => .reset,
                'q' => .control,
                else => .cells,
            };
            return .{ .len = end + 1, .kind = kind };
        },
        'c', 'D', 'E', 'M' => return .{ .len = 2, .kind = .reset },
        else => return .{ .len = 2, .kind = .cells },
    }
}

fn render(d: *Differ, frame: []const u8) ![]u8 {
    var out: std.Io.Writer.Allocating = .init(std.testing.allocator);
    errdefer out.deinit();
    try d.diff(&out.writer, frame);
    return out.toOwnedSlice();
}

test "a frame that changes one cell writes that cell" {
    const d = try Differ.create(20, 4);
    defer d.destroy();
    const first = "\x1b[?1003h\x1b[?2026h\x1b[H\x1b[Jhello\x1b[2;1H\x1b[31mworld\x1b[0m\x1b[?2026l";
    const whole = try render(d, first);
    defer std.testing.allocator.free(whole);
    try std.testing.expectEqualStrings(first, whole);
    const same = try render(d, first);
    defer std.testing.allocator.free(same);
    try std.testing.expectEqualStrings("", same);
    const changed = try render(d, "\x1b[?1003h\x1b[?2026h\x1b[H\x1b[Jhello\x1b[2;1H\x1b[31mwOrld\x1b[0m\x1b[?2026l");
    defer std.testing.allocator.free(changed);
    try std.testing.expectEqualStrings("\x1b[?2026h\x1b[?25l\x1b[2;2H\x1b[0m\x1b[38;5;1mO\x1b[0m\x1b[2;6H\x1b[?25h\x1b[?2026l", changed);
}

test "a changed control sends the whole frame" {
    const d = try Differ.create(20, 4);
    defer d.destroy();
    const frames = [_][]const u8{
        "\x1b[H\x1b[Jtext\x1b]22;default\x1b\\",
        "\x1b[H\x1b[Jtext\x1b]22;pointer\x1b\\",
        "\x1b[H\x1b[J\x1b[2;3H\x1b_Ga=p,i=1\x1b\\text",
        "\x1b[H\x1b[J\x1b[3;3H\x1b_Ga=p,i=1\x1b\\text",
    };
    for (frames) |frame| {
        const out = try render(d, frame);
        defer std.testing.allocator.free(out);
        try std.testing.expectEqualStrings(frame, out);
    }
}

test "a moved cursor is written without cells" {
    const d = try Differ.create(20, 4);
    defer d.destroy();
    const first = try render(d, "\x1b[H\x1b[J$ \x1b[1;3H\x1b[?25h");
    defer std.testing.allocator.free(first);
    const moved = try render(d, "\x1b[H\x1b[J$ \x1b[2;5H\x1b[?25h");
    defer std.testing.allocator.free(moved);
    try std.testing.expectEqualStrings("\x1b[?2026h\x1b[?25l\x1b[2;5H\x1b[?25h\x1b[?2026l", moved);
}

test "wide characters and links are rewritten whole" {
    const d = try Differ.create(20, 2);
    defer d.destroy();
    const first = try render(d, "\x1b[H\x1b[J\x1b]8;id=x;https://a.example\x1b\\ab\x1b]8;;\x1b\\界c");
    defer std.testing.allocator.free(first);
    const changed = try render(d, "\x1b[H\x1b[J\x1b]8;id=x;https://b.example\x1b\\ab\x1b]8;;\x1b\\界d");
    defer std.testing.allocator.free(changed);
    try std.testing.expect(std.mem.indexOf(u8, changed, "\x1b]8;id=x;https://b.example\x1b\\") != null);
    try std.testing.expect(std.mem.indexOf(u8, changed, "界d") != null);
    const tail = try render(d, "\x1b[H\x1b[J\x1b]8;id=x;https://b.example\x1b\\ab\x1b]8;;\x1b\\界e");
    defer std.testing.allocator.free(tail);
    try std.testing.expect(std.mem.indexOf(u8, tail, "\x1b[1;5H") != null);
    try std.testing.expect(std.mem.indexOf(u8, tail, "界") == null);
}
