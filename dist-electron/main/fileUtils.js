"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEARNING_DATA_DIR = exports.DEFAULT_STUDY_ROOT = void 0;
exports.pathExists = pathExists;
exports.isDirectory = isDirectory;
exports.ensureDir = ensureDir;
exports.getLearningDataPath = getLearningDataPath;
exports.getRunsPath = getRunsPath;
exports.ensureStudyDataDirs = ensureStudyDataDirs;
exports.isSupportedSource = isSupportedSource;
exports.getSourceType = getSourceType;
exports.toRelativePath = toRelativePath;
exports.sourceIdFromRelativePath = sourceIdFromRelativePath;
exports.hashFile = hashFile;
exports.isPathInside = isPathInside;
exports.windowsPathToWslPath = windowsPathToWslPath;
exports.escapeCommandPart = escapeCommandPart;
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
exports.DEFAULT_STUDY_ROOT = getDefaultStudyRoot();
exports.LEARNING_DATA_DIR = ".learning-data";
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
function getDefaultStudyRoot() {
    if (process.platform === "win32")
        return "F:\\BaiduSyncdisk\\cpp-search-study-sync";
    return node_path_1.default.join(node_os_1.default.homedir(), "BaiduSyncdisk", "cpp-search-study-sync");
}
async function pathExists(targetPath) {
    try {
        await promises_1.default.access(targetPath);
        return true;
    }
    catch {
        return false;
    }
}
async function isDirectory(targetPath) {
    try {
        const stat = await promises_1.default.stat(targetPath);
        return stat.isDirectory();
    }
    catch {
        return false;
    }
}
async function ensureDir(targetPath) {
    await promises_1.default.mkdir(targetPath, { recursive: true });
}
function getLearningDataPath(studyRoot) {
    return node_path_1.default.join(studyRoot, exports.LEARNING_DATA_DIR);
}
function getRunsPath(studyRoot) {
    return node_path_1.default.join(getLearningDataPath(studyRoot), "runs");
}
async function ensureStudyDataDirs(studyRoot) {
    await ensureDir(getLearningDataPath(studyRoot));
    await ensureDir(getRunsPath(studyRoot));
}
function isSupportedSource(filePath) {
    return SOURCE_EXTENSIONS.has(node_path_1.default.extname(filePath).toLowerCase());
}
function getSourceType(filePath) {
    const ext = node_path_1.default.extname(filePath).toLowerCase();
    if (ext === ".md" || ext === ".markdown" || ext === ".mdown")
        return "markdown";
    if (ext === ".txt")
        return "text";
    if (ext === ".pdf")
        return "pdf";
    if (ext === ".docx")
        return "docx";
    if (ext === ".pptx")
        return "pptx";
    if (ext === ".cpp" || ext === ".cc" || ext === ".cxx")
        return "cpp";
    if (ext === ".h" || ext === ".hpp")
        return "header";
    return "unknown";
}
function toRelativePath(rootPath, targetPath) {
    return node_path_1.default.relative(rootPath, targetPath).split(node_path_1.default.sep).join("/");
}
function sourceIdFromRelativePath(relativePath) {
    return node_crypto_1.default.createHash("sha1").update(relativePath.toLowerCase()).digest("hex");
}
async function hashFile(filePath) {
    const buffer = await promises_1.default.readFile(filePath);
    return node_crypto_1.default.createHash("sha256").update(buffer).digest("hex");
}
function isPathInside(basePath, targetPath) {
    const resolvedBase = node_path_1.default.resolve(basePath);
    const resolvedTarget = node_path_1.default.resolve(targetPath);
    const relative = node_path_1.default.relative(resolvedBase, resolvedTarget);
    return relative === "" || (!relative.startsWith("..") && !node_path_1.default.isAbsolute(relative));
}
function windowsPathToWslPath(filePath) {
    const resolved = node_path_1.default.resolve(filePath);
    const drive = resolved.slice(0, 1).toLowerCase();
    const rest = resolved.slice(2).replace(/\\/g, "/");
    return `/mnt/${drive}${rest}`;
}
function escapeCommandPart(value) {
    if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) {
        return value;
    }
    return `"${value.replace(/"/g, '\\"')}"`;
}
