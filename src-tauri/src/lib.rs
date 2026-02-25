use std::{
    fs,
    io::Write,
    net::TcpStream,
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;

            // Read-only bundled assets live in the install / resource directory.
            let client_dist = resource_dir.join("client-dist");
            let server_bundle = resource_dir.join("server-bundle.js");

            // Writable directories go under %APPDATA% (app_data_dir) so we don't
            // need admin rights when installed to Program Files.
            let app_data = app.path().app_data_dir()?;
            let data_dir = app_data.join("data");
            let tmp_dir = app_data.join("tmp");

            // Ensure writable directories exist before spawning.
            fs::create_dir_all(&data_dir)?;
            fs::create_dir_all(&tmp_dir)?;

            // yt-dlp binary lives next to server-bundle.js in the resource dir
            let yt_dlp_path = resource_dir.join("yt-dlp.exe");

            let (mut rx, _child) = app
                .shell()
                .sidecar("ragepad-server")?
                .args([server_bundle.to_str().unwrap_or("")])
                .env("RAGE_PAD_CLIENT_DIST", client_dist.to_str().unwrap_or(""))
                .env("RAGE_PAD_TMP_DIR", tmp_dir.to_str().unwrap_or(""))
                .env("RAGE_PAD_DATA_DIR", data_dir.to_str().unwrap_or(""))
                .env("RAGE_PAD_YT_DLP", yt_dlp_path.to_str().unwrap_or(""))
                .spawn()?;

            // Drain sidecar stdout/stderr into a log file for debugging.
            // When the server process terminates, exit the Tauri app as well
            // (e.g. the server exits after launching an update installer).
            let log_path = data_dir.join("server.log");
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut file = fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                    .ok();
                while let Some(event) = rx.recv().await {
                    if let Some(ref mut f) = file {
                        match &event {
                            CommandEvent::Stdout(line) => {
                                let _ = writeln!(f, "[stdout] {}", String::from_utf8_lossy(line));
                            }
                            CommandEvent::Stderr(line) => {
                                let _ = writeln!(f, "[stderr] {}", String::from_utf8_lossy(line));
                            }
                            CommandEvent::Terminated(payload) => {
                                let _ = writeln!(
                                    f,
                                    "[terminated] code={:?} signal={:?}",
                                    payload.code, payload.signal
                                );
                                // Server exited — quit the Tauri app
                                app_handle.exit(0);
                            }
                            CommandEvent::Error(err) => {
                                let _ = writeln!(f, "[error] {}", err);
                            }
                            _ => {}
                        }
                    }
                }
            });

            // Wait for the server to be reachable before showing the window,
            // so users never see an error page on startup.
            let window = app
                .get_webview_window("main")
                .expect("main window not found");

            thread::spawn(move || {
                wait_for_port(8088, 30);

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
