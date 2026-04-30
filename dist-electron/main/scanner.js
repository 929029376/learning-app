"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanStudyRoot = scanStudyRoot;
exports.getCourseOverview = getCourseOverview;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const fileUtils_js_1 = require("./fileUtils.js");
const parser_js_1 = require("./parser.js");
const database_js_1 = require("./database.js");
const course_js_1 = require("./course.js");
const IGNORED_DIRS = new Set([".git", "node_modules", ".learning-data", "dist", "build"]);
const PRIMARY_STUDY_DIRS = ["phase-notes", "notes", "course-notes", "lesson-notes", "lessons", "docs", "practice", "study-system"];
const TEXT_SOURCE_LIMIT = 5 * 1024 * 1024;
const DOCUMENT_SOURCE_LIMIT = 15 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 15000;
async function scanStudyRoot(studyRoot) {
    await (0, fileUtils_js_1.ensureStudyDataDirs)(studyRoot);
    const database = await database_js_1.StudyDatabase.open(studyRoot);
    const files = await collectSourceFiles(studyRoot);
    let parsedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    for (const filePath of files) {
        const stat = await promises_1.default.stat(filePath);
        const relativePath = (0, fileUtils_js_1.toRelativePath)(studyRoot, filePath);
        const existing = database.getSourceByPath(filePath);
        const baseSource = {
            id: existing?.id ?? (0, fileUtils_js_1.sourceIdFromRelativePath)(relativePath),
            path: filePath,
            relativePath,
            type: (0, fileUtils_js_1.getSourceType)(filePath),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            hash: `mtime:${stat.mtimeMs}:size:${stat.size}`,
            parseStatus: "pending",
            title: node_path_1.default.basename(filePath)
        };
        const maxSize = getMaxSize(baseSource.type);
        if (stat.size > maxSize) {
            skippedCount += 1;
            database.upsertSource({
                ...baseSource,
                parseStatus: "skipped",
                errorMessage: `File is ${(stat.size / 1024 / 1024).toFixed(1)} MB. MVP import limit is ${(maxSize / 1024 / 1024).toFixed(0)} MB.`
            });
            database.replaceChunks(baseSource.id, []);
            continue;
        }
        const hash = await (0, fileUtils_js_1.hashFile)(filePath);
        baseSource.hash = hash;
        if (existing && existing.hash === hash && existing.parseStatus === "parsed") {
            skippedCount += 1;
            database.upsertSource({ ...baseSource, parseStatus: "parsed", errorMessage: undefined });
            continue;
        }
        try {
            const text = await withTimeout((0, parser_js_1.parseSourceText)(filePath, baseSource.type), PARSE_TIMEOUT_MS);
            database.upsertSource({ ...baseSource, parseStatus: "parsed", errorMessage: undefined });
            database.replaceChunks(baseSource.id, (0, parser_js_1.splitIntoChunks)(text));
            parsedCount += 1;
        }
        catch (error) {
            failedCount += 1;
            database.upsertSource({
                ...baseSource,
                parseStatus: "failed",
                errorMessage: error instanceof Error ? error.message : String(error)
            });
            database.replaceChunks(baseSource.id, []);
        }
    }
    database.persist();
    const sources = database.listSources();
    const overview = await (0, course_js_1.buildCourseOverview)(studyRoot, sources);
    return { overview, parsedCount, failedCount, skippedCount };
}
async function getCourseOverview(studyRoot) {
    const database = await database_js_1.StudyDatabase.open(studyRoot);
    return (0, course_js_1.buildCourseOverview)(studyRoot, database.listSources());
}
async function collectSourceFiles(root) {
    const result = [];
    const hasCuratedStudyDirs = await hasAnyPrimaryStudyDir(root);
    if (hasCuratedStudyDirs) {
        const rootEntries = await promises_1.default.readdir(root, { withFileTypes: true });
        for (const entry of rootEntries) {
            const entryPath = node_path_1.default.join(root, entry.name);
            if (entry.isFile() && (0, fileUtils_js_1.isSupportedSource)(entryPath)) {
                result.push(entryPath);
            }
        }
        for (const dirName of PRIMARY_STUDY_DIRS) {
            const dirPath = node_path_1.default.join(root, dirName);
            try {
                const stat = await promises_1.default.stat(dirPath);
                if (stat.isDirectory()) {
                    await walk(dirPath, result);
                }
            }
            catch {
                // Missing curated directories are allowed for other courses.
            }
        }
        return result;
    }
    await walk(root, result);
    return result;
}
async function hasAnyPrimaryStudyDir(root) {
    for (const dirName of PRIMARY_STUDY_DIRS) {
        try {
            const stat = await promises_1.default.stat(node_path_1.default.join(root, dirName));
            if (stat.isDirectory())
                return true;
        }
        catch {
            // Keep checking the remaining well-known directories.
        }
    }
    return false;
}
function getMaxSize(type) {
    if (type === "pdf" || type === "pptx" || type === "docx") {
        return DOCUMENT_SOURCE_LIMIT;
    }
    return TEXT_SOURCE_LIMIT;
}
function withTimeout(task, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Parsing timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
        task
            .then((value) => {
            clearTimeout(timer);
            resolve(value);
        })
            .catch((error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
async function walk(currentDir, result) {
    const entries = await promises_1.default.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = node_path_1.default.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name)) {
                await walk(entryPath, result);
            }
            continue;
        }
        if (entry.isFile() && (0, fileUtils_js_1.isSupportedSource)(entryPath)) {
            result.push(entryPath);
        }
    }
}
