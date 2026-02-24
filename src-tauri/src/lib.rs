use std::{
    net::TcpStream,
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;

            // Paths passed to the server sidecar so it can serve the right files.
            let client_dist = resource_dir.join("client-dist");
            let tmp_dir = resource_dir.join("tmp");

            // Path to the esbuild-bundled server JS file shipped as a Tauri resource.
            let server_bundle = resource_dir.join("server-bundle.js");

            // Spawn portable node.exe (the sidecar) with the bundled JS as its argument.
            // Tauri automatically resolves "server" to the target-triple-suffixed
            // binary (e.g. server-x86_64-pc-windows-msvc.exe) from the bundle.
            let data_dir = resource_dir.join("data");

            app.shell()
                .sidecar("server")?
                .args([server_bundle.to_str().unwrap_or("")])
                .env("RAGE_PAD_CLIENT_DIST", client_dist.to_str().unwrap_or(""))
                .env("RAGE_PAD_TMP_DIR", tmp_dir.to_str().unwrap_or(""))
                .env("RAGE_PAD_DATA_DIR", data_dir.to_str().unwrap_or(""))
                .spawn()?;

            // Wait for the server to be reachable before showing the window,
            // so users never see an error page on startup.
            let window = app
                .get_webview_window("main")
                .expect("main window not found");

            thread::spawn(move || {
                wait_for_port(3000, 30);

                // Reload now that the server is up (the webview may have cached
                // a connection-refused error page while we were waiting).
                let _ = window.eval("window.location.reload()");
                let _ = window.show();
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Poll `127.0.0.1:{port}` until a TCP connection succeeds or `timeout_secs` elapses.
fn wait_for_port(port: u16, timeout_secs: u64) {
    let addr = format!("127.0.0.1:{}", port);
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    while Instant::now() < deadline {
        if TcpStream::connect(&addr).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
}
