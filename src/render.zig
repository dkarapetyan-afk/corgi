const std = @import("std");
const layout = @import("layout.zig");
const terminal = @import("terminal.zig");
const agents = @import("agents.zig");
const commands = @import("commands.zig");
const naming = @import("name_dialog.zig");
const a = @import("os.zig").allocator;
pub const Pane = struct { id: layout.Id, terminal: *terminal.Terminal, agent: agents.Agent = .{}, cwd: []const u8 };
pub const Buffer = std.Io.Writer.Allocating;
pub const Ui = struct {
    message: []const u8,
    copy_mode: bool,
    native_blocked: usize,
    native_finished: usize,
    menu: ?commands.View = null,
    tab_menu: ?commands.TabMenu = null,
    dialog: ?naming.Dialog = null,
    confirm: bool = false,
};
pub fn tabWidth(tab: layout.Tab, index: usize) usize {
    return @min(tab.title().len, 16) + (if (index + 1 >= 10) @as(usize, 5) else 4);
}
pub fn tabStart(model: *const layout.Model, width: u16) usize {
    if (model.count == 0) return 0;
    var start = model.active;
    var used = tabWidth(model.tabs[start], start);
    while (start > 0 and used + tabWidth(model.tabs[start - 1], start - 1) <= width) {
        start -= 1;
        used += tabWidth(model.tabs[start], start);
    }
    return start;
}

pub fn addTabX(model: *const layout.Model, width: u16) u16 {
    const available = width -| 3;
    var x: usize = 0;
    for (model.tabs[tabStart(model, available)..model.count], tabStart(model, available)..) |tab, i| x += @min(tabWidth(tab, i), available - x);
    return @intCast(x);
}
pub fn tabAt(model: *const layout.Model, width: u16, x: u16) ?usize {
    const available = width -| 3;
    var start: usize = 0;
    const first = tabStart(model, available);
    for (model.tabs[first..model.count], first..) |tab, i| {
        const len = @min(tabWidth(tab, i), available - start);
        if (x >= start and x < start + len) return i;
        start += len;
    }
    return null;
}
pub fn frame(model: *layout.Model, panes: []const Pane, width: u16, height: u16, ui: Ui) ![]u8 {
    var out: Buffer = .init(a);
    defer out.deinit();
    const w = &out.writer;
    try w.writeAll("\x1b[?2026h\x1b[?25l\x1b[0m\x1b[H\x1b[2J");
    var x: usize = 0;
    const tab_space = width -| 3;
    const start = tabStart(model, tab_space);
    for (model.tabs[start..model.count], start..) |tab, i| {
        if (x >= tab_space) break;
        try w.writeAll(if (i == model.active) "\x1b[1;38;2;226;230;233;48;2;48;53;61m" else "\x1b[0;38;2;125;132;143;48;2;24;27;32m");
        var name: [96]u8 = undefined;
        const text = try std.fmt.bufPrint(&name, " {d}:{s} ", .{ i + 1, tab.title()[0..@min(tab.title().len, 16)] });
        const len = @min(text.len, tab_space - x);
        try w.writeAll(text[0..len]);
        x += len;
    }
    try w.writeAll("\x1b[1;38;2;161;194;178;48;2;35;40;47m + ");
    try w.writeAll("\x1b[0m");
    if (model.count == 0) {
        const empty = " No panes. Ctrl-B c: new tab | Ctrl-B u: undo close | Ctrl-B q: detach";
        try w.writeAll("\x1b[2;1H");
        try w.writeAll(empty[0..@min(empty.len, width)]);
    }
    var locations: [layout.max_panes]layout.Placement = undefined;
    const area: layout.Rect = .{ .x = 0, .y = 1, .w = width, .h = height -| 2 };
    for (model.placements(area, &locations)) |place| {
        if (place.rect.w == 0 or place.rect.h == 0) continue;
        for (panes) |p| if (p.id == place.id) {
            const r = place.rect;
            const focused = model.tab().focus == p.id;
            try w.print("\x1b[{d};{d}H", .{ r.y + 1, r.x + 1 });
            try w.writeAll(if (focused) "\x1b[1;38;2;161;194;178m" else "\x1b[0;38;2;100;108;121m");
            var header: [256]u8 = undefined;
            const marker: []const u8 = switch (p.agent.attention) {
                .none => "",
                .finished => " + done",
                .needs_input => " ! needs you",
            };
            const label = if (p.terminal.exited) "exited" else @tagName(p.agent.state);
            const title = if (p.agent.provider == .other)
                try std.fmt.bufPrint(&header, " {s}{d}", .{ if (focused) ">" else " ", p.id })
            else
                try std.fmt.bufPrint(&header, " {s}{d} {s} {s}{s}", .{ if (focused) ">" else " ", p.id, @tagName(p.agent.provider), label, marker });
            try w.writeAll(title[0..@min(title.len, r.w)]);
            try w.writeAll("\x1b[0m");
            try p.terminal.render.update(a, &p.terminal.vt);
            const state = &p.terminal.render;
            var last_style: ?terminal.vt.Style = null;
            var last_fg: ?terminal.vt.color.RGB = null;
            var last_bg: ?terminal.vt.color.RGB = null;
            for (state.row_data.items(.cells), 0..) |cells, row| {
                if (row + 1 >= r.h) break;
                try w.print("\x1b[{d};{d}H", .{ r.y + row + 2, r.x + 1 });
                for (cells.items(.raw), 0..) |cell, col| {
                    if (col >= r.w) break;
                    if (cell.wide == .spacer_tail or cell.wide == .spacer_head) continue;
                    const style: terminal.vt.Style = if (cell.style_id == 0) .{} else cells.items(.style)[col];
                    var fg = style.fg(.{ .default = state.colors.foreground, .palette = &state.colors.palette });
                    var bg = style.bg(&cell, &state.colors.palette) orelse state.colors.background;
                    if (ui.dialog != null) {
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
            }
            try w.writeAll("\x1b[0m");
            break;
        };
    }
    var blocked: usize = ui.native_blocked;
    var finished: usize = ui.native_finished;
    for (panes) |p| switch (p.agent.attention) {
        .needs_input => blocked += 1,
        .finished => finished += 1,
        .none => {},
    };
    try w.print("\x1b[{d};1H\x1b[0;38;2;125;132;143m", .{height});
    var status: [512]u8 = undefined;
    if (ui.confirm) {
        const text = try std.fmt.bufPrint(&status, " [ Close ]  [ Cancel ] {s}", .{ui.message});
        try w.writeAll(text[0..@min(text.len, width)]);
    } else {
        const text = if (ui.message.len > 0) ui.message else try std.fmt.bufPrint(&status, " {s}  ^B commands   ! {d} needs you  + {d} finished   ^B a attention", .{ if (ui.copy_mode) "SCROLL  j/k move  y copy viewport  q exit" else "wrangler", blocked, finished });
        try w.writeAll(text[0..@min(text.len, width)]);
    }
    try w.writeAll("\x1b[0m");
    if (model.count > 0 and !ui.copy_mode and ui.menu == null and ui.tab_menu == null and ui.dialog == null and !ui.confirm) for (model.placements(area, &locations)) |place| {
        if (place.id != model.tab().focus or place.rect.h < 2) continue;
        for (panes) |p| if (p.id == place.id) {
            if (p.terminal.render.cursor.visible) if (p.terminal.render.cursor.viewport) |cursor| {
                if (cursor.x < place.rect.w and cursor.y + 1 < place.rect.h) {
                    try w.print("\x1b[{d};{d}H\x1b[?25h", .{ place.rect.y + cursor.y + 2, place.rect.x + cursor.x + 1 });
                }
            };
        };
    };
    if (ui.menu) |menu| try menu.draw(w);
    if (ui.tab_menu) |menu| try menu.draw(w, width, height);
    if (ui.dialog) |dialog| try naming.View.init(width, height, dialog).draw(dialog, w);
    try w.writeAll("\x1b[?2026l");
    return out.toOwnedSlice();
}
fn dim(color: terminal.vt.color.RGB) terminal.vt.color.RGB {
    return .{ .r = color.r / 2, .g = color.g / 2, .b = color.b / 2 };
}
