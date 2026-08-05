# Vendored third-party sources

## `alacritty_terminal/` — 0.26.0, patched

Upstream: https://crates.io/crates/alacritty_terminal (Apache-2.0)
Source archive: https://static.crates.io/crates/alacritty_terminal/alacritty_terminal-0.26.0.crate

### Why it is vendored

`alacritty_terminal` cannot be built for `wasm32-unknown-unknown` as published.
It declares `home`, `polling`, and `libc` as **unconditional** dependencies —
there is no `[target."cfg(unix)")]` gate and no feature flag to opt out — so
Cargo builds them for every target. `home-0.5.12` fails first, on any target
that is neither Unix nor Windows:

    error[E0425]: cannot find function `home_dir_inner` in the crate root

Those three dependencies exist only for the `tty`, `event_loop`, and `thread`
modules, which spawn and poll a real PTY. Cadencr does not use them: the PTY
lives in the Rust service (`packages/service/src/domain/neovim/`), and this
copy is used purely as an in-browser ANSI-to-grid engine.

### The patch, in full

1. `src/lib.rs` — removed three module declarations:
   `pub mod event_loop;`, `pub mod thread;`, `pub mod tty;`
2. `Cargo.toml` — removed the `home`, `libc`, and `polling` dependencies, the
   `[[test]]` section, and every `[target."cfg(unix)"...]` /
   `[target."cfg(windows)"...]` section.
3. Deleted the `tests/` directory (its fixtures are not shipped in the
   published `.crate`).

Nothing else is modified. `Term`, `Grid`, scrollback, cell attributes, and the
alternate screen are untouched and behave exactly as upstream.

### Upgrading

Re-download the new version, delete `tests/`, and re-apply the two edits above.
If upstream ever gates those modules behind a feature, drop this vendor and
depend on crates.io directly.
