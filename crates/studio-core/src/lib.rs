extern crate self as text_analysis_features;
extern crate self as text_analysis_transcription;

use std::path::Path;

pub use audio_analysis_transcription::{
    whisper_cpp_catalog, whisper_cpp_system_info, WhisperCppCatalog, WhisperCppConfig,
    WhisperCppError, WhisperCppModel, WhisperCppPhase, WhisperCppProgressEvent,
    WhisperCppTranscription,
};
pub use text_transcripts::{
    segment_to_owned_text_segment, write_srt, TranscriptHeuristicAnalyzer, TranscriptSegment,
};

/// Compatibility bridge for the studio's pre-extraction transcription imports.
/// New transcription runtime behavior is owned by `audio-analysis`, while text
/// transcript data and heuristics are owned by `nlp-stack`.
pub struct WhisperCppTranscriber(audio_analysis_transcription::NativeWhisperCppTranscriber);

impl WhisperCppTranscriber {
    pub fn new(config: WhisperCppConfig) -> Self {
        Self(audio_analysis_transcription::NativeWhisperCppTranscriber::new(config))
    }

    pub fn transcribe_with_progress(
        &mut self,
        input: &Path,
        progress: &mut dyn FnMut(WhisperCppProgressEvent),
    ) -> std::result::Result<WhisperCppTranscription, WhisperCppError> {
        self.0.transcribe_file_with_progress(input, progress)
    }
}

mod data_sources;
mod error;
mod media;
mod red_cars;
mod report;
mod run_manager;
mod run_store;
mod song;
mod subtitles;
mod system;
#[cfg(test)]
mod test_support;
mod workflow_catalog;
mod workflow_support;
mod youtube;

pub use data_sources::{
    data_source_catalog_path, data_sources_with_defaults, editable_inline_body, folder_image_paths,
    migrate_legacy_data_sources, validate_data_source_id, DataSourceCatalog,
    DataSourceDerivationInput, DataSourceDerivationKind, DataSourceKind, DataSourceOrigin,
    DataSourceRecord, DataSourceUpsert, DATA_SOURCE_CATALOG_FORMAT, DATA_SOURCE_CATALOG_VERSION,
    LINUX_PICTURES_DATA_SOURCE_ID,
};
pub use error::{Result, StudioError};
pub use red_cars::{run_video_red_cars_workflow, VideoRedCarsRunRequest};
pub use report::*;
pub use run_manager::{
    RunCancellationToken, RunEvent, RunId, RunManager, RunRecord, RunStatus, WorkflowKind,
    WorkflowProgress,
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
pub use workflow_catalog::{
    default_workflow_catalog, ports_compatible, workflow_types_assignable, NodeSpec,
    PortCompatibility, PortKind, PortSpec, WorkflowCatalog, WorkflowCategory, WorkflowInputSurface,
    WorkflowObjectProperty, WorkflowRuntimeValidation, WorkflowSemanticKind, WorkflowTypeSpec,
};
pub use youtube::{
    discover_youtube_collection_manifest, run_youtube_collection_workflow,
    run_youtube_video_workflow, AlreadyDownloadedPolicy, ExternalCommandConfig,
    FailedProbeBehavior, LocalFileFilterSpec, ManifestFilterSpec, MetadataDepth,
    ModelCommandConfig, SourceSpec, TranscriptionConfig, TranscriptionEngine,
    YoutubeCollectionManifest, YoutubeCollectionManifestItem, YoutubeCollectionManifestRequest,
    YoutubeCollectionRunRequest, YoutubeCollectionSource, YoutubeRunOptions, YoutubeRunRequest,
};
