use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // When a second instance tries to launch, forward file paths to the running instance
            let files: Vec<String> = argv
                .iter()
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
                .collect();

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
            // On initial launch, check for file arguments
            let args: Vec<String> = std::env::args().collect();
            let files: Vec<String> = args
                .iter()
                .skip(1)
                .filter(|arg| !arg.starts_with('-'))
                .filter(|arg| {
                    let lower = arg.to_lowercase();
                    lower.ends_with(".md")
                        || lower.ends_with(".markdown")
                        || lower.ends_with(".mdx")
                        || lower.ends_with(".txt")
                })
                .cloned()
                .collect();

            if !files.is_empty() {
                let handle = app.handle().clone();
                // Emit after a short delay so the frontend is ready
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let _ = handle.emit("open-files", files);
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
