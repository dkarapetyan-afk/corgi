//! Inline UTF-8 text. Bytes past `len` stay zero for structural equality.
const std = @import("std");

pub fn BoundedText(comptime n: usize) type {
    return struct {
        const Self = @This();
        pub const Len = std.math.IntFittingRange(0, n);

        /// Read through `text()`. Build a new value instead of writing here.
        bytes: [n]u8 = @splat(0),
        len: Len = 0,

        /// The longest prefix that fits, cut at a UTF-8 boundary.
        pub fn initTruncated(value: []const u8) Self {
            var t: Self = .{};
            t.append(value);
            return t;
        }

        pub fn text(t: *const Self) []const u8 {
            return t.bytes[0..t.len];
        }

        /// Appends what fits, cut at a UTF-8 boundary.
        pub fn append(t: *Self, value: []const u8) void {
            var take: usize = @min(value.len, n - @as(usize, t.len));
            while (take > 0 and !std.unicode.utf8ValidateSlice(value[0..take])) take -= 1;
            @memcpy(t.bytes[t.len..][0..take], value[0..take]);
            t.len += @intCast(take);
        }
    };
}

test "truncated values end at a UTF-8 boundary" {
    const T = BoundedText(4);
    try std.testing.expectEqualStrings("hell", T.initTruncated("hello").text());
    // "é" is two bytes; a prefix never splits it.
    try std.testing.expectEqualStrings("abc", T.initTruncated("abcé").text());
    try std.testing.expectEqual(u3, T.Len);
}

test "equal text compares equal whatever was stored before" {
    var built: BoundedText(8) = .initTruncated("ab");
    built.append("cdefgh");
    var direct: BoundedText(8) = .initTruncated("abcdefgh");
    try std.testing.expect(std.meta.eql(built, direct));
    direct = .initTruncated("ab");
    try std.testing.expect(std.meta.eql(direct, BoundedText(8).initTruncated("ab")));
}
