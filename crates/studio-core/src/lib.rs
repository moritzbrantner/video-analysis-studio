mod data_sources;
mod error;
mod media;
mod report;
mod run_manager;
mod song;
mod subtitles;
mod system;
mod youtube;

pub use data_sources::{
    data_source_catalog_path, editable_inline_body, migrate_legacy_data_sources,
    validate_data_source_id, DataSourceCatalog, DataSourceDerivationInput,
    DataSourceDerivationKind, DataSourceKind, DataSourceOrigin, DataSourceRecord, DataSourceUpsert,
    DATA_SOURCE_CATALOG_FORMAT, DATA_SOURCE_CATALOG_VERSION,
};
pub use error::{Result, StudioError};
pub use report::*;
pub use run_manager::{
    RunEvent, RunId, RunManager, RunRecord, RunStatus, WorkflowKind, WorkflowProgress,
};
pub use song::{
    import_song_catalog_items, run_song_analysis_workflow, MusicAnalysisConfig,
    SongAnalysisRunRequest, SongCatalogConfig, SongCatalogImportItem, SongCatalogImportRequest,
    SongCatalogImportResponse, SongCatalogImportResult, SongIdentificationConfig, SongSourceSpec,
};
pub use subtitles::{run_subtitle_generation_workflow, SubtitleGenerationRunRequest};
pub use system::{
    check_system_dependencies, transcription_catalog, DependencyStatus, SystemDependencyReport,
    TranscriptionCatalog, TranscriptionEngineStatus,
};
pub use video_analysis_use_cases::workflow_catalog::{
    default_workflow_catalog, ports_compatible, workflow_types_assignable, NodeSpec,
    PortCompatibility, PortKind, PortSpec, WorkflowCatalog, WorkflowCategory, WorkflowInputSurface,
    WorkflowObjectProperty, WorkflowRuntimeValidation, WorkflowSemanticKind, WorkflowTypeSpec,
};
pub use youtube::{
    discover_youtube_collection_manifest, run_youtube_collection_workflow,
    run_youtube_video_workflow, AlreadyDownloadedPolicy, ExternalCommandConfig,
    FailedProbeBehavior, LocalFileFilterSpec, ManifestFilterSpec, MetadataDepth,
    ModelCommandConfig, SourceSpec, TranscriptionConfig, TranscriptionEngine, WhisperCppConfig,
    WhisperCppModel, YoutubeCollectionManifest, YoutubeCollectionManifestItem,
    YoutubeCollectionManifestRequest, YoutubeCollectionRunRequest, YoutubeCollectionSource,
    YoutubeRunOptions, YoutubeRunRequest,
};
