//! Versioned runtime data. No viewer focus, menus, or screen coordinates belong
//! in a session snapshot. Clients keep selection by the stable IDs below.
const std = @import("std");
const layout = @import("layout.zig");
const runtime = @import("runtime.zig");
const agents = @import("agents.zig");

pub const version: u32 = 1;
pub const capabilities = [_][]const u8{
    "session.snapshot", "session.subscribe", "pane.surface", "pane.input",
    "pane.create",      "pane.split",        "pane.close",   "tab.rename",
    "split.resize",
};

pub fn require(v: std.json.Value, negotiated: ?u32) !void {
    const requested = v.object.get("protocol");
    const selected = if (requested) |value| blk: {
        if (value != .integer) return error.UnsupportedProtocol;
        break :blk std.math.cast(u32, value.integer) orelse return error.UnsupportedProtocol;
    } else negotiated orelse return error.ProtocolRequired;
    if (selected != version) return error.UnsupportedProtocol;
}

pub fn id(v: std.json.Value, field: []const u8) !u32 {
    const value = v.object.get(field) orelse return error.MissingTarget;
    if (value != .integer) return error.InvalidTarget;
    const n = std.math.cast(u32, value.integer) orelse return error.InvalidTarget;
    if (n == 0) return error.InvalidTarget;
    return n;
}

pub const Node = union(enum) {
    pane: u32,
    split: struct { axis: layout.Axis, ratio: u16, first: *const Node, second: *const Node },
};
pub const Tab = struct { id: u32, title: []const u8, layout: *const Node };
pub const Workspace = struct { id: u32, name: []const u8, cwd: []const u8, tabs: []const Tab };
pub const Agent = struct {
    provider: agents.Provider,
    state: agents.State,
    attention: agents.Attention,
    session: []const u8,
    activity: []const u8,
    cwd: []const u8,
    tool_active: bool,
};
pub const Pane = struct {
    id: u32,
    workspace: u32,
    tab: u32,
    cwd: []const u8,
    pid: i32,
    cols: u16,
    rows: u16,
    exited: bool,
    agent: Agent,
};
pub const Native = struct {
    id: u32,
    workspace: u32,
    provider: agents.Provider,
    cwd: []const u8,
    ready: bool,
    exited: bool,
    state: agents.State,
    attention: agents.Attention,
    tool_active: bool,
};
pub const Snapshot = struct {
    type: []const u8 = "session",
    protocol: u32 = version,
    server_pid: i32,
    revision: u64,
    workspaces: []const Workspace,
    panes: []const Pane,
    native_sessions: []const Native,
    closed_panes: usize,
};

/// Allocate containers in a request arena; strings borrow the runtime until
/// serialization completes. No Ghostty or layout implementation structs cross
/// the wire.
pub fn snapshot(allocator: std.mem.Allocator, r: *runtime.Runtime) !Snapshot {
    const workspaces = try allocator.alloc(Workspace, r.workspaces.items.items.len);
    for (r.workspaces.items.items, workspaces) |*ws, *out| {
        const tabs = try allocator.alloc(Tab, ws.model.count);
        for (ws.model.tabs[0..ws.model.count], tabs) |*tab, *item| {
            item.* = .{ .id = tab.id, .title = tab.title(), .layout = try tree(allocator, &ws.model, tab.root) };
        }
        out.* = .{ .id = ws.id, .name = ws.name(), .cwd = ws.cwd, .tabs = tabs };
    }
    const panes = try allocator.alloc(Pane, r.panes.items.len);
    for (r.panes.items, panes) |*p, *out| {
        const owner = r.workspaces.owner(p.id) orelse return error.NoWorkspace;
        const tab = owner.model.tabForPane(p.id) orelse return error.NoTab;
        out.* = .{
            .id = p.id,
            .workspace = owner.id,
            .tab = owner.model.tabs[tab].id,
            .cwd = p.cwd,
            .pid = p.terminal.pid,
            .cols = p.terminal.vt.cols,
            .rows = p.terminal.vt.rows,
            .exited = p.terminal.exited,
            .agent = .{
                .provider = p.agent.provider,
                .state = p.agent.state,
                .attention = p.agent.attention,
                .session = p.agent.sessionId(),
                .activity = p.agent.label(),
                .cwd = p.agent.directory(),
                .tool_active = p.agent.tool_active,
            },
        };
    }
    const sessions = try allocator.alloc(Native, r.sessions.items.len);
    for (r.sessions.items, sessions) |*session, *out| out.* = .{
        .id = session.id,
        .workspace = session.workspace_id,
        .provider = session.provider,
        .cwd = session.cwd,
        .ready = session.ready,
        .exited = session.exited,
        .state = session.state,
        .attention = session.attention,
        .tool_active = session.toolActive(),
    };
    return .{
        .server_pid = @import("os.zig").c.getpid(),
        .revision = r.revision,
        .workspaces = workspaces,
        .panes = panes,
        .native_sessions = sessions,
        .closed_panes = r.closed.items.len,
    };
}

fn tree(allocator: std.mem.Allocator, model: *const layout.Model, index: u8) std.mem.Allocator.Error!*const Node {
    const node = try allocator.create(Node);
    node.* = switch (model.nodes[index].?) {
        .pane => |pane| .{ .pane = pane },
        .split => |split| .{ .split = .{
            .axis = split.axis,
            .ratio = split.ratio,
            .first = try tree(allocator, model, split.first),
            .second = try tree(allocator, model, split.second),
        } },
    };
    return node;
}
