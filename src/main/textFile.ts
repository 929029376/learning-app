import fs from "node:fs/promises";
import path from "node:path";

import type {
  CreateTextFileRequest,
  DeleteTextFileRequest,
  DeleteTextFileResult,
  ExerciseFile,
  ListExerciseFilesRequest,
  SaveTextFileRequest,
  TextFileContent,
  TextFileRequest
} from "../shared/types.js";
import { isPathInside } from "./fileUtils.js";

const EDITABLE_EXTENSIONS = new Set([".cpp", ".cc", ".cxx", ".h", ".hpp", ".md", ".txt", ".mk"]);
const EDITABLE_FILENAMES = new Set(["Makefile", "makefile"]);
const IGNORED_DIRS = new Set([".git", "build", "dist", ".learning-data", "node_modules"]);
const MAX_EDITABLE_BYTES = 512 * 1024;

export async function listExerciseFiles(request: ListExerciseFilesRequest): Promise<ExerciseFile[]> {
  const studyRoot = path.resolve(request.studyRoot);
  const practicePath = path.resolve(request.practicePath);
  if (!isPathInside(studyRoot, practicePath)) {
    throw new Error("安全检查失败：练习目录必须位于学习目录内部。");
  }

  const stat = await fs.stat(practicePath);
  if (!stat.isDirectory()) {
    throw new Error("练习路径不是目录，无法进入多文件模式。");
  }

  const files: ExerciseFile[] = [];
  await collectEditableFiles(practicePath, practicePath, files);
  return files.sort((left, right) => compareExerciseFiles(left, right));
}

export async function readTextFile(request: TextFileRequest): Promise<TextFileContent> {
  const filePath = resolveEditablePath(request.studyRoot, request.filePath);
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_EDITABLE_BYTES) {
    throw new Error("文件太大，当前内置编辑器只打开 512KB 以内的文本文件。");
  }

  return {
    path: filePath,
    content: await fs.readFile(filePath, "utf8"),
    updatedAt: new Date().toISOString()
  };
}

export async function createTextFile(request: CreateTextFileRequest): Promise<TextFileContent> {
  const practicePath = path.resolve(request.practicePath);
  const targetPath = resolveCreatablePath(request.studyRoot, practicePath, request.relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.writeFile(targetPath, request.content ?? "", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new Error("文件已存在，请换一个文件名。");
    }
    throw error;
  }

  return {
    path: targetPath,
    content: request.content ?? "",
    updatedAt: new Date().toISOString()
  };
}

export async function deleteTextFile(request: DeleteTextFileRequest): Promise<DeleteTextFileResult> {
  const filePath = resolveDeletablePath(request.studyRoot, request.practicePath, request.filePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error("只能删除文件，不能删除目录。");
  }

  await fs.unlink(filePath);
  return {
    path: filePath,
    deletedAt: new Date().toISOString()
  };
}

export async function saveTextFile(request: SaveTextFileRequest): Promise<TextFileContent> {
  const filePath = resolveEditablePath(request.studyRoot, request.filePath);
  await fs.writeFile(filePath, request.content, "utf8");
  return {
    path: filePath,
    content: request.content,
    updatedAt: new Date().toISOString()
  };
}

function resolveCreatablePath(studyRoot: string, practicePath: string, relativePath: string): string {
  const root = path.resolve(studyRoot);
  const practice = path.resolve(practicePath);
  if (!isPathInside(root, practice)) {
    throw new Error("安全检查失败：练习目录必须位于学习目录内部。");
  }

  const normalizedRelativePath = relativePath.trim().replace(/\\/g, "/");
  if (!normalizedRelativePath) {
    throw new Error("请输入要创建的文件名，例如 src/helper.cpp。");
  }
  if (normalizedRelativePath.includes("\0") || path.isAbsolute(normalizedRelativePath)) {
    throw new Error("只能输入相对路径，不能输入绝对路径。");
  }

  const parts = normalizedRelativePath.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("文件路径不能包含 . 或 ..。");
  }
  if (parts.some((part) => /[<>:"|?*]/.test(part))) {
    throw new Error("文件名不能包含 Windows 不支持的字符：< > : \" | ? *。");
  }

  const target = path.resolve(practice, ...parts);
  if (!isPathInside(root, target) || !isPathInside(practice, target)) {
    throw new Error("安全检查失败：只能在当前练习目录内创建文件。");
  }

  return resolveEditablePath(root, target);
}

function resolveDeletablePath(studyRoot: string, practicePath: string, filePath: string): string {
  const root = path.resolve(studyRoot);
  const practice = path.resolve(practicePath);
  const target = resolveEditablePath(root, filePath);

  if (!isPathInside(root, practice)) {
    throw new Error("安全检查失败：练习目录必须位于学习目录内部。");
  }
  if (!isPathInside(practice, target)) {
    throw new Error("安全检查失败：只能删除当前练习目录内的文件。");
  }

  return target;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function resolveEditablePath(studyRoot: string, filePath: string): string {
  const root = path.resolve(studyRoot);
  const target = path.resolve(filePath);
  if (!isPathInside(root, target)) {
    throw new Error("安全检查失败：只能编辑学习目录内部的文件。");
  }

  const extension = path.extname(target).toLowerCase();
  const filename = path.basename(target);
  if (!EDITABLE_EXTENSIONS.has(extension) && !EDITABLE_FILENAMES.has(filename)) {
    throw new Error("当前内置编辑器只支持 C++、Makefile、Markdown 和文本文件。");
  }

  return target;
}

async function collectEditableFiles(rootDir: string, currentDir: string, files: ExerciseFile[]): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await collectEditableFiles(rootDir, entryPath, files);
      }
      continue;
    }

    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!EDITABLE_EXTENSIONS.has(extension) && !EDITABLE_FILENAMES.has(entry.name)) continue;
    files.push({
      path: entryPath,
      relativePath: path.relative(rootDir, entryPath).split(path.sep).join("/"),
      name: entry.name,
      extension,
      kind: getExerciseFileKind(entry.name, extension)
    });
  }
}

function getExerciseFileKind(filename: string, extension: string): ExerciseFile["kind"] {
  if ([".cpp", ".cc", ".cxx"].includes(extension)) return "source";
  if ([".h", ".hpp"].includes(extension)) return "header";
  if (filename === "Makefile" || filename === "makefile" || extension === ".mk") return "build";
  return "text";
}

function compareExerciseFiles(left: ExerciseFile, right: ExerciseFile): number {
  const kindOrder: Record<ExerciseFile["kind"], number> = {
    source: 1,
    header: 2,
    build: 3,
    text: 4
  };
  if (left.name === "main.cpp") return -1;
  if (right.name === "main.cpp") return 1;
  if (left.name === "Makefile") return -1;
  if (right.name === "Makefile") return 1;
  if (kindOrder[left.kind] !== kindOrder[right.kind]) return kindOrder[left.kind] - kindOrder[right.kind];
  return left.relativePath.localeCompare(right.relativePath);
}
