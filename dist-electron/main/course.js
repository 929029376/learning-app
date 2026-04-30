"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCourseOverview = buildCourseOverview;
exports.getStageContent = getStageContent;
exports.completeStage = completeStage;
exports.setCurrentStage = setCurrentStage;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const fileUtils_js_1 = require("./fileUtils.js");
const DEFAULT_CURRENT_STAGE_ID = "stage-2-13-vector-basics";
const DEFAULT_PHASE = "Phase 2";
const COMPLETED_STAGE_MARKERS_DIR = "completed-stages";
const NOTE_DIR_NAMES = ["phase-notes", "notes", "course-notes", "lesson-notes", "lessons", "docs", "study-system"];
const NOTE_EXTENSIONS = new Set([".md", ".markdown", ".mdown"]);
const NOTE_SCAN_IGNORED_DIRS = new Set([".git", ".learning-data", "node_modules", "dist", "build"]);
const NOTE_SCAN_FILE_LIMIT = 500;
const PHASE_WEIGHTS = new Map([
    [1, 10],
    [2, 15],
    [3, 10],
    [4, 10],
    [5, 10],
    [6, 10],
    [7, 10],
    [8, 10],
    [9, 15]
]);
const KNOWN_GRADES = new Map([
    ["stage-2-1", "A-"],
    ["stage-2-2", "A-"],
    ["stage-2-3", "A-"],
    ["stage-2-4", "A-"],
    ["stage-2-5", "A-"],
    ["stage-2-6", "A-"],
    ["stage-2-7", "A"],
    ["stage-2-8", "A"],
    ["stage-2-9", "A-"],
    ["stage-2-10", "A"],
    ["stage-2-11", "A-"],
    ["stage-2-12", "A-"]
]);
async function buildCourseOverview(studyRoot, sources) {
    const stages = await getStatefulStages(studyRoot);
    const state = await readCourseState(studyRoot);
    const completedStageIds = getCompletedStageIds(stages, state);
    const currentStageId = resolveCurrentStageId(stages, state.currentStageId, completedStageIds);
    const statefulStages = applyStageState(stages, currentStageId, completedStageIds);
    const progress = buildProgressSnapshot(statefulStages, currentStageId, completedStageIds);
    const overview = {
        studyRoot,
        courseName: "C++ Project Study Coach",
        industryType: "Software Engineering",
        progress,
        stages: statefulStages,
        sources,
        updatedAt: new Date().toISOString()
    };
    await writeCourseJson(studyRoot, overview, [...completedStageIds]);
    return overview;
}
async function getStageContent(studyRoot, stageId, sources) {
    const stages = await getStatefulStages(studyRoot);
    const state = await readCourseState(studyRoot);
    const completedStageIds = getCompletedStageIds(stages, state);
    const currentStageId = resolveCurrentStageId(stages, state.currentStageId, completedStageIds);
    const statefulStages = applyStageState(stages, currentStageId, completedStageIds);
    const stage = statefulStages.find((item) => item.id === stageId) ?? statefulStages[0];
    if (!stage) {
        throw new Error("No learning stages were found. Please scan the study directory first.");
    }
    const content = stage.notePath && (await (0, fileUtils_js_1.pathExists)(stage.notePath))
        ? extractStageExcerpt(await promises_1.default.readFile(stage.notePath, "utf8"), stage)
        : "No note content was found for this stage. Please rescan the study directory or create stage notes first.";
    const defaultExercisePath = stage.practicePath
        ? await findDefaultExercisePath(stage.practicePath)
        : undefined;
    const relatedSources = sources.filter((source) => {
        if (stage.notePath && source.path === stage.notePath)
            return true;
        if (stage.practicePath && source.path.startsWith(stage.practicePath))
            return true;
        return false;
    });
    return {
        stage,
        content,
        sources: relatedSources,
        defaultExercisePath
    };
}
async function completeStage(studyRoot, stageId, sources) {
    const stages = await getStatefulStages(studyRoot);
    const state = await readCourseState(studyRoot);
    const completedStageIds = getCompletedStageIds(stages, state);
    completedStageIds.add(stageId);
    await writeStageCompletionMarker(studyRoot, stageId);
    await writeCourseState(studyRoot, {
        currentStageId: getNextIncompleteStageId(stages, stageId, completedStageIds) ?? normalizeCurrentStageId(stages, stageId),
        completedStageIds: [...completedStageIds]
    });
    return buildCourseOverview(studyRoot, sources);
}
async function setCurrentStage(studyRoot, stageId, sources) {
    const stages = await getStatefulStages(studyRoot);
    const state = await readCourseState(studyRoot);
    const completedStageIds = getCompletedStageIds(stages, state);
    await writeCourseState(studyRoot, {
        currentStageId: completedStageIds.has(stageId)
            ? resolveCurrentStageId(stages, state.currentStageId, completedStageIds)
            : normalizeCurrentStageId(stages, stageId),
        completedStageIds: [...completedStageIds]
    });
    return buildCourseOverview(studyRoot, sources);
}
async function getStatefulStages(studyRoot) {
    return discoverStages(studyRoot);
}
async function discoverStages(studyRoot) {
    const practiceRoot = node_path_1.default.join(studyRoot, "practice");
    const noteRoots = await getNoteRootCandidates(studyRoot);
    const noteFiles = await collectMarkdownFilesFromRoots(noteRoots);
    const stages = [];
    if (await (0, fileUtils_js_1.pathExists)(practiceRoot)) {
        await walkPracticeDirs(practiceRoot, async (dirPath, dirName) => {
            const stageNumber = parseStageNumber(dirName);
            if (!stageNumber)
                return;
            stages.push({
                id: dirName,
                title: formatStageTitle(dirName, stageNumber),
                phase: `Phase ${stageNumber.phase}`,
                status: "not-started",
                grade: getKnownGrade(dirName),
                notePath: await findNotePath(noteRoots, noteFiles, stageNumber, dirName, dirPath),
                practicePath: dirPath
            });
        });
    }
    stages.sort((a, b) => compareStageIds(a.id, b.id));
    return stages;
}
async function walkPracticeDirs(root, onDir) {
    const entries = await promises_1.default.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const dirPath = node_path_1.default.join(root, entry.name);
        await onDir(dirPath, entry.name);
        await walkPracticeDirs(dirPath, onDir);
    }
}
function parseStageNumber(stageId) {
    const standardStage = stageId.match(/^stage-(\d+)-(\d+)/);
    if (standardStage) {
        return { phase: Number(standardStage[1]), stage: Number(standardStage[2]) };
    }
    const makefileLab = stageId.match(/^makefile-lab-(\d+)/);
    if (makefileLab) {
        return { phase: 1, stage: Number(makefileLab[1]) };
    }
    return null;
}
function formatStageTitle(stageId, stageNumber = parseStageNumber(stageId)) {
    const words = stageId
        .replace(/^stage-\d+-\d+-?/, "")
        .replace(/^makefile-lab-\d+-?/, "makefile lab ")
        .split("-")
        .filter(Boolean)
        .join(" ")
        .trim();
    if (!stageNumber)
        return words || stageId;
    return `${stageNumber.phase}.${stageNumber.stage} ${words || "learning stage"}`;
}
function compareStageIds(left, right) {
    const a = parseStageNumber(left);
    const b = parseStageNumber(right);
    if (!a || !b)
        return left.localeCompare(right);
    if (a.phase !== b.phase)
        return a.phase - b.phase;
    return a.stage - b.stage;
}
function getKnownGrade(stageId) {
    for (const [prefix, grade] of KNOWN_GRADES) {
        if (stageId === prefix || stageId.startsWith(`${prefix}-`))
            return grade;
    }
    return undefined;
}
function applyStageState(stages, currentStageId, completedStageIds) {
    return stages.map((stage) => ({
        ...stage,
        status: getStatefulStatus(stage.id, currentStageId, completedStageIds)
    }));
}
function getStatefulStatus(stageId, currentStageId, completedStageIds) {
    if (completedStageIds.has(stageId))
        return "completed";
    if (stageId === currentStageId)
        return "learning";
    return "not-started";
}
function normalizeCurrentStageId(stages, candidate) {
    if (candidate && stages.some((stage) => stage.id === candidate))
        return candidate;
    return stages[0]?.id;
}
function resolveCurrentStageId(stages, candidate, completedStageIds) {
    const normalizedCandidate = normalizeCurrentStageId(stages, candidate);
    if (normalizedCandidate && !completedStageIds.has(normalizedCandidate))
        return normalizedCandidate;
    return getNextIncompleteStageId(stages, normalizedCandidate, completedStageIds) ?? normalizedCandidate;
}
function getNextIncompleteStageId(stages, fromStageId, completedStageIds) {
    const startIndex = Math.max(0, stages.findIndex((stage) => stage.id === fromStageId));
    const stagesAfterCurrent = stages.slice(startIndex + 1);
    return [...stagesAfterCurrent, ...stages.slice(0, startIndex + 1)].find((stage) => !completedStageIds.has(stage.id))?.id;
}
function getCompletedStageIds(stages, state) {
    const completedStageIds = new Set();
    for (const stage of stages) {
        const stageNumber = parseStageNumber(stage.id);
        if (stageNumber && (stageNumber.phase < 2 || (stageNumber.phase === 2 && stageNumber.stage < 11))) {
            completedStageIds.add(stage.id);
        }
    }
    for (const stageId of state.completedStageIds) {
        completedStageIds.add(stageId);
    }
    return completedStageIds;
}
function buildProgressSnapshot(stages, currentStageId, completedStageIds) {
    const currentStage = stages.find((stage) => stage.id === currentStageId);
    const currentPhase = currentStage?.phase ?? DEFAULT_PHASE;
    const currentPhaseStages = stages.filter((stage) => stage.phase === currentPhase);
    const completedInPhase = currentPhaseStages.filter((stage) => completedStageIds.has(stage.id)).length;
    const phasePercent = currentPhaseStages.length === 0
        ? 0
        : clampPercent(Math.round((completedInPhase / currentPhaseStages.length) * 100));
    const totalPercent = clampPercent(Math.round(calculateWeightedTotalPercent(stages, completedStageIds)));
    return {
        totalLearnedPercent: totalPercent,
        totalRemainingPercent: 100 - totalPercent,
        currentPhase,
        currentPhaseLearnedPercent: phasePercent,
        currentPhaseRemainingPercent: 100 - phasePercent,
        currentStageId
    };
}
function calculateWeightedTotalPercent(stages, completedStageIds) {
    const stagesByPhase = new Map();
    for (const stage of stages) {
        const stageNumber = parseStageNumber(stage.id);
        if (!stageNumber)
            continue;
        const phaseStages = stagesByPhase.get(stageNumber.phase) ?? [];
        phaseStages.push(stage);
        stagesByPhase.set(stageNumber.phase, phaseStages);
    }
    let totalPercent = 0;
    let knownWeight = 0;
    for (const [phase, phaseStages] of stagesByPhase) {
        const weight = PHASE_WEIGHTS.get(phase) ?? 0;
        if (weight <= 0 || phaseStages.length === 0)
            continue;
        knownWeight += weight;
        const completedCount = phaseStages.filter((stage) => completedStageIds.has(stage.id)).length;
        totalPercent += weight * (completedCount / phaseStages.length);
    }
    if (knownWeight > 0 && knownWeight < 100) {
        totalPercent = (totalPercent / knownWeight) * 100;
    }
    return totalPercent;
}
function clampPercent(value) {
    return Math.min(100, Math.max(0, value));
}
async function getNoteRootCandidates(studyRoot) {
    const roots = [];
    for (const dirName of NOTE_DIR_NAMES) {
        const dirPath = node_path_1.default.join(studyRoot, dirName);
        try {
            const stat = await promises_1.default.stat(dirPath);
            if (stat.isDirectory())
                roots.push(dirPath);
        }
        catch {
            // Optional note directories are allowed to be absent.
        }
    }
    roots.push(studyRoot);
    return uniquePaths(roots);
}
async function collectMarkdownFilesFromRoots(roots) {
    const files = [];
    const seen = new Set();
    for (const root of roots) {
        const rootFiles = await collectMarkdownFiles(root);
        for (const filePath of rootFiles) {
            const key = node_path_1.default.resolve(filePath).toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            files.push(filePath);
            if (files.length >= NOTE_SCAN_FILE_LIMIT)
                return files.sort((left, right) => left.localeCompare(right));
        }
    }
    return files.sort((left, right) => left.localeCompare(right));
}
async function findNotePath(noteRoots, noteFiles, stageNumber, stageId, practicePath) {
    if (!stageNumber)
        return undefined;
    const candidates = [];
    const seen = new Set();
    const addCandidate = (candidate) => {
        if (!isMarkdownPath(candidate))
            return;
        const key = node_path_1.default.resolve(candidate).toLowerCase();
        if (seen.has(key))
            return;
        seen.add(key);
        candidates.push(candidate);
    };
    const stageBaseNames = buildStageNoteBaseNames(stageNumber, stageId);
    const phaseBaseNames = [`phase-${stageNumber.phase}-cpp-foundation`, `phase-${stageNumber.phase}`];
    const phaseDirNames = [`phase-${stageNumber.phase}`, `phase${stageNumber.phase}`, `p${stageNumber.phase}`];
    for (const root of noteRoots) {
        for (const baseName of [...stageBaseNames, ...phaseBaseNames]) {
            for (const extension of NOTE_EXTENSIONS) {
                addCandidate(node_path_1.default.join(root, `${baseName}${extension}`));
            }
        }
        for (const phaseDirName of phaseDirNames) {
            for (const baseName of stageBaseNames) {
                for (const extension of NOTE_EXTENSIONS) {
                    addCandidate(node_path_1.default.join(root, phaseDirName, `${baseName}${extension}`));
                }
            }
        }
    }
    if (practicePath) {
        const practiceBaseNames = ["README", "Readme", "readme", "notes", "NOTES", ...stageBaseNames];
        for (const baseName of practiceBaseNames) {
            for (const extension of NOTE_EXTENSIONS) {
                addCandidate(node_path_1.default.join(practicePath, `${baseName}${extension}`));
            }
        }
        for (const filePath of await collectMarkdownFiles(practicePath))
            addCandidate(filePath);
    }
    for (const filePath of noteFiles)
        addCandidate(filePath);
    const existingCandidates = [];
    for (const candidate of candidates) {
        if (await (0, fileUtils_js_1.pathExists)(candidate))
            existingCandidates.push(candidate);
    }
    const scored = await Promise.all(existingCandidates.map(async (filePath, index) => ({
        filePath,
        index,
        score: await scoreNoteCandidate(filePath, stageNumber, stageId, practicePath)
    })));
    const bestMatch = scored
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)[0];
    if (bestMatch)
        return bestMatch.filePath;
    if (scored.length === 1)
        return scored[0].filePath;
    return undefined;
}
async function findDefaultExercisePath(practicePath) {
    const candidates = ["main.cpp", "main.cc", "app.cpp"].map((file) => node_path_1.default.join(practicePath, file));
    for (const candidate of candidates) {
        if (await (0, fileUtils_js_1.pathExists)(candidate))
            return candidate;
    }
    return undefined;
}
function extractStageExcerpt(markdown, stage) {
    const stageNumber = parseStageNumber(stage.id);
    if (!stageNumber)
        return markdown.slice(0, 12000);
    const stageMarkerPattern = buildStageMarkerPattern(stageNumber, stage.id);
    const headingPattern = /^(#{1,6})\s+.*$/gm;
    let match = null;
    while ((match = headingPattern.exec(markdown))) {
        if (stageMarkerPattern.test(match[0]))
            break;
    }
    if (!match)
        return markdown.slice(0, 12000);
    const currentLevel = match[1].length;
    const start = match.index;
    const nextHeadingPattern = new RegExp(`^#{1,${currentLevel}}\\s+`, "gm");
    nextHeadingPattern.lastIndex = start + match[0].length;
    const nextHeading = nextHeadingPattern.exec(markdown);
    const end = nextHeading ? nextHeading.index : markdown.length;
    return markdown.slice(start, end).trim();
}
function buildStageNoteBaseNames(stageNumber, stageId) {
    return uniqueStrings([
        stageId,
        `stage-${stageNumber.phase}-${stageNumber.stage}`,
        `phase-${stageNumber.phase}-stage-${stageNumber.stage}`,
        `phase-${stageNumber.phase}-${stageNumber.stage}`,
        `${stageNumber.phase}.${stageNumber.stage}`,
        `${stageNumber.phase}-${stageNumber.stage}`,
        `${stageNumber.phase}_${stageNumber.stage}`
    ].filter((item) => Boolean(item)));
}
async function collectMarkdownFiles(root) {
    const files = [];
    const seenDirs = new Set();
    await collectMarkdownFilesInDir(root, files, seenDirs);
    return files.sort((left, right) => left.localeCompare(right));
}
async function collectMarkdownFilesInDir(currentDir, files, seenDirs) {
    if (files.length >= NOTE_SCAN_FILE_LIMIT)
        return;
    const resolvedDir = node_path_1.default.resolve(currentDir);
    const dirKey = resolvedDir.toLowerCase();
    if (seenDirs.has(dirKey))
        return;
    seenDirs.add(dirKey);
    let entries;
    try {
        entries = await promises_1.default.readdir(resolvedDir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (files.length >= NOTE_SCAN_FILE_LIMIT)
            return;
        const entryPath = node_path_1.default.join(resolvedDir, entry.name);
        if (entry.isDirectory()) {
            if (!NOTE_SCAN_IGNORED_DIRS.has(entry.name.toLowerCase())) {
                await collectMarkdownFilesInDir(entryPath, files, seenDirs);
            }
            continue;
        }
        if (entry.isFile() && isMarkdownPath(entryPath)) {
            files.push(entryPath);
        }
    }
}
async function scoreNoteCandidate(filePath, stageNumber, stageId, practicePath) {
    let score = 0;
    const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
    const baseName = node_path_1.default.basename(filePath, node_path_1.default.extname(filePath)).toLowerCase();
    const fileName = node_path_1.default.basename(filePath).toLowerCase();
    const stageMarkers = buildStageMarkers(stageNumber, stageId);
    const stageMarkerPattern = buildStageMarkerPattern(stageNumber, stageId);
    if (stageMarkers.some((marker) => baseName === marker || baseName.startsWith(`${marker}-`)))
        score += 500;
    if (stageMarkerPattern.test(normalizedPath))
        score += 180;
    if (normalizedPath.includes(`/phase-${stageNumber.phase}/`) || normalizedPath.includes(`phase-${stageNumber.phase}-`)) {
        score += 60;
    }
    if (fileName === `phase-${stageNumber.phase}-cpp-foundation.md` || fileName === `phase-${stageNumber.phase}.md`) {
        score += 40;
    }
    if (practicePath && isPathWithin(practicePath, filePath)) {
        score += 80;
        if (fileName.startsWith("readme") || fileName.startsWith("notes"))
            score += 20;
    }
    const preview = await readMarkdownPreview(filePath);
    if (hasStageHeading(preview, stageNumber, stageId))
        score += 1000;
    else if (stageMarkerPattern.test(preview))
        score += 180;
    if (buildPhaseMarkerPattern(stageNumber.phase).test(preview))
        score += 30;
    return score;
}
async function readMarkdownPreview(filePath) {
    try {
        return (await promises_1.default.readFile(filePath, "utf8")).slice(0, 120000);
    }
    catch {
        return "";
    }
}
function hasStageHeading(markdown, stageNumber, stageId) {
    const stageMarkerPattern = buildStageMarkerPattern(stageNumber, stageId);
    return markdown
        .split(/\r?\n/)
        .some((line) => /^#{1,6}\s+/.test(line) && stageMarkerPattern.test(line));
}
function buildStageMarkers(stageNumber, stageId) {
    return uniqueStrings([
        stageId?.toLowerCase(),
        `stage-${stageNumber.phase}-${stageNumber.stage}`,
        `${stageNumber.phase}.${stageNumber.stage}`,
        `${stageNumber.phase}-${stageNumber.stage}`,
        `${stageNumber.phase}_${stageNumber.stage}`
    ].filter((item) => Boolean(item)));
}
function buildStageMarkerPattern(stageNumber, stageId) {
    const markers = buildStageMarkers(stageNumber, stageId).map(escapeRegExp).join("|");
    return new RegExp(`(^|[^a-z0-9])(?:${markers})(?![a-z0-9])`, "i");
}
function buildPhaseMarkerPattern(phase) {
    return new RegExp(`(^|[^a-z0-9])phase\\s*-?\\s*${phase}(?![a-z0-9])`, "i");
}
function isMarkdownPath(filePath) {
    return NOTE_EXTENSIONS.has(node_path_1.default.extname(filePath).toLowerCase());
}
function isPathWithin(basePath, targetPath) {
    const relative = node_path_1.default.relative(node_path_1.default.resolve(basePath), node_path_1.default.resolve(targetPath));
    return relative === "" || (!relative.startsWith("..") && !node_path_1.default.isAbsolute(relative));
}
function uniquePaths(paths) {
    const result = [];
    const seen = new Set();
    for (const item of paths) {
        const key = node_path_1.default.resolve(item).toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(item);
    }
    return result;
}
function uniqueStrings(values) {
    return [...new Set(values)];
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function readCourseState(studyRoot) {
    const coursePath = getCourseJsonPath(studyRoot);
    const completedStageIds = new Set(await readStageCompletionMarkers(studyRoot));
    if (!(await (0, fileUtils_js_1.pathExists)(coursePath))) {
        return { currentStageId: DEFAULT_CURRENT_STAGE_ID, completedStageIds: [...completedStageIds] };
    }
    try {
        const parsed = JSON.parse(await promises_1.default.readFile(coursePath, "utf8"));
        if (Array.isArray(parsed.completedStageIds)) {
            for (const stageId of parsed.completedStageIds)
                completedStageIds.add(stageId);
        }
        if (Array.isArray(parsed.stages)) {
            for (const stage of parsed.stages) {
                if (stage.status === "completed")
                    completedStageIds.add(stage.id);
            }
        }
        return {
            currentStageId: parsed.progress?.currentStageId ?? DEFAULT_CURRENT_STAGE_ID,
            completedStageIds: [...completedStageIds]
        };
    }
    catch {
        return { currentStageId: DEFAULT_CURRENT_STAGE_ID, completedStageIds: [...completedStageIds] };
    }
}
async function readStageCompletionMarkers(studyRoot) {
    const markersPath = getCompletedStageMarkersPath(studyRoot);
    try {
        const entries = await promises_1.default.readdir(markersPath, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map((entry) => entry.name.slice(0, -".json".length))
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
async function writeStageCompletionMarker(studyRoot, stageId) {
    const markersPath = getCompletedStageMarkersPath(studyRoot);
    await (0, fileUtils_js_1.ensureDir)(markersPath);
    await promises_1.default.writeFile(node_path_1.default.join(markersPath, `${stageId}.json`), `${JSON.stringify({ stageId, completedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}
async function writeCourseState(studyRoot, state) {
    const sources = [];
    const stages = await getStatefulStages(studyRoot);
    const completedStageIds = new Set(state.completedStageIds);
    const currentStageId = resolveCurrentStageId(stages, state.currentStageId, completedStageIds);
    const statefulStages = applyStageState(stages, currentStageId, completedStageIds);
    await writeCourseJson(studyRoot, {
        studyRoot,
        courseName: "C++ Project Study Coach",
        industryType: "Software Engineering",
        progress: buildProgressSnapshot(statefulStages, currentStageId, completedStageIds),
        stages: statefulStages,
        sources,
        updatedAt: new Date().toISOString()
    }, [...completedStageIds]);
}
async function writeCourseJson(studyRoot, overview, completedStageIds) {
    const coursePath = getCourseJsonPath(studyRoot);
    await (0, fileUtils_js_1.ensureDir)(node_path_1.default.dirname(coursePath));
    const payload = {
        schemaVersion: 1,
        courseName: overview.courseName,
        industryType: overview.industryType,
        studyRoot: overview.studyRoot,
        progress: overview.progress,
        completedStageIds,
        stages: overview.stages.map((stage) => ({
            ...stage,
            notePath: stage.notePath ? (0, fileUtils_js_1.toRelativePath)(studyRoot, stage.notePath) : undefined,
            practicePath: stage.practicePath ? (0, fileUtils_js_1.toRelativePath)(studyRoot, stage.practicePath) : undefined
        })),
        updatedAt: overview.updatedAt
    };
    await promises_1.default.writeFile(coursePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
function getCourseJsonPath(studyRoot) {
    return node_path_1.default.join((0, fileUtils_js_1.getLearningDataPath)(studyRoot), "course.json");
}
function getCompletedStageMarkersPath(studyRoot) {
    return node_path_1.default.join((0, fileUtils_js_1.getLearningDataPath)(studyRoot), COMPLETED_STAGE_MARKERS_DIR);
}
