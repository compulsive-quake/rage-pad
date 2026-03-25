use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE,
    MapVirtualKeyW, MAPVK_VK_TO_VSC,
};

/// Manages push-to-talk key simulation synchronized with audio playback.
pub struct PttState {
    /// The virtual key code to hold (0 = disabled).
    vk_code: Arc<AtomicU16>,
    /// Whether the key is currently held down.
    key_held: Arc<AtomicBool>,
    /// Whether the watcher thread is running.
    watcher_running: Arc<AtomicBool>,
}

impl PttState {
    pub fn new() -> Self {
        Self {
            vk_code: Arc::new(AtomicU16::new(0)),
            key_held: Arc::new(AtomicBool::new(false)),
            watcher_running: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Set the PTT key and start the watcher thread that monitors playback state.
    pub fn set_key(&self, virtual_key_code: u16, playing: Arc<AtomicBool>) {
        // Release any currently held key first.
        self.release_key();

        self.vk_code.store(virtual_key_code, Ordering::Release);

        // Start watcher thread if not already running.
        if !self.watcher_running.load(Ordering::Acquire) {
            self.watcher_running.store(true, Ordering::Release);

            let vk = Arc::clone(&self.vk_code);
            let held = Arc::clone(&self.key_held);
            let running = Arc::clone(&self.watcher_running);
            let playing = playing;

            thread::spawn(move || {
                let mut was_playing = false;

                while running.load(Ordering::Acquire) {
                    let is_playing = playing.load(Ordering::Acquire);

                    if was_playing && !is_playing && held.load(Ordering::Acquire) {
                        // Playback just ended — small delay to allow a rapid
                        // back-to-back play to re-assert the key before we
                        // release it.
                        thread::sleep(Duration::from_millis(50));

                        // Re-check: if a new play started in the meantime,
                        // don't release.
                        if !playing.load(Ordering::Acquire) {
                            let code = vk.load(Ordering::Acquire);
                            if code != 0 {
                                send_key(code, true);
                                held.store(false, Ordering::Release);
                            }
                        }
                    }

                    was_playing = is_playing;
                    thread::sleep(Duration::from_millis(30));
                }

                // Clean up: release key if still held.
                if held.load(Ordering::Acquire) {
                    let code = vk.load(Ordering::Acquire);
                    if code != 0 {
                        send_key(code, true);
                        held.store(false, Ordering::Release);
                    }
                }
            });
        }
    }

    /// Clear the PTT key and stop the watcher.
    pub fn clear_key(&self) {
        self.release_key();
        self.vk_code.store(0, Ordering::Release);
        self.watcher_running.store(false, Ordering::Release);
    }

    /// Press the PTT key (called when playback starts).
    pub fn press_key(&self) {
        let code = self.vk_code.load(Ordering::Acquire);
        if code != 0 {
            send_key(code, false);
            self.key_held.store(true, Ordering::Release);
        }
    }

    /// Release the PTT key if held.
    pub fn release_key(&self) {
        if self.key_held.load(Ordering::Acquire) {
            let code = self.vk_code.load(Ordering::Acquire);
            if code != 0 {
                send_key(code, true);
            }
            self.key_held.store(false, Ordering::Release);
        }
    }

    /// Whether a PTT key is configured.
    pub fn is_enabled(&self) -> bool {
        self.vk_code.load(Ordering::Acquire) != 0
    }
}

impl Drop for PttState {
    fn drop(&mut self) {
        self.clear_key();
    }
}

/// Send a key press or release using the Windows SendInput API.
/// Uses scan codes (KEYEVENTF_SCANCODE) for maximum game compatibility.
fn send_key(vk_code: u16, key_up: bool) {
    let scan_code = unsafe { MapVirtualKeyW(vk_code as u32, MAPVK_VK_TO_VSC) } as u16;

    if scan_code == 0 {
        eprintln!("[ptt] WARNING: MapVirtualKeyW returned scan_code=0 for vk=0x{:02X}", vk_code);
    }

    let mut flags = KEYEVENTF_SCANCODE;
    if key_up {
        flags |= KEYEVENTF_KEYUP;
    }

    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: 0, // Using scan code mode
                wScan: scan_code,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let result = unsafe {
        SendInput(1, &input, std::mem::size_of::<INPUT>() as i32)
    };
}
