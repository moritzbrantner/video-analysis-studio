use std::env;
use std::ffi::OsString;
use std::fs;
use std::io;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

fn path_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub(crate) struct PathGuard {
    _lock: MutexGuard<'static, ()>,
    original: Option<OsString>,
}

impl Drop for PathGuard {
    fn drop(&mut self) {
        if let Some(value) = &self.original {
            env::set_var("PATH", value);
        } else {
            env::remove_var("PATH");
        }
    }
}

pub(crate) fn prepend_path(dir: &Path) -> PathGuard {
    let lock = path_lock().lock().unwrap();
    let original = env::var_os("PATH");
    let joined = env::join_paths(
        std::iter::once(dir.to_path_buf()).chain(
            original
                .as_ref()
                .into_iter()
                .flat_map(|value| env::split_paths(value)),
        ),
    )
    .unwrap();
    env::set_var("PATH", joined);
    PathGuard {
        _lock: lock,
        original,
    }
}

pub(crate) fn write_executable(dir: &Path, name: &str, body: &str) -> io::Result<PathBuf> {
    let path = dir.join(name);
    fs::write(&path, body)?;
    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(&path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions)?;
    }
    Ok(path)
}
