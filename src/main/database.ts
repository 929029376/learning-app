import fs from "node:fs";
import path from "node:path";

import initSqlJs from "sql.js";
import type { Database, SqlJsStatic, SqlValue } from "sql.js";

import type { ExerciseResult, LearningSource } from "../shared/types.js";
import { ensureStudyDataDirs, getLearningDataPath } from "./fileUtils.js";

let sqlPromise: Promise<SqlJsStatic> | null = null;
const SOURCE_COLUMNS = "id, path, relativePath, type, size, mtimeMs, hash, parseStatus, errorMessage, title";

function loadSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`)
    });
  }
  return sqlPromise;
}

function firstValue<T>(db: Database, sql: string, params: SqlValue[] = []): T | null {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    if (!statement.step()) return null;
    const row = statement.getAsObject() as Record<string, T>;
    return Object.values(row)[0] ?? null;
  } finally {
    statement.free();
  }
}

function allRows<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const statement = db.prepare(sql);
  const rows: T[] = [];
  try {
    statement.bind(params);
    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }
    return rows;
  } finally {
    statement.free();
  }
}

export class StudyDatabase {
  private constructor(
    private readonly db: Database,
    private readonly dbPath: string
  ) {}

  static async open(studyRoot: string): Promise<StudyDatabase> {
    await ensureStudyDataDirs(studyRoot);
    const sql = await loadSql();
    const dbPath = path.join(getLearningDataPath(studyRoot), "index.sqlite");
    const db = fs.existsSync(dbPath) ? new sql.Database(fs.readFileSync(dbPath)) : new sql.Database();
    const database = new StudyDatabase(db, dbPath);
    database.migrate();
    database.persist();
    return database;
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        relativePath TEXT NOT NULL,
        type TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtimeMs REAL NOT NULL,
        hash TEXT NOT NULL,
        parseStatus TEXT NOT NULL,
        errorMessage TEXT,
        title TEXT,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        sourceId TEXT NOT NULL,
        chunkIndex INTEGER NOT NULL,
        title TEXT,
        text TEXT NOT NULL,
        tokenEstimate INTEGER NOT NULL,
        FOREIGN KEY(sourceId) REFERENCES sources(id)
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        sourcePath TEXT NOT NULL,
        command TEXT NOT NULL,
        compileOutput TEXT NOT NULL,
        stdout TEXT NOT NULL,
        stderr TEXT NOT NULL,
        exitCode INTEGER,
        passed INTEGER NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_decisions (
        id TEXT PRIMARY KEY,
        stageId TEXT,
        decisionType TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `);
  }

  persist(): void {
    fs.writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }

  getSourceByPath(filePath: string): LearningSource | null {
    return (
      allRows<LearningSource>(
        this.db,
        `SELECT ${SOURCE_COLUMNS} FROM sources WHERE path = ?`,
        [filePath]
      )[0] ?? null
    );
  }

  getSourceById(id: string): LearningSource | null {
    return (
      allRows<LearningSource>(
        this.db,
        `SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = ?`,
        [id]
      )[0] ?? null
    );
  }

  getSourceByRelativePath(relativePath: string): LearningSource | null {
    return (
      allRows<LearningSource>(
        this.db,
        `SELECT ${SOURCE_COLUMNS}
         FROM sources
         WHERE lower(replace(relativePath, char(92), '/')) = ?
         ORDER BY updatedAt DESC
         LIMIT 1`,
        [normalizeRelativePathForLookup(relativePath)]
      )[0] ?? null
    );
  }

  listSources(): LearningSource[] {
    return allRows<LearningSource>(
      this.db,
      `SELECT ${SOURCE_COLUMNS} FROM sources ORDER BY relativePath ASC`
    );
  }

  upsertSource(source: LearningSource): void {
    const statement = this.db.prepare(`
      INSERT INTO sources (id, path, relativePath, type, size, mtimeMs, hash, parseStatus, errorMessage, title, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        relativePath = excluded.relativePath,
        type = excluded.type,
        size = excluded.size,
        mtimeMs = excluded.mtimeMs,
        hash = excluded.hash,
        parseStatus = excluded.parseStatus,
        errorMessage = excluded.errorMessage,
        title = excluded.title,
        updatedAt = excluded.updatedAt
    `);
    try {
      statement.run([
        source.id,
        source.path,
        source.relativePath,
        source.type,
        source.size,
        source.mtimeMs,
        source.hash,
        source.parseStatus,
        source.errorMessage ?? null,
        source.title ?? null,
        new Date().toISOString()
      ]);
    } finally {
      statement.free();
    }
  }

  replaceChunks(sourceId: string, chunks: string[]): void {
    const deleteStatement = this.db.prepare("DELETE FROM chunks WHERE sourceId = ?");
    try {
      deleteStatement.run([sourceId]);
    } finally {
      deleteStatement.free();
    }

    const insertStatement = this.db.prepare(`
      INSERT INTO chunks (id, sourceId, chunkIndex, title, text, tokenEstimate)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    try {
      chunks.forEach((chunk, index) => {
        insertStatement.run([
          `${sourceId}:${index}`,
          sourceId,
          index,
          index === 0 ? "main" : `part ${index + 1}`,
          chunk,
          Math.ceil(chunk.length / 4)
        ]);
      });
    } finally {
      insertStatement.free();
    }
  }

  getSourceText(sourceId: string): string {
    const rows = allRows<{ text: string }>(this.db, "SELECT text FROM chunks WHERE sourceId = ? ORDER BY chunkIndex ASC", [
      sourceId
    ]);
    return rows.map((row) => row.text).join("\n\n");
  }

  saveRun(result: ExerciseResult): void {
    const statement = this.db.prepare(`
      INSERT INTO runs (id, sourcePath, command, compileOutput, stdout, stderr, exitCode, passed, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    try {
      statement.run([
        result.id,
        result.sourcePath,
        result.command,
        result.compileOutput,
        result.stdout,
        result.stderr,
        result.exitCode,
        result.passed ? 1 : 0,
        result.createdAt
      ]);
      this.persist();
    } finally {
      statement.free();
    }
  }

  saveUserDecision(stageId: string | undefined, decisionType: string, content: string): void {
    const statement = this.db.prepare(`
      INSERT INTO user_decisions (id, stageId, decisionType, content, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    try {
      statement.run([cryptoRandomId(), stageId ?? null, decisionType, content, new Date().toISOString()]);
      this.persist();
    } finally {
      statement.free();
    }
  }

  getParsedSourceCount(): number {
    return firstValue<number>(this.db, "SELECT COUNT(*) AS count FROM sources WHERE parseStatus = 'parsed'") ?? 0;
  }
}

function normalizeRelativePathForLookup(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").toLowerCase();
}

export function cryptoRandomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
