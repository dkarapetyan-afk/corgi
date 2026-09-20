const std = @import("std");
const layout = @import("layout.zig");
const a = @import("os.zig").allocator;

pub const max_workspaces = 32;
pub const Workspace = struct {
    id: u32,
    name_buf: [80]u8 = .{0} ** 80,
    name_len: usize = 0,
    cwd: []const u8,
    model: layout.Model = .{},
    pub fn name(w: *const Workspace) []const u8 {
        return w.name_buf[0..w.name_len];
    }
    fn rename(w: *Workspace, value: []const u8) void {
        const trimmed = std.mem.trim(u8, value, " ");
        const label = if (trimmed.len == 0) "Workspace" else trimmed;
        w.name_len = @min(label.len, w.name_buf.len);
        for (label[0..w.name_len], 0..) |ch, i| w.name_buf[i] = if (ch >= 32 and ch < 127) ch else '_';
    }
};
pub const Store = struct {
    items: std.ArrayList(Workspace) = .empty,
    active: usize = 0,
    next_id: u32 = 1,
    next_pane_id: u32 = 1,
    const SavedWorkspace = struct { id: u32, name: []const u8, cwd: []const u8 };
    const Saved = struct { version: u32 = 1, active: u32, next_id: u32, workspaces: []const SavedWorkspace };

    pub fn statePath(socket: []const u8) ![]const u8 {
        const os = @import("os.zig");
        if (os.env("CORGI_SOCKET") != null) return std.fmt.allocPrint(a, "{s}.workspaces.json", .{socket});
        if (os.env("XDG_STATE_HOME")) |root| return std.fs.path.join(a, &.{ root, "corgi", "workspaces.json" });
        return std.fs.path.join(a, &.{ os.env("HOME") orelse return error.NoHome, ".local", "state", "corgi", "workspaces.json" });
    }
    pub fn save(s: *Store, path: []const u8) !void {
        var entries: [max_workspaces]SavedWorkspace = undefined;
        for (s.items.items, 0..) |*w, i| entries[i] = .{ .id = w.id, .name = w.name(), .cwd = w.cwd };
        const bytes = try std.json.Stringify.valueAlloc(a, Saved{ .active = s.current().id, .next_id = s.next_id, .workspaces = entries[0..s.items.items.len] }, .{ .whitespace = .indent_2 });
        defer a.free(bytes);
        try std.fs.cwd().makePath(std.fs.path.dirname(path) orelse ".");
        const temp = try std.fmt.allocPrint(a, "{s}.tmp", .{path});
        defer a.free(temp);
        var file = try std.fs.cwd().createFile(temp, .{ .mode = 0o600 });
        defer file.close();
        errdefer std.fs.cwd().deleteFile(temp) catch {};
        try file.writeAll(bytes);
        try file.sync();
        try std.fs.cwd().rename(temp, path);
    }
    pub fn load(s: *Store, path: []const u8) !bool {
        const bytes = std.fs.cwd().readFileAlloc(a, path, 1024 * 1024) catch |err| switch (err) {
            error.FileNotFound => return false,
            else => return err,
        };
        defer a.free(bytes);
        const parsed = try std.json.parseFromSlice(Saved, a, bytes, .{});
        defer parsed.deinit();
        const saved = parsed.value;
        if (saved.version != 1 or saved.workspaces.len == 0 or saved.workspaces.len > max_workspaces) return error.InvalidWorkspaceState;
        var restored: Store = .{};
        errdefer restored.deinit();
        for (saved.workspaces) |w| {
            if (w.id == 0 or w.id >= saved.next_id or restored.index(w.id) != null or !std.fs.path.isAbsolute(w.cwd)) return error.InvalidWorkspaceState;
            const cwd = try a.dupe(u8, w.cwd);
            errdefer a.free(cwd);
            var item: Workspace = .{ .id = w.id, .cwd = cwd };
            item.rename(w.name);
            try restored.items.append(a, item);
        }
        restored.active = restored.index(saved.active) orelse return error.InvalidWorkspaceState;
        restored.next_id = saved.next_id;
        s.deinit();
        s.* = restored;
        return true;
    }
    pub fn deinit(s: *Store) void {
        for (s.items.items) |w| a.free(w.cwd);
        s.items.deinit(a);
    }
    pub fn current(s: *Store) *Workspace {
        return &s.items.items[s.active];
    }
    pub fn index(s: *const Store, id: u32) ?usize {
        for (s.items.items, 0..) |w, i| if (w.id == id) return i;
        return null;
    }
    pub fn owner(s: *Store, pane: u32) ?*Workspace {
        for (s.items.items) |*w| if (w.model.tabForPane(pane) != null) return w;
        return null;
    }
    pub fn directory(path: []const u8) ![]const u8 {
        const home = @import("os.zig").env("HOME") orelse ".";
        const expanded = if (std.mem.eql(u8, path, "~")) try a.dupe(u8, home) else if (std.mem.startsWith(u8, path, "~/")) try std.fs.path.join(a, &.{ home, path[2..] }) else try a.dupe(u8, if (path.len == 0) "." else path);
        defer a.free(expanded);
        var dir = try std.fs.cwd().openDir(expanded, .{});
        defer dir.close();
        return dir.realpathAlloc(a, ".");
    }
    pub fn add(s: *Store, name: []const u8, cwd: []const u8) !u32 {
        if (s.items.items.len >= max_workspaces) return error.TooManyWorkspaces;
        const path = try directory(cwd);
        errdefer a.free(path);
        var w: Workspace = .{ .id = s.next_id, .cwd = path };
        w.rename(name);
        try s.items.append(a, w);
        s.next_id += 1;
        return w.id;
    }
    pub fn rename(s: *Store, id: u32, name: []const u8) !void {
        const i = s.index(id) orelse return error.NoWorkspace;
        s.items.items[i].rename(name);
    }
    pub fn edit(s: *Store, id: u32, name: []const u8, cwd: []const u8) !void {
        const i = s.index(id) orelse return error.NoWorkspace;
        const path = try directory(cwd);
        a.free(s.items.items[i].cwd);
        s.items.items[i].cwd = path;
        s.items.items[i].rename(name);
    }
};
