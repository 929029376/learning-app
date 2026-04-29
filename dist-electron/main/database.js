"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudyDatabase = void 0;
exports.cryptoRandomId = cryptoRandomId;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const sql_js_1 = __importDefault(require("sql.js"));
const fileUtils_js_1 = require("./fileUtils.js");
let sqlPromise = null;
function loadSql() {
    if (!sqlPromise) {
        sqlPromise = (0, sql_js_1.default)({
            locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
        });
    }
    return sqlPromise;
}
function firstValue(db, sql, params = []) {
    const statement = db.prepare(sql);
    try {
        statement.bind(params);
        if (!statement.step())
            return null;
        const row = statement.getAsObject();
        return Object.values(row)[0] ?? null;
    }
    finally {
        statement.free();
    }
}
function allRows(db, sql, params = []) {
    const statement = db.prepare(sql);
    const rows = [];
    try {
        statement.bind(params);
        while (statement.step()) {
            rows.push(statement.getAsObject());
        }
        return rows;
    }
    finally {
        statement.free();
    }
}
class StudyDatabase {
    db;
    dbPath;
    constructor(db, dbPath) {
        this.db = db;
        this.dbPath = dbPath;
    }
    static async open(studyRoot) {
        await (0, fileUtils_js_1.ensureStudyDataDirs)(studyRoot);
        const sql = await loadSql();
        const dbPath = node_path_1.default.join((0, fileUtils_js_1.getLearningDataPath)(studyRoot), "index.sqlite");
        const db = node_fs_1.default.existsSync(dbPath) ? new sql.Database(node_fs_1.default.readFileSync(dbPath)) : new sql.Database();
        const database = new StudyDatabase(db, dbPath);
        database.migrate();
        database.persist();
        return database;
    }
    migrate() {
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
    persist() {
        node_fs_1.default.writeFileSync(this.dbPath, Buffer.from(this.db.export()));
    }
    getSourceByPath(filePath) {
        return (allRows(this.db, "SELECT id, path, relativePath, type, size, mtimeMs, hash, parseStatus, errorMessage, title FROM sources WHERE path = ?", [filePath])[0] ?? null);
    }
    listSources() {
        return allRows(this.db, "SELECT id, path, relativePath, type, size, mtimeMs, hash, parseStatus, errorMessage, title FROM sources ORDER BY relativePath ASC");
    }
    upsertSource(source) {
        const statement = this.db.prepare(`
      INSERT INTO sources (id, path, relativePath, type, size, mtimeMs, hash, parseStatus, errorMessage, title, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
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
        }
        finally {
            statement.free();
        }
    }
    replaceChunks(sourceId, chunks) {
        const deleteStatement = this.db.prepare("DELETE FROM chunks WHERE sourceId = ?");
        try {
            deleteStatement.run([sourceId]);
        }
        finally {
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
        }
        finally {
            insertStatement.free();
        }
    }
    getSourceText(sourceId) {
        const rows = allRows(this.db, "SELECT text FROM chunks WHERE sourceId = ? ORDER BY chunkIndex ASC", [
            sourceId
        ]);
        return rows.map((row) => row.text).join("\n\n");
    }
    saveRun(result) {
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
        }
        finally {
            statement.free();
        }
    }
    saveUserDecision(stageId, decisionType, content) {
        const statement = this.db.prepare(`
      INSERT INTO user_decisions (id, stageId, decisionType, content, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);
        try {
            statement.run([cryptoRandomId(), stageId ?? null, decisionType, content, new Date().toISOString()]);
            this.persist();
        }
        finally {
            statement.free();
        }
    }
    getParsedSourceCount() {
        return firstValue(this.db, "SELECT COUNT(*) AS count FROM sources WHERE parseStatus = 'parsed'") ?? 0;
    }
}
exports.StudyDatabase = StudyDatabase;
function cryptoRandomId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
