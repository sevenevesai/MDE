use std::sync::Mutex;
use tauri::{Emitter, Listener, Manager};

/// Extract markdown/text file paths from an argument list.
fn extract_file_args(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1) // skip the exe path
        .filter(|arg| !arg.starts_with('-')) // skip flags
        .filter(|arg| {
            let lower = arg.to_lowercase();
            lower.ends_with(".md")
                || lower.ends_with(".markdown")
                || lower.ends_with(".mdx")
                || lower.ends_with(".txt")
        })
        .cloned()
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Second instance: forward file paths to the running instance
            let files = extract_file_args(&argv);
            if !files.is_empty() {
                let _ = app.emit("open-files", files);
            }

            // Focus the existing window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .setup(|app| {
            // On initial launch, check for file arguments and stash them
            let args: Vec<String> = std::env::args().collect();
            let files = extract_file_args(&args);

            if !files.is_empty() {
                let pending = Mutex::new(Some(files));
                let listener_handle = app.handle().clone();
                let emitter_handle = app.handle().clone();

                // When the frontend signals it's ready, emit the files
                listener_handle.listen("frontend-ready", move |_| {
                    if let Ok(mut guard) = pending.lock() {
                        if let Some(files) = guard.take() {
                            let _ = emitter_handle.emit("open-files", files);
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
