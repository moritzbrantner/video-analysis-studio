use std::collections::VecDeque;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::error::{Result, StudioError};
use crate::run_manager::{RunEvent, RunRecord, RunStatus, WorkflowKind, MAX_RUN_EVENT_HISTORY};

#[derive(Debug, Clone)]
pub struct RunStore {
    db_path: PathBuf,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RunListFilter {
    pub limit: usize,
    pub workflow: Option<WorkflowKind>,
    pub status: Option<RunStatus>,
}

impl RunStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            db_path: data_dir.join("runs.sqlite3"),
        }
    }

    pub fn load_states(&self) -> Result<Vec<(RunRecord, VecDeque<RunEvent>)>> {
        let conn = self.connect()?;
        let records = load_run_records(&conn)?;
        let mut states = Vec::with_capacity(records.len());
        for record in records {
            let events = load_run_events(&conn, record.run_id, Some(MAX_RUN_EVENT_HISTORY))?;
            states.push((record, events.into()));
        }
        Ok(states)
    }

    pub fn list_runs(&self, filter: RunListFilter) -> Result<Vec<RunRecord>> {
        let conn = self.connect()?;
        let mut records = load_run_records(&conn)?;
        if let Some(workflow) = filter.workflow {
            records.retain(|record| record.workflow == workflow);
        }
        if let Some(status) = filter.status {
            records.retain(|record| record.status == status);
        }
        records.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        records.truncate(filter.limit.clamp(1, 200));
        Ok(records)
    }

    pub fn list_events(&self, run_id: Uuid) -> Result<Vec<RunEvent>> {
        let conn = self.connect()?;
        load_run_events(&conn, run_id, None)
    }

    pub fn save_run(&self, record: &RunRecord) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO runs (
                run_id, workflow, status, work_dir, report_path, created_at, updated_at, started_at, finished_at, message
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(run_id) DO UPDATE SET
                workflow = excluded.workflow,
                status = excluded.status,
                work_dir = excluded.work_dir,
                report_path = excluded.report_path,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                started_at = excluded.started_at,
                finished_at = excluded.finished_at,
                message = excluded.message",
            params![
                record.run_id.to_string(),
                enum_string(record.workflow)?,
                enum_string(record.status)?,
                record.work_dir.to_string_lossy().to_string(),
                record.report_path.to_string_lossy().to_string(),
                record.created_at.to_rfc3339(),
                record.updated_at.to_rfc3339(),
                record.started_at.map(|value| value.to_rfc3339()),
                record.finished_at.map(|value| value.to_rfc3339()),
                record.message.as_deref(),
            ],
        )?;
        Ok(())
    }

    pub fn save_event(&self, event: &RunEvent) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO run_events (run_id, status, message, timestamp, node, phase, progress)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                event.run_id.to_string(),
                enum_string(event.status)?,
                event.message.as_str(),
                event.timestamp.to_rfc3339(),
                event.node.as_deref(),
                event.phase.as_deref(),
                event.progress,
            ],
        )?;
        Ok(())
    }

    fn connect(&self) -> Result<Connection> {
        if let Some(parent) = self.db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&self.db_path)?;
        migrate(&conn)?;
        Ok(conn)
    }
}

fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS runs (
          run_id TEXT PRIMARY KEY,
          workflow TEXT NOT NULL,
          status TEXT NOT NULL,
          work_dir TEXT NOT NULL,
          report_path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          message TEXT
        );

        CREATE TABLE IF NOT EXISTS run_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL,
          status TEXT NOT NULL,
          message TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          node TEXT,
          phase TEXT,
          progress REAL,
          FOREIGN KEY(run_id) REFERENCES runs(run_id)
        );

        CREATE INDEX IF NOT EXISTS idx_run_events_run_id_id ON run_events(run_id, id);
        CREATE INDEX IF NOT EXISTS idx_runs_updated_at ON runs(updated_at);
        INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
        "#,
    )?;
    Ok(())
}

fn load_run_records(conn: &Connection) -> Result<Vec<RunRecord>> {
    let mut statement = conn.prepare(
        "SELECT run_id, workflow, status, work_dir, report_path, created_at, updated_at, started_at, finished_at, message
         FROM runs",
    )?;
    let rows = statement.query_map([], row_to_run_record)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn load_run_events(conn: &Connection, run_id: Uuid, limit: Option<usize>) -> Result<Vec<RunEvent>> {
    let sql = if let Some(limit) = limit {
        format!(
            "SELECT run_id, status, message, timestamp, node, phase, progress
             FROM (
               SELECT run_id, status, message, timestamp, node, phase, progress, id
               FROM run_events
               WHERE run_id = ?1
               ORDER BY id DESC
               LIMIT {limit}
             ) ORDER BY id ASC"
        )
    } else {
        "SELECT run_id, status, message, timestamp, node, phase, progress
         FROM run_events
         WHERE run_id = ?1
         ORDER BY id ASC"
            .to_string()
    };
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![run_id.to_string()], row_to_run_event)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn row_to_run_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunRecord> {
    let run_id: String = row.get(0)?;
    let workflow: String = row.get(1)?;
    let status: String = row.get(2)?;
    let created_at: String = row.get(5)?;
    let updated_at: String = row.get(6)?;
    let started_at: Option<String> = row.get(7)?;
    let finished_at: Option<String> = row.get(8)?;
    Ok(RunRecord {
        run_id: parse_uuid(&run_id)?,
        workflow: parse_enum(&workflow)?,
        status: parse_enum(&status)?,
        work_dir: PathBuf::from(row.get::<_, String>(3)?),
        report_path: PathBuf::from(row.get::<_, String>(4)?),
        created_at: parse_datetime(&created_at)?,
        updated_at: parse_datetime(&updated_at)?,
        started_at: parse_optional_datetime(started_at)?,
        finished_at: parse_optional_datetime(finished_at)?,
        message: row.get(9)?,
    })
}

fn row_to_run_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunEvent> {
    let run_id: String = row.get(0)?;
    let status: String = row.get(1)?;
    let timestamp: String = row.get(3)?;
    Ok(RunEvent {
        run_id: parse_uuid(&run_id)?,
        status: parse_enum(&status)?,
        message: row.get(2)?,
        timestamp: parse_datetime(&timestamp)?,
        node: row.get(4)?,
        phase: row.get(5)?,
        progress: row.get(6)?,
    })
}

fn enum_string<T: serde::Serialize>(value: T) -> Result<String> {
    match serde_json::to_value(value)? {
        serde_json::Value::String(value) => Ok(value),
        _ => Err(StudioError::InvalidRequest(
            "enum did not serialize to string".to_string(),
        )),
    }
}

fn parse_enum<T: serde::de::DeserializeOwned>(value: &str) -> rusqlite::Result<T> {
    serde_json::from_value(serde_json::Value::String(value.to_string())).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}

fn parse_uuid(value: &str) -> rusqlite::Result<Uuid> {
    Uuid::parse_str(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}

fn parse_datetime(value: &str) -> rusqlite::Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
}

fn parse_optional_datetime(value: Option<String>) -> rusqlite::Result<Option<DateTime<Utc>>> {
    value.as_deref().map(parse_datetime).transpose()
}
