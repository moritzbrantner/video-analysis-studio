mod error;
mod media;
mod report;
mod run_manager;
mod song;
mod subtitles;
mod system;
mod youtube;

pub use error::{Result, StudioError};
pub use report::*;
pub use run_manager::{RunEvent, RunId, RunManager, RunRecord, RunStatus, WorkflowKind};
pub use song::{
    import_song_catalog_items, run_song_analysis_workflow, MusicAnalysisConfig,
    SongAnalysisRunRequest, SongCatalogConfig, SongCatalogImportItem, SongCatalogImportRequest,
    SongCatalogImportResponse, SongCatalogImportResult, SongIdentificationConfig, SongSourceSpec,
};
pub use subtitles::{run_subtitle_generation_workflow, SubtitleGenerationRunRequest};
pub use system::{check_system_dependencies, DependencyStatus, SystemDependencyReport};
pub use youtube::{
    discover_youtube_collection_manifest, run_youtube_collection_workflow,
    run_youtube_video_workflow, AlreadyDownloadedPolicy, ExternalCommandConfig,
    FailedProbeBehavior, LocalFileFilterSpec, ManifestFilterSpec, MetadataDepth,
    ModelCommandConfig, SourceSpec, TranscriptionConfig, YoutubeCollectionManifest,
    YoutubeCollectionManifestItem, YoutubeCollectionManifestRequest, YoutubeCollectionRunRequest,
    YoutubeCollectionSource, YoutubeRunOptions, YoutubeRunRequest,
};
