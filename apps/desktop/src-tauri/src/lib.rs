mod commands;

use std::path::PathBuf;

use commands::{
    cancel_run, check_dependencies, create_data_source, create_data_source_derivation,
    delete_data_source, discover_youtube_collection_manifest_command, get_report, get_run,
    get_run_events, get_transcription_catalog, get_workflow_catalog, import_song_catalog_items,
    list_data_sources, start_song_analysis_run, start_subtitle_generation_run,
    start_video_red_cars_run, start_youtube_collection_run, start_youtube_video_run,
    update_data_source, StudioState,
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
            get_workflow_catalog,
            get_transcription_catalog,
            list_data_sources,
            create_data_source,
            update_data_source,
            delete_data_source,
            create_data_source_derivation,
            discover_youtube_collection_manifest_command,
            start_youtube_video_run,
            start_video_red_cars_run,
            start_youtube_collection_run,
            start_song_analysis_run,
            start_subtitle_generation_run,
            import_song_catalog_items,
            get_run,
            get_report,
            get_run_events,
            cancel_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running Video Analysis Studio");
}
