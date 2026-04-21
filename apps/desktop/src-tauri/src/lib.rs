mod commands;

use std::path::PathBuf;

use commands::{
    cancel_run, check_dependencies, get_report, get_run, start_youtube_video_run, StudioState,
};
use studio_core::RunManager;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("./studio-data"));
            app.manage(StudioState {
                manager: RunManager::new(data_dir),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_dependencies,
            start_youtube_video_run,
            get_run,
            get_report,
            cancel_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running Video Analysis Studio");
}
