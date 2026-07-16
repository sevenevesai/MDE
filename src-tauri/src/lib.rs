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
        .plugin(tauri_plugin_process::init())
        // Restore position/size but NOT visibility — the window starts hidden
        // (visible:false) and is shown by hand on frontend-ready to kill the
        // startup flash; letting window-state restore visibility would re-show
        // it early before the UI has painted.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE)
                .build(),
        )
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
            // Auto-updater is desktop-only; register it here so mobile targets skip it.
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // On initial launch, check for file arguments and stash them
            let args: Vec<String> = std::env::args().collect();
            let files = extract_file_args(&args);

            let pending = Mutex::new(Some(files));
            let listener_handle = app.handle().clone();
            let handle = app.handle().clone();

            // The window is created hidden (visible:false). When the frontend
            // signals it has painted, show + focus it (no startup flash) and
            // flush any pending file-open arguments to it.
            listener_handle.listen("frontend-ready", move |_| {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                if let Ok(mut guard) = pending.lock() {
                    if let Some(files) = guard.take() {
                        if !files.is_empty() {
                            let _ = handle.emit("open-files", files);
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
