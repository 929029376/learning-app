"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCppContent = validateCppContent;
exports.runCppExercise = runCppExercise;
exports.runExerciseProject = runExerciseProject;
const node_child_process_1 = require("node:child_process");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const fileUtils_js_1 = require("./fileUtils.js");
const database_js_1 = require("./database.js");
const ignoredProjectDirs = new Set([".git", ".learning-data", "build", "dist", "node_modules"]);
async function validateCppContent(request) {
    const sourcePath = node_path_1.default.resolve(request.filePath);
    const studyRoot = node_path_1.default.resolve(request.studyRoot);
    const practicePath = node_path_1.default.resolve(request.practicePath);
    if (!(0, fileUtils_js_1.isPathInside)(studyRoot, sourcePath) || !(0, fileUtils_js_1.isPathInside)(studyRoot, practicePath) || !(0, fileUtils_js_1.isPathInside)(practicePath, sourcePath)) {
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
    const checkDir = node_path_1.default.join((0, fileUtils_js_1.getRunsPath)(studyRoot), "live-diagnostics", (0, database_js_1.cryptoRandomId)());
    await (0, fileUtils_js_1.ensureDir)(checkDir);
    const temporarySourcePath = node_path_1.default.join(checkDir, node_path_1.default.basename(sourcePath));
    await promises_1.default.writeFile(temporarySourcePath, request.content, "utf8");
    const includeDirs = await listIncludeDirs(practicePath);
    includeDirs.push(node_path_1.default.dirname(sourcePath));
    const uniqueIncludeDirs = [...new Set(includeDirs.map((includeDir) => node_path_1.default.resolve(includeDir)))];
    const includeArgs = uniqueIncludeDirs.flatMap((includeDir) => ["-I", toRunnerPath(includeDir, runnerMode)]);
    const isHeader = /\.(h|hpp)$/i.test(sourcePath);
    const compileCommand = createToolCommand("g++", [
        "-std=c++17",
        "-Wall",
        "-Wextra",
        "-fsyntax-only",
        ...(isHeader ? ["-x", "c++"] : []),
        ...includeArgs,
        toRunnerPath(temporarySourcePath, runnerMode)
    ], runnerMode);
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
    }
    finally {
        await promises_1.default.rm(checkDir, { recursive: true, force: true });
    }
}
async function runCppExercise(request) {
    const sourcePath = node_path_1.default.resolve(request.sourcePath);
    const studyRoot = node_path_1.default.resolve(request.studyRoot);
    if (!(0, fileUtils_js_1.isPathInside)(studyRoot, sourcePath)) {
        throw new Error("安全检查失败：源码文件必须位于学习目录内部。");
    }
    if (!/\.(cpp|cc|cxx)$/i.test(sourcePath)) {
        throw new Error("当前只允许编译 C++ 源文件，例如 .cpp、.cc、.cxx。");
    }
    await promises_1.default.access(sourcePath);
    const runnerMode = getRunnerMode();
    const runId = (0, database_js_1.cryptoRandomId)();
    const runDir = node_path_1.default.join((0, fileUtils_js_1.getRunsPath)(studyRoot), runId);
    await (0, fileUtils_js_1.ensureDir)(runDir);
    const outputPath = node_path_1.default.join(runDir, getExecutableName("app"));
    const compileCommand = createToolCommand("g++", [
        "-std=c++17",
        "-Wall",
        "-Wextra",
        "-I",
        toRunnerPath(node_path_1.default.dirname(sourcePath), runnerMode),
        toRunnerPath(sourcePath, runnerMode),
        "-o",
        toRunnerPath(outputPath, runnerMode)
    ], runnerMode);
    const compile = await spawnProcess(compileCommand.command, compileCommand.args, undefined, 20000, node_path_1.default.dirname(sourcePath));
    let run = { stdout: "", stderr: "", exitCode: null };
    if (compile.exitCode === 0) {
        const runCommand = createExecutableCommand(outputPath, runnerMode);
        run = await spawnProcess(runCommand.command, runCommand.args, request.stdin ?? "", 10000, node_path_1.default.dirname(sourcePath));
    }
    const result = {
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
    const database = await database_js_1.StudyDatabase.open(studyRoot);
    database.saveRun(result);
    return result;
}
async function runExerciseProject(request) {
    const practicePath = node_path_1.default.resolve(request.practicePath);
    const studyRoot = node_path_1.default.resolve(request.studyRoot);
    if (!(0, fileUtils_js_1.isPathInside)(studyRoot, practicePath)) {
        throw new Error("安全检查失败：练习目录必须位于学习目录内部。");
    }
    const stat = await promises_1.default.stat(practicePath);
    if (!stat.isDirectory()) {
        throw new Error("练习路径不是目录，无法运行整个项目。");
    }
    const runId = (0, database_js_1.cryptoRandomId)();
    const runDir = node_path_1.default.join((0, fileUtils_js_1.getRunsPath)(studyRoot), runId);
    await (0, fileUtils_js_1.ensureDir)(runDir);
    const makefilePath = node_path_1.default.join(practicePath, "Makefile");
    const makefileExists = await fileExists(makefilePath);
    const result = makefileExists
        ? await runMakeProject(studyRoot, practicePath, runId, request.stdin ?? "")
        : await runAutoCompiledProject(studyRoot, practicePath, runDir, runId, request.stdin ?? "");
    const database = await database_js_1.StudyDatabase.open(studyRoot);
    database.saveRun(result);
    return result;
}
async function runMakeProject(studyRoot, practicePath, runId, stdin) {
    const runnerMode = getRunnerMode();
    const makeCommand = createToolCommand("make", ["-C", toRunnerPath(practicePath, runnerMode)], runnerMode);
    const compile = await spawnProcess(makeCommand.command, makeCommand.args, undefined, 30000, practicePath);
    const executablePath = await findMakeExecutable(practicePath);
    let run = {
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
async function runAutoCompiledProject(studyRoot, practicePath, runDir, runId, stdin) {
    const cppFiles = await listProjectCppFiles(practicePath);
    if (cppFiles.length === 0) {
        throw new Error("当前练习目录没有 .cpp 文件，也没有 Makefile。");
    }
    const runnerMode = getRunnerMode();
    const outputPath = node_path_1.default.join(runDir, getExecutableName("app"));
    const includeDirs = await listIncludeDirs(practicePath);
    const includeArgs = includeDirs.flatMap((includeDir) => ["-I", toRunnerPath(includeDir, runnerMode)]);
    const compileCommand = createToolCommand("g++", [
        "-std=c++17",
        "-Wall",
        "-Wextra",
        ...includeArgs,
        ...cppFiles.map((filePath) => toRunnerPath(filePath, runnerMode)),
        "-o",
        toRunnerPath(outputPath, runnerMode)
    ], runnerMode);
    const compile = await spawnProcess(compileCommand.command, compileCommand.args, undefined, 30000, practicePath);
    let run = { stdout: "", stderr: "", exitCode: null };
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
function getRunnerMode() {
    return process.platform === "win32" ? "windows-wsl" : "native";
}
function createToolCommand(tool, toolArgs, runnerMode) {
    if (runnerMode === "windows-wsl") {
        const args = ["-d", "Ubuntu", "--", tool, ...toolArgs];
        return {
            command: "wsl.exe",
            args,
            displayCommand: ["wsl.exe", ...args.map((part) => (0, fileUtils_js_1.escapeCommandPart)(part))].join(" ")
        };
    }
    return {
        command: tool,
        args: toolArgs,
        displayCommand: [tool, ...toolArgs.map((part) => (0, fileUtils_js_1.escapeCommandPart)(part))].join(" ")
    };
}
function createExecutableCommand(executablePath, runnerMode) {
    if (runnerMode === "windows-wsl") {
        const args = ["-d", "Ubuntu", "--", (0, fileUtils_js_1.windowsPathToWslPath)(executablePath)];
        return {
            command: "wsl.exe",
            args,
            displayCommand: ["wsl.exe", ...args.map((part) => (0, fileUtils_js_1.escapeCommandPart)(part))].join(" ")
        };
    }
    return {
        command: executablePath,
        args: [],
        displayCommand: (0, fileUtils_js_1.escapeCommandPart)(executablePath)
    };
}
function toRunnerPath(filePath, runnerMode) {
    return runnerMode === "windows-wsl" ? (0, fileUtils_js_1.windowsPathToWslPath)(filePath) : filePath;
}
function getExecutableName(baseName) {
    return process.platform === "win32" ? baseName : baseName;
}
async function listProjectCppFiles(practicePath) {
    const files = [];
    await walkProjectFiles(practicePath, files, (filePath) => /\.(cpp|cc|cxx)$/i.test(filePath));
    return files.sort(compareSourcePaths);
}
async function listIncludeDirs(practicePath) {
    const includeDirs = new Set([practicePath]);
    await walkProjectFiles(practicePath, [], (filePath) => {
        if (/\.(h|hpp)$/i.test(filePath)) {
            includeDirs.add(node_path_1.default.dirname(filePath));
        }
        return false;
    });
    return [...includeDirs].sort((left, right) => left.localeCompare(right));
}
async function walkProjectFiles(currentDir, result, shouldCollect) {
    const entries = await promises_1.default.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = node_path_1.default.join(currentDir, entry.name);
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
function compareSourcePaths(left, right) {
    if (node_path_1.default.basename(left) === "main.cpp")
        return -1;
    if (node_path_1.default.basename(right) === "main.cpp")
        return 1;
    return left.localeCompare(right);
}
function parseCompilerDiagnostics(output, temporarySourcePath, originalSourcePath) {
    const diagnostics = [];
    for (const line of output.split(/\r?\n/)) {
        const matchWithColumn = line.match(/^(.*?):(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.*)$/);
        const matchWithoutColumn = line.match(/^(.*?):(\d+):\s+(fatal error|error|warning|note):\s+(.*)$/);
        const match = matchWithColumn ?? matchWithoutColumn;
        if (!match)
            continue;
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
function getDiagnosticSeverity(value) {
    if (value === "warning")
        return "warning";
    if (value === "note")
        return "info";
    return "error";
}
function normalizeCompilerPath(filePath) {
    const cleanPath = filePath.trim().replace(/^"|"$/g, "");
    const wslMatch = cleanPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    if (wslMatch)
        return node_path_1.default.resolve(`${wslMatch[1].toUpperCase()}:/${wslMatch[2]}`);
    return node_path_1.default.resolve(cleanPath);
}
function sameResolvedPath(left, right) {
    return node_path_1.default.resolve(left).toLowerCase() === node_path_1.default.resolve(right).toLowerCase();
}
async function findMakeExecutable(practicePath) {
    const executableNames = ["app", "app.exe", "main", "main.exe", "a.out", "server", "server.exe", "SEserver", "SEserver.exe"];
    const candidates = executableNames.map((name) => node_path_1.default.join(practicePath, name));
    for (const candidate of candidates) {
        if (await fileExists(candidate))
            return candidate;
    }
    return null;
}
async function fileExists(filePath) {
    try {
        await promises_1.default.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
function spawnProcess(command, args, stdin, timeoutMs, cwd) {
    return new Promise((resolve) => {
        const child = (0, node_child_process_1.spawn)(command, args, {
            cwd,
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            child.kill();
            resolve({
                stdout,
                stderr: `${stderr}\nProcess timed out after ${timeoutMs}ms.`.trim(),
                exitCode: null
            });
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
            stdout += decodeProcessChunk(chunk);
            if (stdout.length > 100000)
                stdout = stdout.slice(-100000);
        });
        child.stderr.on("data", (chunk) => {
            stderr += decodeProcessChunk(chunk);
            if (stderr.length > 100000)
                stderr = stderr.slice(-100000);
        });
        child.on("error", (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({ stdout, stderr: getProcessErrorMessage(command, error), exitCode: null });
        });
        child.on("close", (exitCode) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode });
        });
        child.stdin.end(stdin ?? "");
    });
}
function getProcessErrorMessage(command, error) {
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
function decodeProcessChunk(chunk) {
    const utf8Text = chunk.toString("utf8");
    const nullCount = (utf8Text.match(/\u0000/g) ?? []).length;
    if (nullCount > utf8Text.length / 6) {
        return chunk.toString("utf16le").replace(/\u0000/g, "");
    }
    return utf8Text.replace(/\u0000/g, "");
}
