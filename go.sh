#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$root/scripts/zig" build -Doptimize=ReleaseSafe
if [ "${1:-}" = "--restart" ]; then
    shift
    binary="$root/zig-out/bin/wrangler"
    if "$binary" ping >/dev/null 2>&1; then
        "$binary" shutdown >/dev/null
        socket=${WRANGLER_SOCKET:-/tmp/wrangler-$(id -u)/control.sock}
        attempts=0
        # Shutdown acknowledges before cleanup finishes. Wait for the old
        # socket to disappear so startup cannot reattach to the exiting server.
        while [ -S "$socket" ]; do
            attempts=$((attempts + 1))
            if [ "$attempts" -ge 100 ]; then
                echo 'wrangler: runtime did not stop within 5 seconds' >&2
                exit 1
            fi
            sleep 0.05
        done
    fi
fi
exec "$root/zig-out/bin/wrangler" "$@"
