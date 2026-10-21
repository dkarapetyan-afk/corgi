# Releases

The publisher builds committed HEAD for macOS arm64 and Linux amd64 in an
isolated checkout. Pending edits are excluded; Git tags and remotes are untouched.

## Setup

Use an Apple Silicon Mac with Bun, the [pinned Zig toolchain](../AGENTS.md#zig-toolchain),
Xcode's SDK and a persistent macOS signing identity. Keep signing keys and storage
credentials outside the repository. Use one publishing host at a time.

Create and back up the release signing key:

```sh
./scripts/release --init-key "$HOME/.config/corgi/release-key.pem"
```

Create `~/.config/corgi/release.json` (or select it with `CORGI_RELEASE_CONFIG`):

```json
{
  "publicBaseUrl": "https://corgi.computer",
  "endpoint": "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
  "region": "auto",
  "bucket": "corgi",
  "signingKey": "/Users/you/.config/corgi/release-key.pem",
  "credentialsFile": "/Users/you/.config/corgi/r2-credentials.json",
  "codesignIdentity": "Developer ID Application: Your Name (TEAMID)"
}
```

The credentials file contains `accessKeyId` and `secretAccessKey`; make it private
with `chmod 600`. Alternatively, set both `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`; a complete environment pair takes precedence.

The public URL must serve the bucket root over HTTPS without authentication.
Honor the `no-cache` headers on `channels/*` and `install.sh`.
Optional `notaryProfile` enables notarization. Optional `sentry` supplies `dsn`,
`org` and `project`; publishing then needs an authenticated `sentry-cli` to upload
debug symbols. Configuration fields live in [scripts/release.ts](../scripts/release.ts).

## Release checklist

1. Commit the changes to ship. Review compatibility changes using
   [HACKING.md](../HACKING.md).
2. Check the selected commit and output paths with `./publish.sh --dry-run`.
3. Run `./publish.sh`. It tests, builds, signs and verifies the public downloads
   before advancing the stable channel. Wait for the final `Published Corgi` message.
4. From an installed copy, run `corgi update --check` to confirm the offered release.

Versions are immutable; never reuse a version for different bytes or casually
replace the signing key trusted by existing installations. Published versions
remain available for existing installers and rollback.

Local binaries and debug symbols stay under `.git/corgi-releases/` (the common
Git directory for linked worktrees). Keep the symbols needed for crash diagnosis.
For build-only and retry options, use `./publish.sh --help`.
