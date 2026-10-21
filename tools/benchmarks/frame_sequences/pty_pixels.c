// Set the PTY's pixel dimensions, then run the requested viewer.
// Corgi reads these via ioctl; fixed dimensions keep Kitty sizing comparable.
// Bun 1.4.2's fixed-signature FFI miscalls variadic ioctl on macOS arm64:
// the size pointer must be passed on the stack. C supplies the correct ABI.
// https://github.com/oven-sh/bun/issues/12389
#include <stdio.h>
#include <sys/ioctl.h>
#include <unistd.h>
int main(int argc, char **argv) {
    if (argc < 2) return 2;
    struct winsize size = {.ws_row = 40, .ws_col = 120, .ws_xpixel = 1200, .ws_ypixel = 880};
    if (ioctl(STDIN_FILENO, TIOCSWINSZ, &size) != 0) {
        perror("PTY dimensions");
        return 1;
    }
    execv(argv[1], argv + 1);
    perror("viewer exec");
    return 1;
}
