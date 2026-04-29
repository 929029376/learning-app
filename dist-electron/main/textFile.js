"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listExerciseFiles = listExerciseFiles;
exports.readTextFile = readTextFile;
exports.createTextFile = createTextFile;
exports.deleteTextFile = deleteTextFile;
exports.saveTextFile = saveTextFile;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const fileUtils_js_1 = require("./fileUtils.js");
const EDITABLE_EXTENSIONS = new Set([".cpp", ".cc", ".cxx", ".h", ".hpp", ".md", ".txt", ".mk"]);
const EDITABLE_FILENAMES = new Set(["Makefile", "makefile"]);
const IGNORED_DIRS = new Set([".git", "build", "dist", ".learning-data", "node_modules"]);
const MAX_EDITABLE_BYTES = 512 * 1024;
async function listExerciseFiles(request) {
    const studyRoot = node_path_1.default.resolve(request.studyRoot);
    const practicePath = node_path_1.default.resolve(request.practicePath);
    if (!(0, fileUtils_js_1.isPathInside)(studyRoot, practicePath)) {
        throw new Error("安全检查失败：练习目录必须位于学习目录内部。");
    }
    const stat = await promises_1.default.stat(practicePath);
    if (!stat.isDirectory()) {
        throw new Error("练习路径不是目录，无法进入多文件模式。");
    }
    const files = [];
    await collectEditableFiles(practicePath, practicePath, files);
    return files.sort((left, right) => compareExerciseFiles(left, right));
}
async function readTextFile(request) {
    const filePath = resolveEditablePath(request.studyRoot, request.filePath);
    const stat = await promises_1.default.stat(filePath);
    if (stat.size > MAX_EDITABLE_BYTES) {
        throw new Error("文件太大，当前内置编辑器只打开 512KB 以内的文本文件。");
    }
    return {
        path: filePath,
        content: await promises_1.default.readFile(filePath, "utf8"),
        updatedAt: new Date().toISOString()
    };
}
async function createTextFile(request) {
    const practicePath = node_path_1.default.resolve(request.practicePath);
    const targetPath = resolveCreatablePath(request.studyRoot, practicePath, request.relativePath);
    await promises_1.default.mkdir(node_path_1.default.dirname(targetPath), { recursive: true });
    try {
        await promises_1.default.writeFile(targetPath, request.content ?? "", { encoding: "utf8", flag: "wx" });
    }
    catch (error) {
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
async function deleteTextFile(request) {
    const filePath = resolveDeletablePath(request.studyRoot, request.practicePath, request.filePath);
    const stat = await promises_1.default.stat(filePath);
    if (!stat.isFile()) {
        throw new Error("只能删除文件，不能删除目录。");
    }
    await promises_1.default.unlink(filePath);
    return {
        path: filePath,
        deletedAt: new Date().toISOString()
    };
}
async function saveTextFile(request) {
    const filePath = resolveEditablePath(request.studyRoot, request.filePath);
    await promises_1.default.writeFile(filePath, request.content, "utf8");
    return {
        path: filePath,
        content: request.content,
        updatedAt: new Date().toISOString()
    };
}
function resolveCreatablePath(studyRoot, practicePath, relativePath) {
    const root = node_path_1.default.resolve(studyRoot);
    const practice = node_path_1.default.resolve(practicePath);
    if (!(0, fileUtils_js_1.isPathInside)(root, practice)) {
        throw new Error("安全检查失败：练习目录必须位于学习目录内部。");
    }
    const normalizedRelativePath = relativePath.trim().replace(/\\/g, "/");
    if (!normalizedRelativePath) {
        throw new Error("请输入要创建的文件名，例如 src/helper.cpp。");
    }
    if (normalizedRelativePath.includes("\0") || node_path_1.default.isAbsolute(normalizedRelativePath)) {
        throw new Error("只能输入相对路径，不能输入绝对路径。");
    }
    const parts = normalizedRelativePath.split("/").filter(Boolean);
    if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
        throw new Error("文件路径不能包含 . 或 ..。");
    }
    if (parts.some((part) => /[<>:"|?*]/.test(part))) {
        throw new Error("文件名不能包含 Windows 不支持的字符：< > : \" | ? *。");
    }
    const target = node_path_1.default.resolve(practice, ...parts);
    if (!(0, fileUtils_js_1.isPathInside)(root, target) || !(0, fileUtils_js_1.isPathInside)(practice, target)) {
        throw new Error("安全检查失败：只能在当前练习目录内创建文件。");
    }
    return resolveEditablePath(root, target);
}
function resolveDeletablePath(studyRoot, practicePath, filePath) {
    const root = node_path_1.default.resolve(studyRoot);
    const practice = node_path_1.default.resolve(practicePath);
    const target = resolveEditablePath(root, filePath);
    if (!(0, fileUtils_js_1.isPathInside)(root, practice)) {
        throw new Error("安全检查失败：练习目录必须位于学习目录内部。");
    }
    if (!(0, fileUtils_js_1.isPathInside)(practice, target)) {
        throw new Error("安全检查失败：只能删除当前练习目录内的文件。");
    }
    return target;
}
function hasErrorCode(error, code) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
function resolveEditablePath(studyRoot, filePath) {
    const root = node_path_1.default.resolve(studyRoot);
    const target = node_path_1.default.resolve(filePath);
    if (!(0, fileUtils_js_1.isPathInside)(root, target)) {
        throw new Error("安全检查失败：只能编辑学习目录内部的文件。");
    }
    const extension = node_path_1.default.extname(target).toLowerCase();
    const filename = node_path_1.default.basename(target);
    if (!EDITABLE_EXTENSIONS.has(extension) && !EDITABLE_FILENAMES.has(filename)) {
        throw new Error("当前内置编辑器只支持 C++、Makefile、Markdown 和文本文件。");
    }
    return target;
}
async function collectEditableFiles(rootDir, currentDir, files) {
    const entries = await promises_1.default.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = node_path_1.default.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name)) {
                await collectEditableFiles(rootDir, entryPath, files);
            }
            continue;
        }
        if (!entry.isFile())
            continue;
        const extension = node_path_1.default.extname(entry.name).toLowerCase();
        if (!EDITABLE_EXTENSIONS.has(extension) && !EDITABLE_FILENAMES.has(entry.name))
            continue;
        files.push({
            path: entryPath,
            relativePath: node_path_1.default.relative(rootDir, entryPath).split(node_path_1.default.sep).join("/"),
            name: entry.name,
            extension,
            kind: getExerciseFileKind(entry.name, extension)
        });
    }
}
function getExerciseFileKind(filename, extension) {
    if ([".cpp", ".cc", ".cxx"].includes(extension))
        return "source";
    if ([".h", ".hpp"].includes(extension))
        return "header";
    if (filename === "Makefile" || filename === "makefile" || extension === ".mk")
        return "build";
    return "text";
}
function compareExerciseFiles(left, right) {
    const kindOrder = {
        source: 1,
        header: 2,
        build: 3,
        text: 4
    };
    if (left.name === "main.cpp")
        return -1;
    if (right.name === "main.cpp")
        return 1;
    if (left.name === "Makefile")
        return -1;
    if (right.name === "Makefile")
        return 1;
    if (kindOrder[left.kind] !== kindOrder[right.kind])
        return kindOrder[left.kind] - kindOrder[right.kind];
    return left.relativePath.localeCompare(right.relativePath);
}
