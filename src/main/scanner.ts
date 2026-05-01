import fs from "node:fs/promises";
import path from "node:path";

import type { LearningSource, ScanResult } from "../shared/types.js";
import {
  ensureStudyDataDirs,
  getSourceType,
  hashFile,
  isSupportedSource,
  sourceIdFromRelativePath,
  toRelativePath
} from "./fileUtils.js";
import { parseSourceText, splitIntoChunks } from "./parser.js";
import { StudyDatabase } from "./database.js";
import { buildCourseOverview } from "./course.js";

const IGNORED_DIRS = new Set([".git", "node_modules", ".learning-data", "dist", "build"]);
const PRIMARY_STUDY_DIRS = ["phase-notes", "notes", "course-notes", "lesson-notes", "lessons", "docs", "practice", "study-system"];
const TEXT_SOURCE_LIMIT = 5 * 1024 * 1024;
const DOCUMENT_SOURCE_LIMIT = 15 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 15000;

export async function scanStudyRoot(studyRoot: string): Promise<ScanResult> {
  await ensureStudyDataDirs(studyRoot);
  const database = await StudyDatabase.open(studyRoot);
  const files = await collectSourceFiles(studyRoot);

  let parsedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    const relativePath = toRelativePath(studyRoot, filePath);
    const sourceId = sourceIdFromRelativePath(relativePath);
    const existing =
      database.getSourceById(sourceId) ??
      database.getSourceByRelativePath(relativePath) ??
      database.getSourceByPath(filePath);
    const baseSource: LearningSource = {
      id: existing?.id ?? sourceId,
      path: filePath,
      relativePath,
      type: getSourceType(filePath),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash: `mtime:${stat.mtimeMs}:size:${stat.size}`,
      parseStatus: "pending",
      title: path.basename(filePath)
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

    const hash = await hashFile(filePath);
    baseSource.hash = hash;

    if (existing && existing.hash === hash && existing.parseStatus === "parsed") {
      skippedCount += 1;
      database.upsertSource({ ...baseSource, parseStatus: "parsed", errorMessage: undefined });
      continue;
    }

    try {
      const text = await withTimeout(parseSourceText(filePath, baseSource.type), PARSE_TIMEOUT_MS);
      database.upsertSource({ ...baseSource, parseStatus: "parsed", errorMessage: undefined });
      database.replaceChunks(baseSource.id, splitIntoChunks(text));
      parsedCount += 1;
    } catch (error) {
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
  const overview = await buildCourseOverview(studyRoot, sources);
  return { overview, parsedCount, failedCount, skippedCount };
}

export async function getCourseOverview(studyRoot: string) {
  const database = await StudyDatabase.open(studyRoot);
  return buildCourseOverview(studyRoot, database.listSources());
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const hasCuratedStudyDirs = await hasAnyPrimaryStudyDir(root);
  if (hasCuratedStudyDirs) {
    const rootEntries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of rootEntries) {
      const entryPath = path.join(root, entry.name);
      if (entry.isFile() && isSupportedSource(entryPath)) {
        result.push(entryPath);
      }
    }

    for (const dirName of PRIMARY_STUDY_DIRS) {
      const dirPath = path.join(root, dirName);
      try {
        const stat = await fs.stat(dirPath);
        if (stat.isDirectory()) {
          await walk(dirPath, result);
        }
      } catch {
        // Missing curated directories are allowed for other courses.
      }
    }
    return result;
  }

  await walk(root, result);
  return result;
}

async function hasAnyPrimaryStudyDir(root: string): Promise<boolean> {
  for (const dirName of PRIMARY_STUDY_DIRS) {
    try {
      const stat = await fs.stat(path.join(root, dirName));
      if (stat.isDirectory()) return true;
    } catch {
      // Keep checking the remaining well-known directories.
    }
  }
  return false;
}

function getMaxSize(type: LearningSource["type"]): number {
  if (type === "pdf" || type === "pptx" || type === "docx") {
    return DOCUMENT_SOURCE_LIMIT;
  }
  return TEXT_SOURCE_LIMIT;
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
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

async function walk(currentDir: string, result: string[]): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walk(entryPath, result);
      }
      continue;
    }
    if (entry.isFile() && isSupportedSource(entryPath)) {
      result.push(entryPath);
    }
  }
}
