use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use video_analysis_use_cases::workflow_catalog::{
    workflow_types_assignable, WorkflowSemanticKind, WorkflowTypeSpec,
};

use crate::error::{Result, StudioError};

pub const DATA_SOURCE_CATALOG_FORMAT: &str = "video-analysis.dataSources";
pub const DATA_SOURCE_CATALOG_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DataSourceKind {
    Sqlite,
    Json,
    Csv,
    Txt,
    Folder,
    Api,
    Other,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DataSourceDerivationKind {
    Alias,
    SubsetView,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum DataSourceOrigin {
    Root,
    DerivedView {
        parent_id: String,
        derivation_kind: DataSourceDerivationKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DataSourceRecord {
    pub id: String,
    pub name: String,
    pub kind: DataSourceKind,
    #[serde(rename = "type")]
    pub value_type: WorkflowTypeSpec,
    pub location: String,
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub body: String,
    pub origin: DataSourceOrigin,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DataSourceUpsert {
    pub id: String,
    pub name: String,
    pub kind: DataSourceKind,
    #[serde(rename = "type")]
    pub value_type: WorkflowTypeSpec,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DataSourceDerivationInput {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub value_type: WorkflowTypeSpec,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub derivation_kind: Option<DataSourceDerivationKind>,
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DataSourceCatalog {
    pub format: String,
    pub version: u32,
    pub data_sources: Vec<DataSourceRecord>,
}

impl DataSourceCatalog {
    pub fn empty() -> Self {
        Self {
            format: DATA_SOURCE_CATALOG_FORMAT.to_string(),
            version: DATA_SOURCE_CATALOG_VERSION,
            data_sources: Vec::new(),
        }
    }

    pub fn load(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Self::empty());
        }
        let bytes = fs::read(path)?;
        let catalog: Self = serde_json::from_slice(&bytes)?;
        catalog.validate()?;
        Ok(catalog)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        self.validate()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(self)?;
        fs::write(path, format!("{}\n", String::from_utf8_lossy(&bytes)))?;
        Ok(())
    }

    pub fn validate(&self) -> Result<()> {
        if self.format != DATA_SOURCE_CATALOG_FORMAT {
            return Err(StudioError::InvalidRequest(format!(
                "unsupported data source catalog format {}",
                self.format
            )));
        }
        if self.version != DATA_SOURCE_CATALOG_VERSION {
            return Err(StudioError::InvalidRequest(format!(
                "unsupported data source catalog version {}",
                self.version
            )));
        }
        let mut ids = std::collections::BTreeSet::new();
        for record in &self.data_sources {
            validate_data_source_id(&record.id)?;
            if !ids.insert(record.id.clone()) {
                return Err(StudioError::InvalidRequest(format!(
                    "duplicate data source id {}",
                    record.id
                )));
            }
        }
        Ok(())
    }

    pub fn list(&self) -> &[DataSourceRecord] {
        &self.data_sources
    }

    pub fn create(&mut self, input: DataSourceUpsert) -> Result<DataSourceRecord> {
        validate_data_source_id(&input.id)?;
        if self.data_sources.iter().any(|record| record.id == input.id) {
            return Err(StudioError::InvalidRequest(format!(
                "data source {} already exists",
                input.id
            )));
        }
        let now = Utc::now();
        let record = normalize_root_record(input, now);
        self.data_sources.push(record.clone());
        self.sort_records();
        Ok(record)
    }

    pub fn update(
        &mut self,
        current_id: &str,
        input: DataSourceUpsert,
    ) -> Result<DataSourceRecord> {
        validate_data_source_id(&input.id)?;
        let index = self
            .data_sources
            .iter()
            .position(|record| record.id == current_id)
            .ok_or_else(|| {
                StudioError::InvalidRequest(format!("data source {} does not exist", current_id))
            })?;
        if input.id != current_id && self.data_sources.iter().any(|record| record.id == input.id) {
            return Err(StudioError::InvalidRequest(format!(
                "data source {} already exists",
                input.id
            )));
        }

        let current = self.data_sources[index].clone();
        let updated_at = Utc::now();
        let next = match &current.origin {
            DataSourceOrigin::Root => {
                normalize_root_record_with_timestamps(input, current.created_at, updated_at)
            }
            DataSourceOrigin::DerivedView {
                parent_id,
                derivation_kind,
                summary,
            } => normalize_derived_record(
                input.id,
                input.name,
                current.kind,
                input.value_type,
                input.description,
                input.tags,
                DerivedRecordOptions {
                    parent_id: parent_id.clone(),
                    derivation_kind: *derivation_kind,
                    summary: summary.clone(),
                    created_at: current.created_at,
                    updated_at,
                },
            )?,
        };
        let previous_id = current.id.clone();
        let previous_kind = current.kind;
        self.data_sources[index] = next.clone();
        if next.id != previous_id {
            for record in &mut self.data_sources {
                if let DataSourceOrigin::DerivedView { parent_id, .. } = &mut record.origin {
                    if parent_id == &previous_id {
                        *parent_id = next.id.clone();
                        record.updated_at = updated_at;
                    }
                }
            }
        }
        if next.kind != previous_kind {
            self.sync_descendant_kind(&next.id, next.kind, updated_at);
        }
        self.sort_records();
        Ok(next)
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        if self.has_children(id) {
            return Err(StudioError::InvalidRequest(format!(
                "data source {} has derived children",
                id
            )));
        }
        let original_len = self.data_sources.len();
        self.data_sources.retain(|record| record.id != id);
        if self.data_sources.len() == original_len {
            return Err(StudioError::InvalidRequest(format!(
                "data source {} does not exist",
                id
            )));
        }
        Ok(())
    }

    pub fn create_derivation(
        &mut self,
        parent_id: &str,
        input: DataSourceDerivationInput,
    ) -> Result<DataSourceRecord> {
        validate_data_source_id(&input.id)?;
        if self.data_sources.iter().any(|record| record.id == input.id) {
            return Err(StudioError::InvalidRequest(format!(
                "data source {} already exists",
                input.id
            )));
        }
        let parent = self
            .data_sources
            .iter()
            .find(|record| record.id == parent_id)
            .cloned()
            .ok_or_else(|| {
                StudioError::InvalidRequest(format!("data source {} does not exist", parent_id))
            })?;
        if !workflow_types_assignable(&parent.value_type, &input.value_type) {
            return Err(StudioError::InvalidRequest(format!(
                "derived type for {} must be assignable from parent {}",
                input.id, parent.id
            )));
        }
        let now = Utc::now();
        let record = normalize_derived_record(
            input.id,
            input.name,
            parent.kind,
            input.value_type,
            input.description,
            input.tags,
            DerivedRecordOptions {
                parent_id: parent.id,
                derivation_kind: input
                    .derivation_kind
                    .unwrap_or(DataSourceDerivationKind::Alias),
                summary: input.summary,
                created_at: now,
                updated_at: now,
            },
        )?;
        self.data_sources.push(record.clone());
        self.sort_records();
        Ok(record)
    }

    fn has_children(&self, id: &str) -> bool {
        self.data_sources.iter().any(|record| {
            matches!(
                &record.origin,
                DataSourceOrigin::DerivedView { parent_id, .. } if parent_id == id
            )
        })
    }

    fn sort_records(&mut self) {
        self.data_sources
            .sort_by(|left, right| left.id.cmp(&right.id));
    }

    fn sync_descendant_kind(
        &mut self,
        parent_id: &str,
        next_kind: DataSourceKind,
        updated_at: DateTime<Utc>,
    ) {
        let mut changed_child_ids = Vec::new();
        for record in &mut self.data_sources {
            let is_child = matches!(
                &record.origin,
                DataSourceOrigin::DerivedView { parent_id: record_parent_id, .. } if record_parent_id == parent_id
            );
            if is_child && record.kind != next_kind {
                record.kind = next_kind;
                record.updated_at = updated_at;
                changed_child_ids.push(record.id.clone());
            }
        }
        for child_id in changed_child_ids {
            self.sync_descendant_kind(&child_id, next_kind, updated_at);
        }
    }
}

#[derive(Debug)]
struct DerivedRecordOptions {
    parent_id: String,
    derivation_kind: DataSourceDerivationKind,
    summary: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

pub fn data_source_catalog_path(data_dir: &Path) -> PathBuf {
    data_dir.join("data-sources").join("catalog.json")
}

pub fn validate_data_source_id(value: &str) -> Result<()> {
    if value.is_empty() {
        return Err(StudioError::InvalidRequest(
            "data source id is required".to_string(),
        ));
    }
    if value.chars().all(|character| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || matches!(character, '_' | '-')
    }) {
        return Ok(());
    }
    Err(StudioError::InvalidRequest(format!(
        "data source id {} must use lowercase letters, numbers, underscores, or hyphens",
        value
    )))
}

pub fn editable_inline_body(kind: DataSourceKind) -> bool {
    matches!(
        kind,
        DataSourceKind::Json | DataSourceKind::Txt | DataSourceKind::Api
    )
}

pub fn migrate_legacy_data_sources(value: &Value) -> Result<Vec<DataSourceRecord>> {
    let candidates = legacy_candidates(value).ok_or_else(|| {
        StudioError::InvalidRequest("no data sources found in legacy payload".to_string())
    })?;
    let now = Utc::now();
    candidates
        .iter()
        .map(|candidate| migrate_legacy_entry(candidate, now))
        .collect()
}

fn legacy_candidates(value: &Value) -> Option<&Vec<Value>> {
    match value {
        Value::Array(values) => Some(values),
        Value::Object(object) => object
            .get("dataSources")
            .and_then(Value::as_array)
            .or_else(|| object.get("entries").and_then(Value::as_array)),
        _ => None,
    }
}

fn migrate_legacy_entry(value: &Value, timestamp: DateTime<Utc>) -> Result<DataSourceRecord> {
    let object = value.as_object().ok_or_else(|| {
        StudioError::InvalidRequest("legacy data source must be an object".to_string())
    })?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    validate_data_source_id(&id)?;
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Untitled Data Source")
        .trim()
        .to_string();
    let kind = parse_kind_value(object.get("format").or_else(|| object.get("kind")));
    let value_type = match object.get("type") {
        Some(type_value) => migrate_legacy_type(type_value)?,
        None => default_type_for_kind(kind),
    };
    let location = object
        .get("location")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let description = object
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let body = object
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let tags = object
        .get("tags")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(normalize_tag)
                .filter(|tag| !tag.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let created_at = parse_legacy_timestamp(object.get("createdAt")).unwrap_or(timestamp);
    let updated_at = parse_legacy_timestamp(object.get("updatedAt")).unwrap_or(created_at);
    Ok(DataSourceRecord {
        id,
        name,
        kind,
        value_type,
        location,
        description,
        tags,
        body,
        origin: DataSourceOrigin::Root,
        created_at,
        updated_at,
    })
}

fn parse_legacy_timestamp(value: Option<&Value>) -> Option<DateTime<Utc>> {
    value
        .and_then(Value::as_str)
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|timestamp| timestamp.with_timezone(&Utc))
}

fn parse_kind_value(value: Option<&Value>) -> DataSourceKind {
    match value.and_then(Value::as_str).unwrap_or("json") {
        "sqlite" => DataSourceKind::Sqlite,
        "json" => DataSourceKind::Json,
        "csv" => DataSourceKind::Csv,
        "txt" => DataSourceKind::Txt,
        "folder" => DataSourceKind::Folder,
        "api" => DataSourceKind::Api,
        _ => DataSourceKind::Other,
    }
}

fn migrate_legacy_type(value: &Value) -> Result<WorkflowTypeSpec> {
    if let Ok(spec) = serde_json::from_value::<WorkflowTypeSpec>(value.clone()) {
        return Ok(spec);
    }
    let object = value.as_object().ok_or_else(|| {
        StudioError::InvalidRequest("legacy data source type must be an object".to_string())
    })?;
    let type_name = object.get("type").and_then(Value::as_str).unwrap_or("any");
    match type_name {
        "port" => Ok(port_type_to_workflow_type(
            object
                .get("portType")
                .and_then(Value::as_str)
                .unwrap_or("data_value"),
        )),
        "string" => Ok(WorkflowTypeSpec::String {
            semantic: parse_semantic(object.get("semantic").and_then(Value::as_str)),
        }),
        "binary" => Ok(WorkflowTypeSpec::Binary {
            media_type: object
                .get("mediaType")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            semantic: parse_semantic(object.get("semantic").and_then(Value::as_str)),
        }),
        "array" => Ok(WorkflowTypeSpec::Array {
            items: Box::new(migrate_legacy_type(
                object
                    .get("items")
                    .unwrap_or(&Value::Object(Default::default())),
            )?),
            min_items: object
                .get("minItems")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok()),
            max_items: object
                .get("maxItems")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok()),
        }),
        "object" => Ok(WorkflowTypeSpec::Object {
            properties: object
                .get("properties")
                .and_then(Value::as_array)
                .map(|properties| migrate_legacy_properties(properties))
                .transpose()?
                .unwrap_or_default(),
            additional_properties: object
                .get("additionalProperties")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            semantic: parse_semantic(object.get("semantic").and_then(Value::as_str)),
        }),
        "union" => Ok(WorkflowTypeSpec::Union {
            variants: object
                .get("variants")
                .and_then(Value::as_array)
                .map(|variants| {
                    variants
                        .iter()
                        .map(migrate_legacy_type)
                        .collect::<Result<Vec<_>>>()
                })
                .transpose()?
                .unwrap_or_default(),
        }),
        "number" => Ok(WorkflowTypeSpec::Number),
        "boolean" => Ok(WorkflowTypeSpec::Boolean),
        "null" => Ok(WorkflowTypeSpec::Null),
        "any" => Ok(WorkflowTypeSpec::Any),
        other => Err(StudioError::InvalidRequest(format!(
            "unsupported legacy data source type {}",
            other
        ))),
    }
}

fn migrate_legacy_properties(
    properties: &[Value],
) -> Result<Vec<video_analysis_use_cases::workflow_catalog::WorkflowObjectProperty>> {
    let mut migrated = Vec::new();
    for property in properties {
        let Some(property_object) = property.as_object() else {
            continue;
        };
        let name = property_object
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let schema = property_object.get("schema").ok_or_else(|| {
            StudioError::InvalidRequest(format!("legacy property {} is missing schema", name))
        })?;
        migrated.push(
            video_analysis_use_cases::workflow_catalog::WorkflowObjectProperty {
                name,
                value: migrate_legacy_type(schema)?,
                required: property_object
                    .get("required")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            },
        );
    }
    Ok(migrated)
}

fn parse_semantic(value: Option<&str>) -> Option<WorkflowSemanticKind> {
    serde_json::from_value(Value::String(value?.to_string())).ok()
}

fn port_type_to_workflow_type(port_type: &str) -> WorkflowTypeSpec {
    match port_type {
        "string_value" => WorkflowTypeSpec::String { semantic: None },
        "template_string" => WorkflowTypeSpec::String {
            semantic: Some(WorkflowSemanticKind::TemplateString),
        },
        "youtube_url" => WorkflowTypeSpec::String {
            semantic: Some(WorkflowSemanticKind::YoutubeUrl),
        },
        "youtube_collection_url" => WorkflowTypeSpec::String {
            semantic: Some(WorkflowSemanticKind::YoutubeCollectionUrl),
        },
        "subtitle_file" => WorkflowTypeSpec::String {
            semantic: Some(WorkflowSemanticKind::SubtitleFile),
        },
        "number_value" => WorkflowTypeSpec::Number,
        "boolean_value" => WorkflowTypeSpec::Boolean,
        "array_value" => WorkflowTypeSpec::Array {
            items: Box::new(WorkflowTypeSpec::Any),
            min_items: None,
            max_items: None,
        },
        "object_value" => WorkflowTypeSpec::Object {
            properties: Vec::new(),
            additional_properties: true,
            semantic: None,
        },
        "audio_file" => WorkflowTypeSpec::Binary {
            media_type: Some("audio/*".to_string()),
            semantic: Some(WorkflowSemanticKind::AudioFile),
        },
        "audio_wav" => WorkflowTypeSpec::Binary {
            media_type: Some("audio/wav".to_string()),
            semantic: Some(WorkflowSemanticKind::AudioWav),
        },
        "video_file" => WorkflowTypeSpec::Binary {
            media_type: Some("video/*".to_string()),
            semantic: Some(WorkflowSemanticKind::VideoFile),
        },
        "media_file" => WorkflowTypeSpec::Binary {
            media_type: Some("application/octet-stream".to_string()),
            semantic: Some(WorkflowSemanticKind::MediaFile),
        },
        "transcript" => WorkflowTypeSpec::Object {
            properties: Vec::new(),
            additional_properties: true,
            semantic: Some(WorkflowSemanticKind::Transcript),
        },
        "song_catalog" => WorkflowTypeSpec::Object {
            properties: Vec::new(),
            additional_properties: true,
            semantic: Some(WorkflowSemanticKind::SongCatalog),
        },
        "data_record" => WorkflowTypeSpec::Object {
            properties: Vec::new(),
            additional_properties: true,
            semantic: Some(WorkflowSemanticKind::DataRecord),
        },
        "data_bucket" => WorkflowTypeSpec::Object {
            properties: Vec::new(),
            additional_properties: true,
            semantic: Some(WorkflowSemanticKind::DataBucket),
        },
        "http_response" => WorkflowTypeSpec::Object {
            properties: Vec::new(),
            additional_properties: true,
            semantic: Some(WorkflowSemanticKind::HttpResponse),
        },
        _ => WorkflowTypeSpec::Any,
    }
}

fn normalize_root_record(input: DataSourceUpsert, now: DateTime<Utc>) -> DataSourceRecord {
    normalize_root_record_with_timestamps(input, now, now)
}

fn normalize_root_record_with_timestamps(
    input: DataSourceUpsert,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
) -> DataSourceRecord {
    DataSourceRecord {
        id: input.id.trim().to_string(),
        name: normalize_name(&input.name),
        kind: input.kind,
        value_type: input.value_type,
        location: input.location.trim().to_string(),
        description: input.description.trim().to_string(),
        tags: normalize_tags(input.tags),
        body: if editable_inline_body(input.kind) {
            input.body
        } else {
            String::new()
        },
        origin: DataSourceOrigin::Root,
        created_at,
        updated_at,
    }
}

fn normalize_derived_record(
    id: String,
    name: String,
    kind: DataSourceKind,
    value_type: WorkflowTypeSpec,
    description: String,
    tags: Vec<String>,
    options: DerivedRecordOptions,
) -> Result<DataSourceRecord> {
    validate_data_source_id(id.trim())?;
    Ok(DataSourceRecord {
        id: id.trim().to_string(),
        name: normalize_name(&name),
        kind,
        value_type,
        location: String::new(),
        description: description.trim().to_string(),
        tags: normalize_tags(tags),
        body: String::new(),
        origin: DataSourceOrigin::DerivedView {
            parent_id: options.parent_id,
            derivation_kind: options.derivation_kind,
            summary: options
                .summary
                .map(|summary| summary.trim().to_string())
                .filter(|summary| !summary.is_empty()),
        },
        created_at: options.created_at,
        updated_at: options.updated_at,
    })
}

fn normalize_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "Untitled Data Source".to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut normalized = Vec::new();
    for tag in tags {
        let tag = normalize_tag(&tag);
        if !tag.is_empty() && seen.insert(tag.clone()) {
            normalized.push(tag);
        }
    }
    normalized
}

fn normalize_tag(tag: &str) -> String {
    tag.trim().to_lowercase()
}

fn default_type_for_kind(kind: DataSourceKind) -> WorkflowTypeSpec {
    match kind {
        DataSourceKind::Json | DataSourceKind::Other => WorkflowTypeSpec::Any,
        DataSourceKind::Sqlite | DataSourceKind::Csv => WorkflowTypeSpec::Object {
            properties: Vec::new(),
            additional_properties: true,
            semantic: Some(WorkflowSemanticKind::DataRecord),
        },
        DataSourceKind::Txt => WorkflowTypeSpec::String { semantic: None },
        DataSourceKind::Folder => WorkflowTypeSpec::Object {
            properties: Vec::new(),
            additional_properties: true,
            semantic: Some(WorkflowSemanticKind::DataBucket),
        },
        DataSourceKind::Api => WorkflowTypeSpec::Object {
            properties: Vec::new(),
            additional_properties: true,
            semantic: Some(WorkflowSemanticKind::HttpResponse),
        },
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    fn sample_upsert(id: &str) -> DataSourceUpsert {
        DataSourceUpsert {
            id: id.to_string(),
            name: "Catalog".to_string(),
            kind: DataSourceKind::Json,
            value_type: WorkflowTypeSpec::Object {
                properties: Vec::new(),
                additional_properties: true,
                semantic: Some(WorkflowSemanticKind::SongCatalog),
            },
            location: "studio-data/catalog.json".to_string(),
            description: "test".to_string(),
            tags: vec!["songs".to_string()],
            body: "{\"ok\":true}".to_string(),
        }
    }

    #[test]
    fn catalog_round_trips() {
        let dir = tempdir().unwrap();
        let path = data_source_catalog_path(dir.path());
        let mut catalog = DataSourceCatalog::empty();
        catalog.create(sample_upsert("song_catalog")).unwrap();
        catalog.save(&path).unwrap();

        let loaded = DataSourceCatalog::load(&path).unwrap();
        assert_eq!(loaded.data_sources.len(), 1);
        assert_eq!(loaded.data_sources[0].id, "song_catalog");
    }

    #[test]
    fn invalid_slug_is_rejected() {
        assert!(validate_data_source_id("Song Catalog").is_err());
    }

    #[test]
    fn duplicate_ids_are_rejected() {
        let mut catalog = DataSourceCatalog::empty();
        catalog.create(sample_upsert("song_catalog")).unwrap();
        let error = catalog.create(sample_upsert("song_catalog")).unwrap_err();
        assert!(matches!(error, StudioError::InvalidRequest(_)));
    }

    #[test]
    fn derivation_requires_existing_parent() {
        let mut catalog = DataSourceCatalog::empty();
        let error = catalog
            .create_derivation(
                "missing",
                DataSourceDerivationInput {
                    id: "child".to_string(),
                    name: "Child".to_string(),
                    value_type: WorkflowTypeSpec::Any,
                    description: String::new(),
                    tags: Vec::new(),
                    derivation_kind: None,
                    summary: None,
                },
            )
            .unwrap_err();
        assert!(matches!(error, StudioError::InvalidRequest(_)));
    }

    #[test]
    fn rename_updates_child_parent_id() {
        let mut catalog = DataSourceCatalog::empty();
        catalog.create(sample_upsert("parent")).unwrap();
        catalog
            .create_derivation(
                "parent",
                DataSourceDerivationInput {
                    id: "child".to_string(),
                    name: "Child".to_string(),
                    value_type: WorkflowTypeSpec::Object {
                        properties: Vec::new(),
                        additional_properties: true,
                        semantic: Some(WorkflowSemanticKind::SongCatalog),
                    },
                    description: String::new(),
                    tags: Vec::new(),
                    derivation_kind: None,
                    summary: None,
                },
            )
            .unwrap();

        catalog
            .update(
                "parent",
                DataSourceUpsert {
                    id: "renamed_parent".to_string(),
                    ..sample_upsert("parent")
                },
            )
            .unwrap();

        let child = catalog
            .data_sources
            .iter()
            .find(|record| record.id == "child")
            .unwrap();
        assert!(matches!(
            &child.origin,
            DataSourceOrigin::DerivedView { parent_id, .. } if parent_id == "renamed_parent"
        ));
    }

    #[test]
    fn delete_rejects_parent_with_children() {
        let mut catalog = DataSourceCatalog::empty();
        catalog.create(sample_upsert("parent")).unwrap();
        catalog
            .create_derivation(
                "parent",
                DataSourceDerivationInput {
                    id: "child".to_string(),
                    name: "Child".to_string(),
                    value_type: WorkflowTypeSpec::Object {
                        properties: Vec::new(),
                        additional_properties: true,
                        semantic: Some(WorkflowSemanticKind::SongCatalog),
                    },
                    description: String::new(),
                    tags: Vec::new(),
                    derivation_kind: None,
                    summary: None,
                },
            )
            .unwrap();
        assert!(catalog.delete("parent").is_err());
    }

    #[test]
    fn legacy_payload_is_migrated() {
        let migrated = migrate_legacy_data_sources(&serde_json::json!({
            "dataSources": [
                {
                    "id": "song_catalog",
                    "name": "Song Catalog",
                    "format": "sqlite",
                    "type": { "type": "port", "portType": "song_catalog" },
                    "location": "studio-data/catalog.sqlite",
                    "description": "catalog",
                    "tags": ["songs", "matching"],
                    "body": "",
                    "createdAt": "2025-01-01T00:00:00Z",
                    "updatedAt": "2025-01-02T00:00:00Z"
                }
            ]
        }))
        .unwrap();
        assert_eq!(migrated.len(), 1);
        assert_eq!(migrated[0].id, "song_catalog");
        assert_eq!(migrated[0].kind, DataSourceKind::Sqlite);
    }
}
