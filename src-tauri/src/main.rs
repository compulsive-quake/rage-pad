// Prevents an additional console window from appearing in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ragepad_lib::run()
}
