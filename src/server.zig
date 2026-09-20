//! The legacy socket UI remains a compatibility adapter. Normal viewers use
//! the same presentation controller locally, over the versioned runtime protocol.
pub const Server = @import("controller.zig").Controller(false);
