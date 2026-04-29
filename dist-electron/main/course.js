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
const DEFAULT_CURRENT_STAGE_ID = "stage-2-11-struct-basics";
const DEFAULT_TOTAL_PERCENT = 21;
const DEFAULT_PHASE_PERCENT = 70;
const DEFAULT_PHASE = "Phase 2";
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
    ["stage-2-10", "A"]
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
    const noteRoot = node_path_1.default.join(studyRoot, "phase-notes");
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
                notePath: await findNotePath(noteRoot, stageNumber.phase),
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
        if (stageId.startsWith(prefix))
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
    const baselineCompletedInPhase = Math.min(10, currentPhaseStages.length);
    const remainingAfterBaseline = Math.max(1, currentPhaseStages.length - baselineCompletedInPhase);
    const extraCompleted = Math.max(0, completedInPhase - baselineCompletedInPhase);
    const phasePercent = clampPercent(Math.round(DEFAULT_PHASE_PERCENT + (extraCompleted / remainingAfterBaseline) * (100 - DEFAULT_PHASE_PERCENT)));
    const totalPercent = clampPercent(DEFAULT_TOTAL_PERCENT + Math.round((phasePercent - DEFAULT_PHASE_PERCENT) * 0.1));
    return {
        totalLearnedPercent: totalPercent,
        totalRemainingPercent: 100 - totalPercent,
        currentPhase,
        currentPhaseLearnedPercent: phasePercent,
        currentPhaseRemainingPercent: 100 - phasePercent,
        currentStageId
    };
}
function clampPercent(value) {
    return Math.min(100, Math.max(0, value));
}
async function findNotePath(noteRoot, phase) {
    if (!phase)
        return undefined;
    const candidates = [
        node_path_1.default.join(noteRoot, `phase-${phase}-cpp-foundation.md`),
        node_path_1.default.join(noteRoot, `phase-${phase}.md`)
    ];
    for (const candidate of candidates) {
        if (await (0, fileUtils_js_1.pathExists)(candidate))
            return candidate;
    }
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
    const numberMatch = stage.title.match(/^(\d+\.\d+)/);
    if (!numberMatch)
        return markdown.slice(0, 12000);
    const escapedNumber = numberMatch[1].replace(".", "\\.");
    const headingPattern = new RegExp(`^(#{1,4})\\s+.*${escapedNumber}.*$`, "im");
    const match = headingPattern.exec(markdown);
    if (!match)
        return markdown.slice(0, 12000);
    const currentLevel = match[1].length;
    const start = match.index;
    const rest = markdown.slice(start + match[0].length);
    const nextHeadingPattern = new RegExp(`^#{1,${currentLevel}}\\s+`, "m");
    const nextHeading = nextHeadingPattern.exec(rest);
    const end = nextHeading ? start + match[0].length + nextHeading.index : markdown.length;
    return markdown.slice(start, end).trim();
}
async function readCourseState(studyRoot) {
    const coursePath = getCourseJsonPath(studyRoot);
    if (!(await (0, fileUtils_js_1.pathExists)(coursePath))) {
        return { currentStageId: DEFAULT_CURRENT_STAGE_ID, completedStageIds: [] };
    }
    try {
        const parsed = JSON.parse(await promises_1.default.readFile(coursePath, "utf8"));
        const completedStageIds = new Set();
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
        return { currentStageId: DEFAULT_CURRENT_STAGE_ID, completedStageIds: [] };
    }
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
