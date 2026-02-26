use cpal::traits::{DeviceTrait, HostTrait};

/// Return the names of all available audio input (capture) devices.
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devices| {
            devices
                .filter_map(|d| d.name().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Return the names of all available audio output (render) devices.
pub fn list_output_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.output_devices()
        .map(|devices| {
            devices
                .filter_map(|d| d.name().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Find an input device whose name exactly matches `name`.
pub fn find_input_device(name: &str) -> Option<cpal::Device> {
    let host = cpal::default_host();
    host.input_devices().ok()?.find(|d| {
        d.name().map(|n| n == name).unwrap_or(false)
    })
}

/// Find an output device whose name exactly matches `name`.
pub fn find_output_device(name: &str) -> Option<cpal::Device> {
    let host = cpal::default_host();
    host.output_devices().ok()?.find(|d| {
        d.name().map(|n| n == name).unwrap_or(false)
    })
}

/// Return the default input device, if any.
pub fn default_input_device() -> Option<cpal::Device> {
    let host = cpal::default_host();
    host.default_input_device()
}

/// Return the default output device, if any.
pub fn default_output_device() -> Option<cpal::Device> {
    let host = cpal::default_host();
    host.default_output_device()
}
