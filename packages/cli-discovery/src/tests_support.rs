//! Shared helpers for the crate's inline unit tests.
//!
//! Compiled only under `cfg(test)`. Production code never references this
//! module. It exists solely so the per-module `#[cfg(test)]` blocks can reuse
//! the same fixture builders instead of duplicating them.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use crate::types::DiscoverySpec;

pub(crate) fn make_executable_with_body(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, body).unwrap();
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).unwrap();
    path
}

pub(crate) fn dummy_spec() -> DiscoverySpec {
    DiscoverySpec::builder()
        .bin_name("thing")
        .well_known_relative_to_home(vec![".thing/local"])
        .well_known_absolute(Vec::new())
        .version_args(&["--version"])
        .build()
}
