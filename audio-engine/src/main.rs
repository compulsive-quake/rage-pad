mod devices;
mod mixer;
mod protocol;

use std::io::{self, BufRead, Write};
use std::panic;

use protocol::{Command, Response};

fn main() {
    // Install a custom panic hook that writes an Error response to stdout
    // instead of printing the default panic message to stderr.  This ensures
    // the Node.js parent process always gets a JSON line it can parse.
    let default_hook = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic".to_string()
        };
        let resp = Response::Error { message };
        if let Ok(json) = serde_json::to_string(&resp) {
            let _ = writeln!(io::stdout().lock(), "{json}");
        }
        // Also run the default hook so we get a backtrace on stderr for
        // debugging.
        default_hook(info);
    }));

    // ---- initialise mixer ---------------------------------------------
    let mut mixer = mixer::MixerState::new();

    // ---- main command loop --------------------------------------------
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                let _ = write_response(&mut stdout, Response::error(format!("stdin read error: {e}")));
                continue;
            }
        };

        // Skip empty lines gracefully.
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let cmd: Command = match serde_json::from_str(trimmed) {
            Ok(c) => c,
            Err(e) => {
                let _ = write_response(
                    &mut stdout,
                    Response::error(format!("Invalid JSON command: {e}")),
                );
                continue;
            }
        };

        let response = handle_command(&mut mixer, cmd);

        // A `None` return means the Shutdown command was received.
        match response {
            Some(resp) => {
                if write_response(&mut stdout, resp).is_err() {
                    break;
                }
            }
            None => {
                // Acknowledge shutdown, then exit.
                let _ = write_response(&mut stdout, Response::Ok);
                break;
            }
        }
    }
}

/// Dispatch a parsed command to the appropriate mixer / device function.
/// Returns `None` when the engine should shut down.
fn handle_command(mixer: &mut mixer::MixerState, cmd: Command) -> Option<Response> {
    match cmd {
        Command::ListDevices => {
            let input = devices::list_input_devices();
            let output = devices::list_output_devices();
            Some(Response::Devices { input, output })
        }

        Command::SetInputDevice { device_name } => {
            mixer.input_device_name = Some(device_name);
            match mixer.start_capture() {
                Ok(()) => Some(Response::Ok),
                Err(e) => Some(Response::error(e)),
            }
        }

        Command::SetOutputDevice { device_name } => {
            mixer.output_device_name = Some(device_name);
            match mixer.start_output() {
                Ok(()) => Some(Response::Ok),
                Err(e) => Some(Response::error(e)),
            }
        }

        Command::Play { file_path, volume } => match mixer.play_file(&file_path, volume) {
            Ok(()) => Some(Response::Ok),
            Err(e) => Some(Response::error(e)),
        },

        Command::Stop => {
            mixer.stop();
            Some(Response::Ok)
        }

        Command::Pause => {
            mixer.pause();
            Some(Response::Ok)
        }

        Command::Resume => {
            mixer.resume();
            Some(Response::Ok)
        }

        Command::SetVolume { volume } => {
            mixer.set_volume(volume);
            Some(Response::Ok)
        }

        Command::GetStatus => {
            let vol = mixer.volume.lock().map(|v| *v).unwrap_or(1.0);
            Some(Response::Status {
                playing: mixer.is_playing(),
                paused: mixer.paused.load(std::sync::atomic::Ordering::Acquire),
                volume: vol,
                input_device: mixer.input_device_name.clone(),
                output_device: mixer.output_device_name.clone(),
            })
        }

        Command::Shutdown => None,
    }
}

/// Serialize a response as a single JSON line on stdout.
fn write_response(out: &mut impl Write, resp: Response) -> io::Result<()> {
    let json = serde_json::to_string(&resp).map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    writeln!(out, "{json}")?;
    out.flush()
}
