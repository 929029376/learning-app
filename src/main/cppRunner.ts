import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  CodeDiagnostic,
  CodeDiagnosticSeverity,
  ExerciseResult,
  RunCppExerciseRequest,
  RunExerciseProjectRequest,
  ValidateCppContentRequest,
  ValidateCppContentResult
} from "../shared/types.js";
import {
  ensureDir,
  escapeCommandPart,
  getRunsPath,
  isPathInside,
  windowsPathToWslPath
} from "./fileUtils.js";
import { StudyDatabase, cryptoRandomId } from "./database.js";

type RunnerMode = "windows-wsl" | "native";

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

interface RunnerCommand {
  command: string;
  args: string[];
  displayCommand: string;
}

const ignoredProjectDirs = new Set([".git", ".learning-data", "build", "dist", "node_modules"]);
const liveDiagnosticsTempRoot = path.join(os.tmpdir(), "learning-app-live-diagnostics");

export async function validateCppContent(request: ValidateCppContentRequest): Promise<ValidateCppContentResult> {
  const sourcePath = path.resolve(request.filePath);
  const studyRoot = path.resolve(request.studyRoot);
  const practicePath = path.resolve(request.practicePath);

  if (!isPathInside(studyRoot, sourcePath) || !isPathInside(studyRoot, practicePath) || !isPathInside(practicePath, sourcePath)) {
    throw new Error("安全检查失败：只能检查当前练习目录内的 C++ 文件。");
  }

  if (!/\.(cpp|cc|cxx|h|hpp)$/i.test(sourcePath)) {
    return {
      filePath: sourcePath,
      command: "",
      output: "",
      diagnostics: [],
      passed: true,
      checkedAt: new Date().toISOString()
    };
  }

  const runnerMode = getRunnerMode();
  const checkDir = path.join(liveDiagnosticsTempRoot, cryptoRandomId());
  await ensureDir(checkDir);

  const temporarySourcePath = path.join(checkDir, path.basename(sourcePath));
  await fs.writeFile(temporarySourcePath, request.content, "utf8");

  const includeDirs = await listIncludeDirs(practicePath);
  includeDirs.push(path.dirname(sourcePath));
  const uniqueIncludeDirs = [...new Set(includeDirs.map((includeDir) => path.resolve(includeDir)))];
  const includeArgs = uniqueIncludeDirs.flatMap((includeDir) => ["-I", toRunnerPath(includeDir, runnerMode)]);
  const isHeader = /\.(h|hpp)$/i.test(sourcePath);
  const compileCommand = createToolCommand(
    "g++",
    [
      "-std=c++17",
      "-Wall",
      "-Wextra",
      "-fsyntax-only",
      ...(isHeader ? ["-x", "c++"] : []),
      ...includeArgs,
      toRunnerPath(temporarySourcePath, runnerMode)
    ],
    runnerMode
  );

  try {
    const compile = await spawnProcess(compileCommand.command, compileCommand.args, undefined, 8000, practicePath);
    const output = [compile.stdout, compile.stderr].filter(Boolean).join("\n");
    const diagnostics = parseCompilerDiagnostics(output, temporarySourcePath, sourcePath);
    if (compile.exitCode !== 0 && diagnostics.length === 0) {
      diagnostics.push({
        filePath: sourcePath,
        line: 1,
        column: 1,
        severity: "error",
        message: output || "C++ syntax check failed."
      });
    }

    return {
      filePath: sourcePath,
      command: compileCommand.displayCommand,
      output,
      diagnostics,
      passed: compile.exitCode === 0 && diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      checkedAt: new Date().toISOString()
    };
  } finally {
    await removeLiveDiagnosticDir(checkDir);
  }
}

async function removeLiveDiagnosticDir(checkDir: string): Promise<void> {
  try {
    await fs.rm(checkDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (isTransientFileLock(error)) return;
    throw error;
  }
}

function isTransientFileLock(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return ["EBUSY", "EPERM", "ENOTEMPTY"].includes(String((error as NodeJS.ErrnoException).code));
}

export async function runCppExercise(request: RunCppExerciseRequest): Promise<ExerciseResult> {
  const sourcePath = path.resolve(request.sourcePath);
  const studyRoot = path.resolve(request.studyRoot);
  if (!isPathInside(studyRoot, sourcePath)) {
    throw new Error("安全检查失败：源码文件必须位于学习目录内部。");
  }

  if (!/\.(cpp|cc|cxx)$/i.test(sourcePath)) {
    throw new Error("当前只允许编译 C++ 源文件，例如 .cpp、.cc、.cxx。");
  }

  await fs.access(sourcePath);
  const runnerMode = getRunnerMode();
  const runId = cryptoRandomId();
  const runDir = path.join(getRunsPath(studyRoot), runId);
  await ensureDir(runDir);

  const outputPath = path.join(runDir, getExecutableName("app"));
  const compileCommand = createToolCommand(
    "g++",
    [
      "-std=c++17",
      "-Wall",
      "-Wextra",
      "-I",
      toRunnerPath(path.dirname(sourcePath), runnerMode),
      toRunnerPath(sourcePath, runnerMode),
      "-o",
      toRunnerPath(outputPath, runnerMode)
    ],
    runnerMode
  );
  const compile = await spawnProcess(compileCommand.command, compileCommand.args, undefined, 20000, path.dirname(sourcePath));

  let run: ProcessResult = { stdout: "", stderr: "", exitCode: null };
  if (compile.exitCode === 0) {
    const runCommand = createExecutableCommand(outputPath, runnerMode);
    run = await spawnProcess(runCommand.command, runCommand.args, request.stdin ?? "", 10000, path.dirname(sourcePath));
  }

  const result: ExerciseResult = {
    id: runId,
    sourcePath,
    command: compileCommand.displayCommand,
    compileOutput: [compile.stdout, compile.stderr].filter(Boolean).join("\n"),
    stdout: run.stdout,
    stderr: run.stderr,
    exitCode: compile.exitCode === 0 ? run.exitCode : compile.exitCode,
    passed: compile.exitCode === 0 && run.exitCode === 0,
    createdAt: new Date().toISOString()
  };

  const database = await StudyDatabase.open(studyRoot);
  database.saveRun(result);
  return result;
}

export async function runExerciseProject(request: RunExerciseProjectRequest): Promise<ExerciseResult> {
  const practicePath = path.resolve(request.practicePath);
  const studyRoot = path.resolve(request.studyRoot);
  if (!isPathInside(studyRoot, practicePath)) {
    throw new Error("安全检查失败：练习目录必须位于学习目录内部。");
  }

  const stat = await fs.stat(practicePath);
  if (!stat.isDirectory()) {
    throw new Error("练习路径不是目录，无法运行整个项目。");
  }

  const runId = cryptoRandomId();
  const runDir = path.join(getRunsPath(studyRoot), runId);
  await ensureDir(runDir);

  const makefilePath = path.join(practicePath, "Makefile");
  const makefileExists = await fileExists(makefilePath);
  const result = makefileExists
    ? await runMakeProject(studyRoot, practicePath, runId, request.stdin ?? "")
    : await runAutoCompiledProject(studyRoot, practicePath, runDir, runId, request.stdin ?? "");

  const database = await StudyDatabase.open(studyRoot);
  database.saveRun(result);
  return result;
}

async function runMakeProject(studyRoot: string, practicePath: string, runId: string, stdin: string): Promise<ExerciseResult> {
  const runnerMode = getRunnerMode();
  const makeCommand = createToolCommand("make", ["-C", toRunnerPath(practicePath, runnerMode)], runnerMode);
  const compile = await spawnProcess(makeCommand.command, makeCommand.args, undefined, 30000, practicePath);
  const executablePath = await findMakeExecutable(practicePath);
  let run: ProcessResult = {
    stdout: "",
    stderr: executablePath ? "" : "Build succeeded, but no runnable output was found. Expected app, main, a.out, server, or SEserver.",
    exitCode: null
  };

  if (compile.exitCode === 0 && executablePath) {
    const runCommand = createExecutableCommand(executablePath, runnerMode);
    run = await spawnProcess(runCommand.command, runCommand.args, stdin, 10000, practicePath);
  }

  return {
    id: runId,
    sourcePath: practicePath,
    command: makeCommand.displayCommand,
    compileOutput: [compile.stdout, compile.stderr].filter(Boolean).join("\n"),
    stdout: run.stdout,
    stderr: run.stderr,
    exitCode: compile.exitCode === 0 ? run.exitCode : compile.exitCode,
    passed: compile.exitCode === 0 && Boolean(executablePath) && run.exitCode === 0,
    createdAt: new Date().toISOString()
  };
}

async function runAutoCompiledProject(studyRoot: string, practicePath: string, runDir: string, runId: string, stdin: string): Promise<ExerciseResult> {
  const cppFiles = await listProjectCppFiles(practicePath);
  if (cppFiles.length === 0) {
    throw new Error("当前练习目录没有 .cpp 文件，也没有 Makefile。");
  }

  const runnerMode = getRunnerMode();
  const outputPath = path.join(runDir, getExecutableName("app"));
  const includeDirs = await listIncludeDirs(practicePath);
  const includeArgs = includeDirs.flatMap((includeDir) => ["-I", toRunnerPath(includeDir, runnerMode)]);
  const compileCommand = createToolCommand(
    "g++",
    [
      "-std=c++17",
      "-Wall",
      "-Wextra",
      ...includeArgs,
      ...cppFiles.map((filePath) => toRunnerPath(filePath, runnerMode)),
      "-o",
      toRunnerPath(outputPath, runnerMode)
    ],
    runnerMode
  );
  const compile = await spawnProcess(compileCommand.command, compileCommand.args, undefined, 30000, practicePath);
  let run: ProcessResult = { stdout: "", stderr: "", exitCode: null };

  if (compile.exitCode === 0) {
    const runCommand = createExecutableCommand(outputPath, runnerMode);
    run = await spawnProcess(runCommand.command, runCommand.args, stdin, 10000, practicePath);
  }

  return {
    id: runId,
    sourcePath: practicePath,
    command: compileCommand.displayCommand,
    compileOutput: [compile.stdout, compile.stderr].filter(Boolean).join("\n"),
    stdout: run.stdout,
    stderr: run.stderr,
    exitCode: compile.exitCode === 0 ? run.exitCode : compile.exitCode,
    passed: compile.exitCode === 0 && run.exitCode === 0,
    createdAt: new Date().toISOString()
  };
}

function getRunnerMode(): RunnerMode {
  return process.platform === "win32" ? "windows-wsl" : "native";
}

function createToolCommand(tool: string, toolArgs: string[], runnerMode: RunnerMode): RunnerCommand {
  if (runnerMode === "windows-wsl") {
    const args = ["-d", "Ubuntu", "--", tool, ...toolArgs];
    return {
      command: "wsl.exe",
      args,
      displayCommand: ["wsl.exe", ...args.map((part) => escapeCommandPart(part))].join(" ")
    };
  }

  return {
    command: tool,
    args: toolArgs,
    displayCommand: [tool, ...toolArgs.map((part) => escapeCommandPart(part))].join(" ")
  };
}

function createExecutableCommand(executablePath: string, runnerMode: RunnerMode): RunnerCommand {
  if (runnerMode === "windows-wsl") {
    const args = ["-d", "Ubuntu", "--", windowsPathToWslPath(executablePath)];
    return {
      command: "wsl.exe",
      args,
      displayCommand: ["wsl.exe", ...args.map((part) => escapeCommandPart(part))].join(" ")
    };
  }

  return {
    command: executablePath,
    args: [],
    displayCommand: escapeCommandPart(executablePath)
  };
}

function toRunnerPath(filePath: string, runnerMode: RunnerMode): string {
  return runnerMode === "windows-wsl" ? windowsPathToWslPath(filePath) : filePath;
}

function getExecutableName(baseName: string): string {
  return process.platform === "win32" ? baseName : baseName;
}

async function listProjectCppFiles(practicePath: string): Promise<string[]> {
  const files: string[] = [];
  await walkProjectFiles(practicePath, files, (filePath) => /\.(cpp|cc|cxx)$/i.test(filePath));
  return files.sort(compareSourcePaths);
}

async function listIncludeDirs(practicePath: string): Promise<string[]> {
  const includeDirs = new Set<string>([practicePath]);
  await walkProjectFiles(practicePath, [], (filePath) => {
    if (/\.(h|hpp)$/i.test(filePath)) {
      includeDirs.add(path.dirname(filePath));
    }
    return false;
  });
  return [...includeDirs].sort((left, right) => left.localeCompare(right));
}

async function walkProjectFiles(currentDir: string, result: string[], shouldCollect: (filePath: string) => boolean): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredProjectDirs.has(entry.name)) {
        await walkProjectFiles(entryPath, result, shouldCollect);
      }
      continue;
    }

    if (entry.isFile() && shouldCollect(entryPath)) {
      result.push(entryPath);
    }
  }
}

function compareSourcePaths(left: string, right: string): number {
  if (path.basename(left) === "main.cpp") return -1;
  if (path.basename(right) === "main.cpp") return 1;
  return left.localeCompare(right);
}

function parseCompilerDiagnostics(output: string, temporarySourcePath: string, originalSourcePath: string): CodeDiagnostic[] {
  const diagnostics: CodeDiagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    const matchWithColumn = line.match(/^(.*?):(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.*)$/);
    const matchWithoutColumn = line.match(/^(.*?):(\d+):\s+(fatal error|error|warning|note):\s+(.*)$/);
    const match = matchWithColumn ?? matchWithoutColumn;
    if (!match) continue;

    const hasColumn = match === matchWithColumn;
    const rawFilePath = match[1];
    const lineNumber = Number(match[2]);
    const columnNumber = hasColumn ? Number(match[3]) : 1;
    const rawSeverity = hasColumn ? match[4] : match[3];
    const message = hasColumn ? match[5] : match[4];
    const normalizedPath = normalizeCompilerPath(rawFilePath);
    const filePath = sameResolvedPath(normalizedPath, temporarySourcePath) ? originalSourcePath : normalizedPath;

    diagnostics.push({
      filePath,
      line: Number.isFinite(lineNumber) ? lineNumber : 1,
      column: Number.isFinite(columnNumber) ? columnNumber : 1,
      severity: getDiagnosticSeverity(rawSeverity),
      message
    });
  }
  return diagnostics;
}

function getDiagnosticSeverity(value: string): CodeDiagnosticSeverity {
  if (value === "warning") return "warning";
  if (value === "note") return "info";
  return "error";
}

function normalizeCompilerPath(filePath: string): string {
  const cleanPath = filePath.trim().replace(/^"|"$/g, "");
  const wslMatch = cleanPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (wslMatch) return path.resolve(`${wslMatch[1].toUpperCase()}:/${wslMatch[2]}`);
  return path.resolve(cleanPath);
}

function sameResolvedPath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

async function findMakeExecutable(practicePath: string): Promise<string | null> {
  const executableNames = ["app", "app.exe", "main", "main.exe", "a.out", "server", "server.exe", "SEserver", "SEserver.exe"];
  const candidates = executableNames.map((name) => path.join(practicePath, name));
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function spawnProcess(command: string, args: string[], stdin: string | undefined, timeoutMs: number, cwd?: string): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({
        stdout,
        stderr: `${stderr}\nProcess timed out after ${timeoutMs}ms.`.trim(),
        exitCode: null
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += decodeProcessChunk(chunk);
      if (stdout.length > 100000) stdout = stdout.slice(-100000);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += decodeProcessChunk(chunk);
      if (stderr.length > 100000) stderr = stderr.slice(-100000);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: getProcessErrorMessage(command, error), exitCode: null });
    });

    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });

    child.stdin.on("error", (error) => {
      if ("code" in error && ["EPIPE", "EOF"].includes(String(error.code))) return;
      stderr = `${stderr}\n${error.message}`.trim();
    });

    try {
      child.stdin.end(normalizeProcessStdin(stdin));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr = `${stderr}\n${message}`.trim();
    }
  });
}

function normalizeProcessStdin(stdin: string | undefined): string {
  if (!stdin) return "";
  const normalized = stdin.replace(/\r\n?/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function getProcessErrorMessage(command: string, error: Error): string {
  if ("code" in error && error.code === "ENOENT") {
    if (process.platform === "win32" && command === "wsl.exe") {
      return "Cannot find wsl.exe. Please install WSL + Ubuntu, then install g++ and make in Ubuntu.";
    }
    if (command === "g++" || command === "make") {
      return `Cannot find ${command}. On macOS, run xcode-select --install first.`;
    }
  }
  return error.message;
}

function decodeProcessChunk(chunk: Buffer): string {
  const utf8Text = chunk.toString("utf8");
  const nullCount = (utf8Text.match(/\u0000/g) ?? []).length;
  if (nullCount > utf8Text.length / 6) {
    return chunk.toString("utf16le").replace(/\u0000/g, "");
  }
  return utf8Text.replace(/\u0000/g, "");
}
