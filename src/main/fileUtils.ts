import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SourceType } from "../shared/types.js";

export const DEFAULT_STUDY_ROOT = getDefaultStudyRoot();
export const LEARNING_DATA_DIR = ".learning-data";

const SOURCE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".mdown",
  ".txt",
  ".pdf",
  ".pptx",
  ".docx",
  ".cpp",
  ".cc",
  ".cxx",
  ".h",
  ".hpp"
]);

function getDefaultStudyRoot(): string {
  if (process.platform === "win32") return "F:\\BaiduSyncdisk\\cpp-search-study-sync";
  return path.join(os.homedir(), "BaiduSyncdisk", "cpp-search-study-sync");
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
}

export function getLearningDataPath(studyRoot: string): string {
  return path.join(studyRoot, LEARNING_DATA_DIR);
}

export function getRunsPath(studyRoot: string): string {
  return path.join(getLearningDataPath(studyRoot), "runs");
}

export async function ensureStudyDataDirs(studyRoot: string): Promise<void> {
  await ensureDir(getLearningDataPath(studyRoot));
  await ensureDir(getRunsPath(studyRoot));
}

export function isSupportedSource(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function getSourceType(filePath: string): SourceType {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md" || ext === ".markdown" || ext === ".mdown") return "markdown";
  if (ext === ".txt") return "text";
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".pptx") return "pptx";
  if (ext === ".cpp" || ext === ".cc" || ext === ".cxx") return "cpp";
  if (ext === ".h" || ext === ".hpp") return "header";
  return "unknown";
}

export function toRelativePath(rootPath: string, targetPath: string): string {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

export function sourceIdFromRelativePath(relativePath: string): string {
  return crypto.createHash("sha1").update(relativePath.toLowerCase()).digest("hex");
}

export async function hashFile(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function isPathInside(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function windowsPathToWslPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const drive = resolved.slice(0, 1).toLowerCase();
  const rest = resolved.slice(2).replace(/\\/g, "/");
  return `/mnt/${drive}${rest}`;
}

export function escapeCommandPart(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}
