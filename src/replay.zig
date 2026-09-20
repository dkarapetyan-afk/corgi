//! Exact, bounded terminal event journal. A formatter is insufficient for parser
//! fragments and inactive screens. Never silently truncate an exact checkpoint.
const std = @import("std");
const a = @import("os.zig").allocator;
pub const limit = 64 * 1024 * 1024;
pub const Tag = enum(u8) { output, resize, theme, render, sync_end };
pub const Journal = struct {
    bytes: std.ArrayList(u8) = .empty,
    enabled: bool = false,
    failed: bool = false,
    cols: u16 = 0,
    rows: u16 = 0,
    pub fn append(j: *Journal, tag: Tag, data: []const u8) void {
        if (!j.enabled or j.failed) return;
        if (data.len > limit or j.bytes.items.len + data.len + 5 > limit) return j.fail();
        j.bytes.ensureUnusedCapacity(a, data.len + 5) catch return j.fail();
        j.bytes.appendAssumeCapacity(@intFromEnum(tag));
        var size: [4]u8 = undefined;
        std.mem.writeInt(u32, &size, @intCast(data.len), .little);
        j.bytes.appendSliceAssumeCapacity(&size);
        j.bytes.appendSliceAssumeCapacity(data);
    }
    pub fn fail(j: *Journal) void {
        j.failed = true;
        j.bytes.clearAndFree(a);
    }
};
pub fn encode(alloc: std.mem.Allocator, bytes: []const u8) ![]const u8 {
    const out = try alloc.alloc(u8, std.base64.standard.Encoder.calcSize(bytes.len));
    return std.base64.standard.Encoder.encode(out, bytes);
}
pub fn decode(alloc: std.mem.Allocator, text: []const u8) ![]u8 {
    const out = try alloc.alloc(u8, try std.base64.standard.Decoder.calcSizeForSlice(text));
    errdefer alloc.free(out);
    try std.base64.standard.Decoder.decode(out, text);
    return out;
}
