use serde::{Deserialize, Serialize};

fn default_volume() -> f32 {
    1.0
}

/// Commands sent from the Node.js server to the audio engine via stdin (JSON, one per line).
#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Command {
    /// Enumerate all available audio input and output devices.
    ListDevices,

    /// Select the WASAPI capture (input) device by name.
    SetInputDevice { device_name: String },

    /// Select the WASAPI render (output) device by name (typically VB-Cable Input).
    SetOutputDevice { device_name: String },

    /// Decode and play an audio file, mixed on top of the live microphone capture.
    Play {
        file_path: String,
        #[serde(default = "default_volume")]
        volume: f32,
    },

    /// Stop all playback immediately.
    Stop,

    /// Pause both capture pass-through and file playback.
    Pause,

    /// Resume after a pause.
    Resume,

    /// Change the master output volume (0.0 .. 1.0).
    SetVolume { volume: f32 },

    /// Query the current mixer state.
    GetStatus,

    /// Gracefully shut down the audio engine process.
    Shutdown,
}

/// Responses sent from the audio engine back to Node.js via stdout (JSON, one per line).
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Response {
    /// List of available devices.
    Devices {
        input: Vec<String>,
        output: Vec<String>,
    },

    /// Generic success acknowledgement.
    Ok,

    /// Current mixer status.
    Status {
        playing: bool,
        paused: bool,
        volume: f32,
        input_device: Option<String>,
        output_device: Option<String>,
    },

    /// An error occurred while processing a command.
    Error { message: String },
}

impl Response {
    /// Convenience constructor for error responses.
    pub fn error(msg: impl Into<String>) -> Self {
        Response::Error {
            message: msg.into(),
        }
    }
}
