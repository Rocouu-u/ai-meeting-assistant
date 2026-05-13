import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getBundledResourcePath, getWritableDataDir, getWritableDataPath } from "./storage-paths";

export type StoredMeetingRecord = {
  id: string;
  title: string;
  originalFileName?: string;
  fileSize?: number;
  fileSizeLabel?: string;
  fileType?: string;
  duration?: string;
  durationSeconds?: number;
  status: string;
  taskStatus?: string;
  transcript?: string;
  summary?: string;
  outline?: string;
  todos?: string;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
};

const storageDir = getWritableDataDir();
const databasePath = getWritableDataPath("app.db");

export function listMeetingRecords() {
  initDatabase();

  const output = runSqlJson(`
    SELECT ${selectColumns()}
    FROM meetings
    ORDER BY updated_at DESC;
  `);

  return JSON.parse(output || "[]") as StoredMeetingRecord[];
}

export function getMeetingRecord(id: string) {
  initDatabase();

  const output = runSqlJson(`
    SELECT ${selectColumns()}
    FROM meetings
    WHERE id = ${sqlText(id)}
    LIMIT 1;
  `);
  const records = JSON.parse(output || "[]") as StoredMeetingRecord[];

  return records[0] ?? null;
}

export function saveMeetingRecord(record: StoredMeetingRecord) {
  initDatabase();

  const existingRecord = getMeetingRecord(record.id);
  const now = new Date().toISOString();
  const createdAt = record.createdAt || existingRecord?.createdAt || now;
  const updatedAt = record.updatedAt || now;

  runSql(`
    INSERT INTO meetings (
      id,
      title,
      date_label,
      duration,
      status,
      task_status,
      transcript,
      summary,
      outline,
      todos,
      error_message,
      original_file_name,
      file_size,
      file_size_label,
      file_type,
      duration_seconds,
      audio_file_name,
      audio_file_size,
      audio_file_type,
      created_at,
      updated_at
    ) VALUES (
      ${sqlText(record.id)},
      ${sqlText(record.title || "未命名会议")},
      ${sqlText(formatDateLabel(createdAt))},
      ${sqlText(record.duration || "")},
      ${sqlText(record.status || "待处理")},
      ${sqlText(record.taskStatus || "idle")},
      ${sqlText(record.transcript || "")},
      ${sqlText(record.summary || "")},
      ${sqlText(record.outline || "")},
      ${sqlText(record.todos || "")},
      ${sqlText(record.errorMessage || "")},
      ${sqlText(record.originalFileName || "")},
      ${sqlNumber(record.fileSize)},
      ${sqlText(record.fileSizeLabel || "")},
      ${sqlText(record.fileType || "")},
      ${sqlNumber(record.durationSeconds)},
      ${sqlText(record.originalFileName || "")},
      ${sqlText(record.fileSizeLabel || "")},
      ${sqlText(record.fileType || "")},
      ${sqlText(createdAt)},
      ${sqlText(updatedAt)}
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      date_label = excluded.date_label,
      duration = excluded.duration,
      status = excluded.status,
      task_status = excluded.task_status,
      transcript = excluded.transcript,
      summary = excluded.summary,
      outline = excluded.outline,
      todos = excluded.todos,
      error_message = excluded.error_message,
      original_file_name = excluded.original_file_name,
      file_size = excluded.file_size,
      file_size_label = excluded.file_size_label,
      file_type = excluded.file_type,
      duration_seconds = excluded.duration_seconds,
      audio_file_name = excluded.audio_file_name,
      audio_file_size = excluded.audio_file_size,
      audio_file_type = excluded.audio_file_type,
      updated_at = excluded.updated_at;
  `);

  return getMeetingRecord(record.id) ?? record;
}

export function updateMeetingRecord(id: string, patch: Partial<StoredMeetingRecord>) {
  initDatabase();

  const currentRecord = getMeetingRecord(id);

  if (!currentRecord) {
    return null;
  }

  return saveMeetingRecord({
    ...currentRecord,
    ...patch,
    id,
    title: patch.title ?? currentRecord.title,
    updatedAt: new Date().toISOString()
  });
}

export function renameMeetingRecord(id: string, title: string) {
  return updateMeetingRecord(id, {
    title
  });
}

export function deleteMeetingRecord(id: string) {
  initDatabase();

  runSql(`DELETE FROM meetings WHERE id = ${sqlText(id)};`);

  return true;
}

export function batchDeleteMeetingRecords(ids: string[]) {
  initDatabase();

  if (ids.length === 0) {
    return 0;
  }

  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  const idList = uniqueIds.map(sqlText).join(", ");

  runSql(`DELETE FROM meetings WHERE id IN (${idList});`);

  return uniqueIds.length;
}

export function importMeetingRecords(records: StoredMeetingRecord[]) {
  initDatabase();

  let importedCount = 0;

  records.forEach((record) => {
    if (!record.id || getMeetingRecord(record.id)) {
      return;
    }

    saveMeetingRecord(record);
    importedCount += 1;
  });

  return importedCount;
}

function initDatabase() {
  mkdirSync(storageDir, { recursive: true });

  runSql(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      date_label TEXT NOT NULL DEFAULT '',
      duration TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      transcript TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      outline TEXT NOT NULL DEFAULT '',
      audio_file_name TEXT NOT NULL DEFAULT '',
      audio_file_size TEXT NOT NULL DEFAULT '',
      audio_file_type TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  addColumnIfMissing("task_status", "TEXT NOT NULL DEFAULT 'idle'");
  addColumnIfMissing("todos", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("error_message", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("original_file_name", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("file_size", "INTEGER");
  addColumnIfMissing("file_size_label", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("file_type", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("duration_seconds", "REAL");
}

function addColumnIfMissing(columnName: string, columnDefinition: string) {
  const columns = runSqlJson("PRAGMA table_info(meetings);");
  const parsedColumns = JSON.parse(columns || "[]") as Array<{ name: string }>;

  if (parsedColumns.some((column) => column.name === columnName)) {
    return;
  }

  runSql(`ALTER TABLE meetings ADD COLUMN ${columnName} ${columnDefinition};`);
}

function selectColumns() {
  return `
    id,
    title,
    COALESCE(NULLIF(original_file_name, ''), audio_file_name) AS originalFileName,
    file_size AS fileSize,
    COALESCE(NULLIF(file_size_label, ''), audio_file_size) AS fileSizeLabel,
    COALESCE(NULLIF(file_type, ''), audio_file_type) AS fileType,
    duration,
    duration_seconds AS durationSeconds,
    status,
    task_status AS taskStatus,
    transcript,
    summary,
    outline,
    todos,
    error_message AS errorMessage,
    created_at AS createdAt,
    updated_at AS updatedAt
  `;
}

function runSql(sql: string) {
  return execFileSync(getSqliteExecutablePath(), [databasePath], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024
  });
}

function runSqlJson(sql: string) {
  return execFileSync(getSqliteExecutablePath(), ["-json", databasePath, sql], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024
  });
}

function getSqliteExecutablePath() {
  if (process.env.SQLITE3_PATH && existsSync(process.env.SQLITE3_PATH)) {
    return process.env.SQLITE3_PATH;
  }

  const executableName = process.platform === "win32" ? "sqlite3.exe" : "sqlite3";
  const candidates = [
    getBundledResourcePath("vendor", "sqlite", "win32", executableName),
    getBundledResourcePath("app", "vendor", "sqlite", "win32", executableName),
    path.join(process.cwd(), "vendor", "sqlite", "win32", executableName)
  ];
  const bundledExecutable = candidates.find((candidate) => existsSync(candidate));

  return bundledExecutable || "sqlite3";
}

function sqlText(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "NULL";
}

function formatDateLabel(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "刚刚";
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
