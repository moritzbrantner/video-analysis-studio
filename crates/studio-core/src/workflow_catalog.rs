use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PortKind {
    RunTrigger,
    RunConfig,
    YoutubeUrl,
    YoutubeCollectionUrl,
    VideoFile,
    ImageFile,
    ImageBatch,
    AudioFile,
    AudioWaveform,
    MediaFile,
    MaskTensor,
    LatentBatch,
    Conditioning,
    ModelRef,
    VaeRef,
    ClipRef,
    ClipVisionRef,
    UpscaleModelRef,
    ModelPatchRef,
    Transcript,
    SubtitleFile,
    SceneList,
    ObservationList,
    AudioEvents,
    TextEvents,
    DataBuckets,
    JsonReport,
    CollectionManifest,
    CollectionItems,
    SongFingerprint,
    SongCatalog,
    SongMatches,
    MusicFeatures,
    TemplateString,
    String,
    Number,
    Boolean,
    Array,
    Object,
    HttpRequest,
    HttpResponse,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowSemanticKind {
    RunRequest,
    RunConfig,
    TemplateString,
    YoutubeUrl,
    YoutubeCollectionUrl,
    VideoFile,
    ImageFile,
    ImageBatch,
    AudioFile,
    AudioWaveform,
    AudioWav,
    MediaFile,
    MaskTensor,
    LatentBatch,
    Conditioning,
    ModelRef,
    VaeRef,
    ClipRef,
    ClipVisionRef,
    UpscaleModelRef,
    ModelPatchRef,
    Transcript,
    SubtitleFile,
    VideoMetadata,
    SceneResult,
    VideoObservation,
    ModelRequest,
    ModelPrediction,
    TranscriptSegment,
    AudioEvent,
    TextEvent,
    CollectionManifest,
    CollectionItem,
    CollectionReport,
    CollectionTable,
    SongFingerprint,
    SongCatalog,
    SongMatch,
    MusicFeature,
    HttpRequest,
    HttpResponse,
    JsonReport,
    DashboardView,
    DataRecord,
    DataBucket,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowObjectProperty {
    pub name: String,
    pub value: WorkflowTypeSpec,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkflowTypeSpec {
    Any,
    Null,
    Boolean,
    Number,
    String {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        semantic: Option<WorkflowSemanticKind>,
    },
    Binary {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        media_type: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        semantic: Option<WorkflowSemanticKind>,
    },
    Array {
        items: Box<WorkflowTypeSpec>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min_items: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_items: Option<u32>,
    },
    Object {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        properties: Vec<WorkflowObjectProperty>,
        #[serde(default)]
        additional_properties: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        semantic: Option<WorkflowSemanticKind>,
    },
    Union {
        variants: Vec<WorkflowTypeSpec>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowInputSurface {
    SourceUrl,
    CollectionUrl,
    File,
    Config,
    Generic,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowRuntimeValidation {
    Strict,
    Unsafe,
    ExternalInput,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PortSpec {
    pub id: String,
    pub label: String,
    pub kind: PortKind,
    pub value_type: WorkflowTypeSpec,
    #[serde(default)]
    pub optional: bool,
    #[serde(default)]
    pub stream: bool,
    #[serde(default)]
    pub exposable_input: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_surface: Option<WorkflowInputSurface>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub suggested_adapters: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_validation: Option<WorkflowRuntimeValidation>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowCategory {
    App,
    Ingest,
    Youtube,
    Video,
    Audio,
    Text,
    Song,
    Collection,
    Output,
    Data,
    Logic,
    Network,
    Ui,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeSpec {
    pub id: String,
    pub title: String,
    pub package_name: String,
    pub category: WorkflowCategory,
    #[serde(default)]
    pub ui_owned: bool,
    #[serde(default)]
    pub inputs: Vec<PortSpec>,
    #[serde(default)]
    pub outputs: Vec<PortSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowCatalog {
    pub version: u32,
    pub port_kinds: Vec<PortKind>,
    pub nodes: Vec<NodeSpec>,
    pub compatibility: Vec<PortCompatibility>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PortCompatibility {
    pub source: PortKind,
    pub target: PortKind,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct WorkflowCatalogDefinition {
    version: u32,
    nodes: Vec<NodeDefinition>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct NodeDefinition {
    id: String,
    title: String,
    package_name: String,
    category: WorkflowCategory,
    #[serde(default)]
    ui_owned: bool,
    #[serde(default)]
    inputs: Vec<PortDefinition>,
    #[serde(default)]
    outputs: Vec<PortDefinition>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct PortDefinition {
    id: String,
    label: String,
    kind: PortKind,
    #[serde(default)]
    optional: bool,
    #[serde(default)]
    stream: bool,
    #[serde(default)]
    exposable_input: bool,
    #[serde(default)]
    input_surface: Option<WorkflowInputSurface>,
    #[serde(default)]
    suggested_adapters: Vec<String>,
    #[serde(default)]
    runtime_validation: Option<WorkflowRuntimeValidation>,
}

impl From<NodeDefinition> for NodeSpec {
    fn from(value: NodeDefinition) -> Self {
        Self {
            id: value.id,
            title: value.title,
            package_name: value.package_name,
            category: value.category,
            ui_owned: value.ui_owned,
            inputs: value.inputs.into_iter().map(Into::into).collect(),
            outputs: value.outputs.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<PortDefinition> for PortSpec {
    fn from(value: PortDefinition) -> Self {
        Self {
            id: value.id,
            label: value.label,
            value_type: workflow_type_for_port_kind(value.kind),
            kind: value.kind,
            optional: value.optional,
            stream: value.stream,
            exposable_input: value.exposable_input,
            input_surface: value.input_surface,
            suggested_adapters: value.suggested_adapters,
            runtime_validation: value.runtime_validation,
        }
    }
}

pub fn default_workflow_catalog() -> WorkflowCatalog {
    let definition =
        serde_json::from_str::<WorkflowCatalogDefinition>(include_str!("workflow_catalog.json"))
            .expect("embedded workflow catalog JSON is valid");

    WorkflowCatalog {
        version: definition.version,
        port_kinds: all_port_kinds(),
        compatibility: compatibility_pairs(),
        nodes: definition.nodes.into_iter().map(Into::into).collect(),
    }
}

pub fn ports_compatible(source: PortKind, target: PortKind) -> bool {
    workflow_types_assignable(
        &workflow_type_for_port_kind(source),
        &workflow_type_for_port_kind(target),
    )
}

pub fn workflow_types_assignable(source: &WorkflowTypeSpec, target: &WorkflowTypeSpec) -> bool {
    match target {
        WorkflowTypeSpec::Any => return true,
        WorkflowTypeSpec::Union { variants } => {
            return variants
                .iter()
                .any(|variant| workflow_types_assignable(source, variant));
        }
        _ => {}
    }

    match source {
        WorkflowTypeSpec::Union { variants } => {
            return variants
                .iter()
                .all(|variant| workflow_types_assignable(variant, target));
        }
        WorkflowTypeSpec::Any => return false,
        _ => {}
    }

    match (source, target) {
        (WorkflowTypeSpec::Null, WorkflowTypeSpec::Null)
        | (WorkflowTypeSpec::Boolean, WorkflowTypeSpec::Boolean)
        | (WorkflowTypeSpec::Number, WorkflowTypeSpec::Number) => true,
        (
            WorkflowTypeSpec::String {
                semantic: source_semantic,
            },
            WorkflowTypeSpec::String {
                semantic: target_semantic,
            },
        ) => semantic_assignable(source_semantic, target_semantic),
        (
            WorkflowTypeSpec::Binary {
                media_type: source_media_type,
                semantic: source_semantic,
            },
            WorkflowTypeSpec::Binary {
                media_type: target_media_type,
                semantic: target_semantic,
            },
        ) => {
            media_type_assignable(source_media_type, target_media_type)
                && semantic_assignable(source_semantic, target_semantic)
        }
        (
            WorkflowTypeSpec::Array {
                items: source_items,
                min_items: source_min_items,
                max_items: source_max_items,
            },
            WorkflowTypeSpec::Array {
                items: target_items,
                min_items: target_min_items,
                max_items: target_max_items,
            },
        ) => {
            workflow_types_assignable(source_items, target_items)
                && source_min_items.unwrap_or(0) >= target_min_items.unwrap_or(0)
                && max_items_assignable(*source_max_items, *target_max_items)
        }
        (
            WorkflowTypeSpec::Object {
                properties: source_properties,
                additional_properties: source_additional_properties,
                semantic: source_semantic,
            },
            WorkflowTypeSpec::Object {
                properties: target_properties,
                additional_properties: target_additional_properties,
                semantic: target_semantic,
            },
        ) => {
            semantic_assignable(source_semantic, target_semantic)
                && object_properties_assignable(
                    source_properties,
                    *source_additional_properties,
                    target_properties,
                    *target_additional_properties,
                )
        }
        _ => false,
    }
}

fn all_port_kinds() -> Vec<PortKind> {
    use PortKind::*;
    vec![
        RunTrigger,
        RunConfig,
        YoutubeUrl,
        YoutubeCollectionUrl,
        VideoFile,
        ImageFile,
        ImageBatch,
        AudioFile,
        AudioWaveform,
        MediaFile,
        MaskTensor,
        LatentBatch,
        Conditioning,
        ModelRef,
        VaeRef,
        ClipRef,
        ClipVisionRef,
        UpscaleModelRef,
        ModelPatchRef,
        Transcript,
        SubtitleFile,
        SceneList,
        ObservationList,
        AudioEvents,
        TextEvents,
        DataBuckets,
        JsonReport,
        CollectionManifest,
        CollectionItems,
        SongFingerprint,
        SongCatalog,
        SongMatches,
        MusicFeatures,
        TemplateString,
        String,
        Number,
        Boolean,
        Array,
        Object,
        HttpRequest,
        HttpResponse,
    ]
}

fn compatibility_pairs() -> Vec<PortCompatibility> {
    let kinds = all_port_kinds();
    kinds
        .iter()
        .flat_map(|source| {
            kinds.iter().filter_map(move |target| {
                if source != target && ports_compatible(*source, *target) {
                    Some(PortCompatibility {
                        source: *source,
                        target: *target,
                    })
                } else {
                    None
                }
            })
        })
        .collect()
}

fn workflow_type_for_port_kind(kind: PortKind) -> WorkflowTypeSpec {
    use PortKind::*;
    match kind {
        RunTrigger => open_object(Some(WorkflowSemanticKind::RunRequest)),
        RunConfig => open_object(Some(WorkflowSemanticKind::RunConfig)),
        YoutubeUrl => string_type(Some(WorkflowSemanticKind::YoutubeUrl)),
        YoutubeCollectionUrl => string_type(Some(WorkflowSemanticKind::YoutubeCollectionUrl)),
        VideoFile => binary_type(Some("video/*"), Some(WorkflowSemanticKind::VideoFile)),
        ImageFile => binary_type(Some("image/*"), Some(WorkflowSemanticKind::ImageFile)),
        ImageBatch => open_object(Some(WorkflowSemanticKind::ImageBatch)),
        AudioFile => binary_type(Some("audio/*"), Some(WorkflowSemanticKind::AudioFile)),
        AudioWaveform => open_object(Some(WorkflowSemanticKind::AudioWaveform)),
        MediaFile => binary_type(None, Some(WorkflowSemanticKind::MediaFile)),
        MaskTensor => open_object(Some(WorkflowSemanticKind::MaskTensor)),
        LatentBatch => open_object(Some(WorkflowSemanticKind::LatentBatch)),
        Conditioning => open_object(Some(WorkflowSemanticKind::Conditioning)),
        ModelRef => generic_model_ref_type(),
        VaeRef => open_object(Some(WorkflowSemanticKind::VaeRef)),
        ClipRef => open_object(Some(WorkflowSemanticKind::ClipRef)),
        ClipVisionRef => open_object(Some(WorkflowSemanticKind::ClipVisionRef)),
        UpscaleModelRef => open_object(Some(WorkflowSemanticKind::UpscaleModelRef)),
        ModelPatchRef => open_object(Some(WorkflowSemanticKind::ModelPatchRef)),
        Transcript => open_object(Some(WorkflowSemanticKind::Transcript)),
        SubtitleFile => string_type(Some(WorkflowSemanticKind::SubtitleFile)),
        SceneList => open_object(Some(WorkflowSemanticKind::SceneResult)),
        ObservationList => open_object(Some(WorkflowSemanticKind::VideoObservation)),
        AudioEvents => open_object(Some(WorkflowSemanticKind::AudioEvent)),
        TextEvents => open_object(Some(WorkflowSemanticKind::TextEvent)),
        DataBuckets => open_object(Some(WorkflowSemanticKind::DataBucket)),
        JsonReport => open_object(Some(WorkflowSemanticKind::JsonReport)),
        CollectionManifest => open_object(Some(WorkflowSemanticKind::CollectionManifest)),
        CollectionItems => open_object(Some(WorkflowSemanticKind::CollectionItem)),
        SongFingerprint => open_object(Some(WorkflowSemanticKind::SongFingerprint)),
        SongCatalog => open_object(Some(WorkflowSemanticKind::SongCatalog)),
        SongMatches => open_object(Some(WorkflowSemanticKind::SongMatch)),
        MusicFeatures => open_object(Some(WorkflowSemanticKind::MusicFeature)),
        TemplateString => string_type(Some(WorkflowSemanticKind::TemplateString)),
        String => string_type(None),
        Number => WorkflowTypeSpec::Number,
        Boolean => WorkflowTypeSpec::Boolean,
        Array => WorkflowTypeSpec::Array {
            items: Box::new(WorkflowTypeSpec::Any),
            min_items: None,
            max_items: None,
        },
        Object => open_object(None),
        HttpRequest => open_object(Some(WorkflowSemanticKind::HttpRequest)),
        HttpResponse => open_object(Some(WorkflowSemanticKind::HttpResponse)),
    }
}

fn string_type(semantic: Option<WorkflowSemanticKind>) -> WorkflowTypeSpec {
    WorkflowTypeSpec::String { semantic }
}

fn binary_type(
    media_type: Option<&str>,
    semantic: Option<WorkflowSemanticKind>,
) -> WorkflowTypeSpec {
    WorkflowTypeSpec::Binary {
        media_type: media_type.map(str::to_string),
        semantic,
    }
}

fn open_object(semantic: Option<WorkflowSemanticKind>) -> WorkflowTypeSpec {
    WorkflowTypeSpec::Object {
        properties: Vec::new(),
        additional_properties: true,
        semantic,
    }
}

fn generic_model_ref_type() -> WorkflowTypeSpec {
    WorkflowTypeSpec::Union {
        variants: vec![
            open_object(Some(WorkflowSemanticKind::ModelRef)),
            open_object(Some(WorkflowSemanticKind::VaeRef)),
            open_object(Some(WorkflowSemanticKind::ClipRef)),
            open_object(Some(WorkflowSemanticKind::ClipVisionRef)),
            open_object(Some(WorkflowSemanticKind::UpscaleModelRef)),
            open_object(Some(WorkflowSemanticKind::ModelPatchRef)),
        ],
    }
}

fn semantic_assignable(
    source: &Option<WorkflowSemanticKind>,
    target: &Option<WorkflowSemanticKind>,
) -> bool {
    match target {
        None => true,
        Some(target_semantic) => source == &Some(*target_semantic),
    }
}

fn media_type_assignable(source: &Option<String>, target: &Option<String>) -> bool {
    match target {
        None => true,
        Some(target_media_type) => source.as_ref() == Some(target_media_type),
    }
}

fn max_items_assignable(source: Option<u32>, target: Option<u32>) -> bool {
    match target {
        None => true,
        Some(target_max_items) => {
            source.is_some_and(|source_max_items| source_max_items <= target_max_items)
        }
    }
}

fn object_properties_assignable(
    source_properties: &[WorkflowObjectProperty],
    source_additional_properties: bool,
    target_properties: &[WorkflowObjectProperty],
    target_additional_properties: bool,
) -> bool {
    for target_property in target_properties {
        let source_property = source_properties
            .iter()
            .find(|source_property| source_property.name == target_property.name);
        let Some(source_property) = source_property else {
            if target_property.required {
                return false;
            }
            continue;
        };
        if !workflow_types_assignable(&source_property.value, &target_property.value) {
            return false;
        }
        if source_property.required != target_property.required && target_property.required {
            return false;
        }
    }

    if !target_additional_properties && source_additional_properties {
        return false;
    }
    if !source_additional_properties {
        return source_properties.iter().all(|source_property| {
            target_properties
                .iter()
                .any(|target_property| target_property.name == source_property.name)
        });
    }
    true
}
