use std::fs::File;
use std::io::BufReader;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use rodio::Decoder;

use crate::devices;

// ---------------------------------------------------------------------------
// Ring buffer used to ferry samples between threads
// ---------------------------------------------------------------------------

/// A simple lock-free-ish single-producer / single-consumer ring buffer for f32
/// samples.  Both the capture callback and the output callback run on
/// real-time audio threads so we avoid allocations and use atomics for the
/// cursors.
struct RingBuffer {
    buf: Vec<f32>,
    /// Write cursor (producer: capture thread).
    write: std::sync::atomic::AtomicUsize,
    /// Read cursor (consumer: output thread).
    read: std::sync::atomic::AtomicUsize,
}

impl RingBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            buf: vec![0.0; capacity],
            write: std::sync::atomic::AtomicUsize::new(0),
            read: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    /// Number of samples available for reading.
    fn available(&self) -> usize {
        let w = self.write.load(Ordering::Acquire);
        let r = self.read.load(Ordering::Acquire);
        if w >= r {
            w - r
        } else {
            self.buf.len() - r + w
        }
    }

    /// Push samples into the ring buffer.  Drops oldest samples on overflow.
    fn push(&self, samples: &[f32]) {
        let cap = self.buf.len();
        let mut w = self.write.load(Ordering::Acquire);
        // SAFETY: we are the only writer so &mut access to buf[w] is safe.
        let buf_ptr = self.buf.as_ptr() as *mut f32;
        for &s in samples {
            unsafe { *buf_ptr.add(w) = s };
            w = (w + 1) % cap;
        }
        self.write.store(w, Ordering::Release);
    }

    /// Pop up to `out.len()` samples.  Returns the number actually read.
    fn pop(&self, out: &mut [f32]) -> usize {
        let avail = self.available();
        let n = out.len().min(avail);
        let cap = self.buf.len();
        let mut r = self.read.load(Ordering::Acquire);
        for sample in out.iter_mut().take(n) {
            *sample = self.buf[r];
            r = (r + 1) % cap;
        }
        self.read.store(r, Ordering::Release);
        n
    }
}

// ---------------------------------------------------------------------------
// File playback source that can be read from the output callback
// ---------------------------------------------------------------------------

/// Holds a decoded audio file and the state needed to read it sample-by-sample.
struct FilePlayback {
    /// Decoded samples (mono f32, resampled to match the output config).
    samples: Vec<f32>,
    /// Current read position.
    position: usize,
    /// Per-file volume multiplier (0.0 .. 1.0).
    volume: f32,
}

impl FilePlayback {
    /// Read up to `n` samples, mixed (added) into `out`.  Returns `true` while
    /// there are still samples remaining.
    fn mix_into(&mut self, out: &mut [f32]) -> bool {
        for sample in out.iter_mut() {
            if self.position >= self.samples.len() {
                return false;
            }
            *sample += self.samples[self.position] * self.volume;
            self.position += 1;
        }
        true
    }
}

// ---------------------------------------------------------------------------
// Public mixer API
// ---------------------------------------------------------------------------

pub struct MixerState {
    // --- device names --------------------------------------------------
    pub input_device_name: Option<String>,
    pub output_device_name: Option<String>,

    // --- transport flags -----------------------------------------------
    pub playing: Arc<AtomicBool>,
    pub paused: Arc<AtomicBool>,

    // --- volume --------------------------------------------------------
    /// Master volume shared with the output callback.
    pub volume: Arc<Mutex<f32>>,

    // --- streams (kept alive so WASAPI doesn't close them) -------------
    capture_stream: Option<Stream>,
    output_stream: Option<Stream>,

    // --- ring buffer carrying mic samples from capture -> output -------
    ring: Arc<RingBuffer>,

    // --- currently playing file ----------------------------------------
    file_playback: Arc<Mutex<Option<FilePlayback>>>,
}

impl MixerState {
    /// Create a new, idle mixer.  No streams are opened yet.
    pub fn new() -> Self {
        // 48000 samples/sec * 2 channels * 0.5 sec = 48 000 -- generous headroom
        let ring_capacity = 48_000;
        Self {
            input_device_name: None,
            output_device_name: None,
            playing: Arc::new(AtomicBool::new(false)),
            paused: Arc::new(AtomicBool::new(false)),
            volume: Arc::new(Mutex::new(1.0)),
            capture_stream: None,
            output_stream: None,
            ring: Arc::new(RingBuffer::new(ring_capacity)),
            file_playback: Arc::new(Mutex::new(None)),
        }
    }

    // ---- device selection ---------------------------------------------

    /// Open a WASAPI capture stream from the named input device.
    pub fn start_capture(&mut self) -> Result<(), String> {
        // Drop old stream first.
        self.capture_stream = None;

        let device = match &self.input_device_name {
            Some(name) => devices::find_input_device(name)
                .ok_or_else(|| format!("Input device not found: {name}"))?,
            None => devices::default_input_device()
                .ok_or_else(|| "No default input device available".to_string())?,
        };

        let config = default_stream_config_for(&device, true)?;

        let ring = Arc::clone(&self.ring);
        let paused = Arc::clone(&self.paused);

        let stream = device
            .build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if paused.load(Ordering::Relaxed) {
                        return;
                    }
                    ring.push(data);
                },
                |err| {
                    eprintln!("[capture error] {err}");
                },
                None,
            )
            .map_err(|e| format!("Failed to build input stream: {e}"))?;

        stream.play().map_err(|e| format!("Failed to start capture: {e}"))?;
        self.capture_stream = Some(stream);
        Ok(())
    }

    /// Open a WASAPI render stream to the named output device (e.g. VB-Cable Input).
    pub fn start_output(&mut self) -> Result<(), String> {
        self.output_stream = None;

        let device = match &self.output_device_name {
            Some(name) => devices::find_output_device(name)
                .ok_or_else(|| format!("Output device not found: {name}"))?,
            None => devices::default_output_device()
                .ok_or_else(|| "No default output device available".to_string())?,
        };

        let config = default_stream_config_for(&device, false)?;

        let ring = Arc::clone(&self.ring);
        let file_playback = Arc::clone(&self.file_playback);
        let volume = Arc::clone(&self.volume);
        let playing = Arc::clone(&self.playing);
        let paused = Arc::clone(&self.paused);

        let stream = device
            .build_output_stream(
                &config.into(),
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    // Zero out the buffer first.
                    for s in data.iter_mut() {
                        *s = 0.0;
                    }

                    if paused.load(Ordering::Relaxed) {
                        return;
                    }

                    // 1. Pull mic samples from the ring buffer and write them
                    //    directly into the output buffer.
                    ring.pop(data);

                    // 2. If a file is playing, mix (add) its samples on top.
                    if playing.load(Ordering::Relaxed) {
                        if let Ok(mut guard) = file_playback.try_lock() {
                            if let Some(ref mut fp) = *guard {
                                let still_going = fp.mix_into(data);
                                if !still_going {
                                    *guard = None;
                                    // We cannot easily clear the atomic from
                                    // inside the callback without a race, but
                                    // the main thread polls `file_playback` to
                                    // detect end-of-file too.
                                }
                            }
                        }
                    }

                    // 3. Apply master volume.
                    if let Ok(vol) = volume.try_lock() {
                        let v = *vol;
                        if (v - 1.0).abs() > f32::EPSILON {
                            for s in data.iter_mut() {
                                *s *= v;
                            }
                        }
                    }

                    // 4. Clamp to [-1, 1] to avoid clipping distortion.
                    for s in data.iter_mut() {
                        *s = s.clamp(-1.0, 1.0);
                    }
                },
                |err| {
                    eprintln!("[output error] {err}");
                },
                None,
            )
            .map_err(|e| format!("Failed to build output stream: {e}"))?;

        stream.play().map_err(|e| format!("Failed to start output: {e}"))?;
        self.output_stream = Some(stream);
        Ok(())
    }

    // ---- file playback ------------------------------------------------

    /// Decode an audio file and start mixing it into the output stream.
    pub fn play_file(&mut self, path: &str, file_volume: f32) -> Result<(), String> {
        let file = File::open(path).map_err(|e| format!("Cannot open file: {e}"))?;
        let reader = BufReader::new(file);
        let decoder =
            Decoder::new(reader).map_err(|e| format!("Cannot decode audio file: {e}"))?;

        // Collect all samples as f32.  rodio's Decoder yields i16 by default
        // but implements Iterator<Item = i16> -- we convert to f32 normalised
        // to [-1, 1].
        let samples: Vec<f32> = decoder.map(|s| s as f32 / i16::MAX as f32).collect();

        let playback = FilePlayback {
            samples,
            position: 0,
            volume: file_volume.clamp(0.0, 1.0),
        };

        *self.file_playback.lock().map_err(|e| e.to_string())? = Some(playback);
        self.playing.store(true, Ordering::Release);
        Ok(())
    }

    /// Stop file playback immediately.
    pub fn stop(&mut self) {
        self.playing.store(false, Ordering::Release);
        if let Ok(mut guard) = self.file_playback.lock() {
            *guard = None;
        }
    }

    /// Pause both mic pass-through and file playback.
    pub fn pause(&self) {
        self.paused.store(true, Ordering::Release);
    }

    /// Resume after a pause.
    pub fn resume(&self) {
        self.paused.store(false, Ordering::Release);
    }

    /// Set master output volume (0.0 .. 1.0).
    pub fn set_volume(&self, vol: f32) {
        if let Ok(mut v) = self.volume.lock() {
            *v = vol.clamp(0.0, 1.0);
        }
    }

    /// Return `true` if a sound file is currently being played.
    pub fn is_playing(&self) -> bool {
        // Check whether the playback source still has data.  The atomic flag
        // may lag behind by one buffer, so also peek at the actual source.
        if !self.playing.load(Ordering::Acquire) {
            return false;
        }
        if let Ok(guard) = self.file_playback.try_lock() {
            if guard.is_none() {
                self.playing.store(false, Ordering::Release);
                return false;
            }
        }
        true
    }
}

// ---------------------------------------------------------------------------
// Helper: pick a good default stream config for a device
// ---------------------------------------------------------------------------

fn default_stream_config_for(
    device: &Device,
    is_input: bool,
) -> Result<StreamConfig, String> {
    let supported = if is_input {
        device
            .default_input_config()
            .map_err(|e| format!("No supported input stream config: {e}"))?
    } else {
        device
            .default_output_config()
            .map_err(|e| format!("No supported output stream config: {e}"))?
    };

    // We always request f32 samples to keep the mixing simple.
    if supported.sample_format() != SampleFormat::F32 {
        // cpal will convert for us on most backends, but log a note.
        eprintln!(
            "[info] device native format is {:?}, requesting f32",
            supported.sample_format()
        );
    }

    Ok(StreamConfig {
        channels: supported.channels(),
        sample_rate: supported.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    })
}
