//! Ordered request/reply connection used by a viewer. No UI messages cross it.
const std = @import("std");
const os = @import("os.zig");
const a = os.allocator;
pub const Connection = struct {
    fd: c_int,
    pub fn call(conn: *Connection, value: anytype) !std.json.Parsed(std.json.Value) {
        try os.sendJson(conn.fd, value);
        const bytes = try os.readLine(conn.fd, 16 * 1024 * 1024);
        defer a.free(bytes);
        const result = try std.json.parseFromSlice(std.json.Value, a, bytes, .{ .allocate = .alloc_always });
        errdefer result.deinit();
        const err = @import("agents.zig").str(result.value, "err");
        if (err.len > 0) {
            if (std.mem.eql(u8, err, "StaleLayout")) return error.StaleLayout;
            if (std.mem.eql(u8, err, "NoPane")) return error.NoPane;
            if (std.mem.eql(u8, err, "UnknownOperation")) return error.ViewerProtocolUnavailable;
            return error.ServerRejected;
        }
        return result;
    }
    pub fn send(conn: *Connection, value: anytype) !void {
        const response = try conn.call(value);
        response.deinit();
    }
};
