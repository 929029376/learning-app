import fs from "node:fs/promises";
import path from "node:path";

import type { CourseOverview, LearningSource, LearningStage, ProgressSnapshot, StageStatus } from "../shared/types.js";
import { ensureDir, getLearningDataPath, pathExists, toRelativePath } from "./fileUtils.js";

const DEFAULT_CURRENT_STAGE_ID = "stage-2-13-vector-basics";
const DEFAULT_PHASE = "Phase 2";
const COMPLETED_STAGE_MARKERS_DIR = "completed-stages";
const NOTE_DIR_NAMES = ["phase-notes", "notes", "course-notes", "lesson-notes", "lessons", "docs", "study-system"];
const NOTE_EXTENSIONS = new Set([".md", ".markdown", ".mdown"]);
const NOTE_SCAN_IGNORED_DIRS = new Set([".git", ".learning-data", "node_modules", "dist", "build"]);
const NOTE_SCAN_FILE_LIMIT = 500;
const PHASE_WEIGHTS = new Map<number, number>([
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

const KNOWN_GRADES = new Map<string, string>([
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

const STAGE_TITLES = new Map<string, string>([
  ["makefile-lab-01", "1.1 Makefile 入门练习"],
  ["makefile-lab-02-auto-sources", "1.2 Makefile 自动收集源文件"],
  ["makefile-lab-03-vpath", "1.3 Makefile vpath 练习"],
  ["stage-2-1-io-vars", "2.1 输入输出、变量与类型"],
  ["stage-2-2-operators-if", "2.2 运算、比较与简单分支"],
  ["stage-2-3-functions", "2.3 函数基础"],
  ["stage-2-4-function-declaration", "2.4 函数声明、定义与调用顺序"],
  ["stage-2-5-scope-local-vars", "2.5 作用域与局部变量"],
  ["stage-2-6-references", "2.6 引用基础"],
  ["stage-2-7-const-basics", "2.7 const 基础"],
  ["stage-2-8-string-basics", "2.8 std::string 基础"],
  ["stage-2-9-getline-basics", "2.9 std::getline 基础"],
  ["stage-2-10-string-review", "2.10 string 小结与强化"],
  ["stage-2-11-struct-basics", "2.11 struct 基础"],
  ["stage-2-12-pointer-basics", "2.12 指针基础"],
  ["stage-2-13-vector-basics", "2.13 vector 基础"],
  ["stage-2-14-vector-review-mini-project", "2.14 vector 综合小项目"],
  ["stage-2-15-cpp-foundation-review", "2.15 C++ 基础阶段总复盘"],
  ["stage-3-1-class-basics", "3.1 class 基础"],
  ["stage-3-2-constructors", "3.2 构造函数"],
  ["stage-3-3-member-functions", "3.3 成员函数"],
  ["stage-3-4-const-member-functions", "3.4 const 成员函数"],
  ["stage-3-5-class-header-source", "3.5 类的头文件与源文件拆分"],
  ["stage-3-6-encapsulation", "3.6 封装"],
  ["stage-3-7-composition", "3.7 组合"],
  ["stage-3-8-oop-mini-project", "3.8 面向对象小项目"],
  ["stage-4-1-vector-review", "4.1 vector 复习"],
  ["stage-4-2-map-basics", "4.2 map 基础"],
  ["stage-4-3-unordered-map-basics", "4.3 unordered_map 基础"],
  ["stage-4-4-set-basics", "4.4 set 基础"],
  ["stage-4-5-ifstream-basics", "4.5 ifstream 文件读取"],
  ["stage-4-6-ofstream-basics", "4.6 ofstream 文件写入"],
  ["stage-4-7-stringstream-parsing", "4.7 stringstream 解析"],
  ["stage-4-8-container-io-mini-project", "4.8 容器与文件 IO 小项目"],
  ["stage-5-1-object-lifetime", "5.1 对象生命周期"],
  ["stage-5-2-new-delete-basics", "5.2 new/delete 基础"],
  ["stage-5-3-raii-basics", "5.3 RAII 基础"],
  ["stage-5-4-unique-ptr-basics", "5.4 unique_ptr 基础"],
  ["stage-5-5-shared-ptr-basics", "5.5 shared_ptr 基础"],
  ["stage-5-6-inheritance-basics", "5.6 继承基础"],
  ["stage-5-7-virtual-functions", "5.7 虚函数"],
  ["stage-5-8-polymorphism-mini-project", "5.8 多态小项目"],
  ["stage-6-1-iterator-basics", "6.1 迭代器基础"],
  ["stage-6-2-range-for", "6.2 range-for"],
  ["stage-6-3-algorithm-basics", "6.3 标准算法基础"],
  ["stage-6-4-lambda-basics", "6.4 lambda 基础"],
  ["stage-6-5-function-callback", "6.5 function 回调"],
  ["stage-6-6-custom-sort", "6.6 自定义排序"],
  ["stage-6-7-status-error-handling", "6.7 状态与错误处理"],
  ["stage-6-8-callback-mini-project", "6.8 回调小项目"],
  ["stage-7-1-thread-concept", "7.1 线程概念"],
  ["stage-7-2-std-thread", "7.2 std::thread"],
  ["stage-7-3-mutex-basics", "7.3 mutex 基础"],
  ["stage-7-4-lock-guard", "7.4 lock_guard"],
  ["stage-7-5-condition-variable", "7.5 condition_variable"],
  ["stage-7-6-producer-consumer", "7.6 生产者消费者"],
  ["stage-7-7-thread-pool-design", "7.7 线程池设计"],
  ["stage-7-8-thread-pool-implementation", "7.8 线程池实现"],
  ["stage-8-1-socket-concept", "8.1 socket 概念"],
  ["stage-8-2-tcp-server-minimal", "8.2 最小 TCP 服务器"],
  ["stage-8-3-accept-read-write", "8.3 accept/read/write"],
  ["stage-8-4-nonblocking-io", "8.4 非阻塞 IO"],
  ["stage-8-5-epoll-concept", "8.5 epoll 概念"],
  ["stage-8-6-event-loop", "8.6 事件循环"],
  ["stage-8-7-reactor-components", "8.7 Reactor 组件"],
  ["stage-8-8-reactor-mini-project", "8.8 Reactor 小项目"],
  ["stage-9-1-project-architecture", "9.1 项目架构"],
  ["stage-9-2-webpage-model", "9.2 WebPage 模型"],
  ["stage-9-3-file-reader", "9.3 文件读取器"],
  ["stage-9-4-page-parser", "9.4 页面解析器"],
  ["stage-9-5-page-library", "9.5 页面库"],
  ["stage-9-6-word-segmenter-mock", "9.6 模拟分词器"],
  ["stage-9-7-inverted-index", "9.7 倒排索引"],
  ["stage-9-8-query-parser", "9.8 查询解析器"],
  ["stage-9-9-searcher", "9.9 搜索器"],
  ["stage-9-10-cache", "9.10 缓存"],
  ["stage-9-11-thread-pool-integration", "9.11 线程池整合"],
  ["stage-9-12-tcp-server-integration", "9.12 TCP 服务器整合"],
  ["stage-9-13-online-server", "9.13 在线服务"],
  ["stage-9-14-tests-debugging", "9.14 测试与调试"],
  ["stage-9-15-final-review-refactor", "9.15 最终复盘与重构"]
]);

interface CourseState {
  currentStageId?: string;
  completedStageIds: string[];
}

interface CourseJson {
  progress?: Partial<ProgressSnapshot>;
  completedStageIds?: string[];
  stages?: Array<Pick<LearningStage, "id" | "status">>;
}

export interface StageContent {
  stage: LearningStage;
  content: string;
  sources: LearningSource[];
  defaultExercisePath?: string;
}

export async function buildCourseOverview(studyRoot: string, sources: LearningSource[]): Promise<CourseOverview> {
  const stages = await getStatefulStages(studyRoot);
  const state = await readCourseState(studyRoot);
  const completedStageIds = getCompletedStageIds(stages, state);
  const currentStageId = resolveCurrentStageId(stages, state.currentStageId, completedStageIds);
  const statefulStages = applyStageState(stages, currentStageId, completedStageIds);
  const progress = buildProgressSnapshot(statefulStages, currentStageId, completedStageIds);

  const overview: CourseOverview = {
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

export async function getStageContent(studyRoot: string, stageId: string, sources: LearningSource[]): Promise<StageContent> {
  const stages = await getStatefulStages(studyRoot);
  const state = await readCourseState(studyRoot);
  const completedStageIds = getCompletedStageIds(stages, state);
  const currentStageId = resolveCurrentStageId(stages, state.currentStageId, completedStageIds);
  const statefulStages = applyStageState(stages, currentStageId, completedStageIds);
  const stage = statefulStages.find((item) => item.id === stageId) ?? statefulStages[0];
  if (!stage) {
    throw new Error("No learning stages were found. Please scan the study directory first.");
  }

  const content = stage.notePath && (await pathExists(stage.notePath))
    ? extractStageExcerpt(await fs.readFile(stage.notePath, "utf8"), stage)
    : "No note content was found for this stage. Please rescan the study directory or create stage notes first.";

  const defaultExercisePath = stage.practicePath
    ? await findDefaultExercisePath(stage.practicePath)
    : undefined;

  const relatedSources = sources.filter((source) => {
    if (stage.notePath && source.path === stage.notePath) return true;
    if (stage.practicePath && source.path.startsWith(stage.practicePath)) return true;
    return false;
  });

  return {
    stage,
    content,
    sources: relatedSources,
    defaultExercisePath
  };
}

export async function completeStage(studyRoot: string, stageId: string, sources: LearningSource[]): Promise<CourseOverview> {
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

export async function setCurrentStage(studyRoot: string, stageId: string, sources: LearningSource[]): Promise<CourseOverview> {
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

async function getStatefulStages(studyRoot: string): Promise<LearningStage[]> {
  return discoverStages(studyRoot);
}

async function discoverStages(studyRoot: string): Promise<LearningStage[]> {
  const practiceRoot = path.join(studyRoot, "practice");
  const noteRoots = await getNoteRootCandidates(studyRoot);
  const noteFiles = await collectMarkdownFilesFromRoots(noteRoots);
  const stages: LearningStage[] = [];

  if (await pathExists(practiceRoot)) {
    await walkPracticeDirs(practiceRoot, async (dirPath, dirName) => {
      const stageNumber = parseStageNumber(dirName);
      if (!stageNumber) return;
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

async function walkPracticeDirs(root: string, onDir: (dirPath: string, dirName: string) => Promise<void>): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(root, entry.name);
    await onDir(dirPath, entry.name);
    await walkPracticeDirs(dirPath, onDir);
  }
}

function parseStageNumber(stageId: string): { phase: number; stage: number } | null {
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

function formatStageTitle(stageId: string, stageNumber = parseStageNumber(stageId)): string {
  const knownTitle = STAGE_TITLES.get(stageId);
  if (knownTitle) return knownTitle;

  const words = stageId
    .replace(/^stage-\d+-\d+-?/, "")
    .replace(/^makefile-lab-\d+-?/, "makefile lab ")
    .split("-")
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!stageNumber) return words || stageId;
  return `${stageNumber.phase}.${stageNumber.stage} ${words || "learning stage"}`;
}

function compareStageIds(left: string, right: string): number {
  const a = parseStageNumber(left);
  const b = parseStageNumber(right);
  if (!a || !b) return left.localeCompare(right);
  if (a.phase !== b.phase) return a.phase - b.phase;
  return a.stage - b.stage;
}

function getKnownGrade(stageId: string): string | undefined {
  for (const [prefix, grade] of KNOWN_GRADES) {
    if (stageId === prefix || stageId.startsWith(`${prefix}-`)) return grade;
  }
  return undefined;
}

function applyStageState(stages: LearningStage[], currentStageId: string | undefined, completedStageIds: Set<string>): LearningStage[] {
  return stages.map((stage) => ({
    ...stage,
    status: getStatefulStatus(stage.id, currentStageId, completedStageIds)
  }));
}

function getStatefulStatus(stageId: string, currentStageId: string | undefined, completedStageIds: Set<string>): StageStatus {
  if (completedStageIds.has(stageId)) return "completed";
  if (stageId === currentStageId) return "learning";
  return "not-started";
}

function normalizeCurrentStageId(stages: LearningStage[], candidate?: string): string | undefined {
  if (candidate && stages.some((stage) => stage.id === candidate)) return candidate;
  return stages[0]?.id;
}

function resolveCurrentStageId(stages: LearningStage[], candidate: string | undefined, completedStageIds: Set<string>): string | undefined {
  const normalizedCandidate = normalizeCurrentStageId(stages, candidate);
  if (normalizedCandidate && !completedStageIds.has(normalizedCandidate)) return normalizedCandidate;
  return getNextIncompleteStageId(stages, normalizedCandidate, completedStageIds) ?? normalizedCandidate;
}

function getNextIncompleteStageId(stages: LearningStage[], fromStageId: string | undefined, completedStageIds: Set<string>): string | undefined {
  const startIndex = Math.max(0, stages.findIndex((stage) => stage.id === fromStageId));
  const stagesAfterCurrent = stages.slice(startIndex + 1);
  return [...stagesAfterCurrent, ...stages.slice(0, startIndex + 1)].find((stage) => !completedStageIds.has(stage.id))?.id;
}

function getCompletedStageIds(stages: LearningStage[], state: CourseState): Set<string> {
  const completedStageIds = new Set<string>();
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

function buildProgressSnapshot(stages: LearningStage[], currentStageId: string | undefined, completedStageIds: Set<string>): ProgressSnapshot {
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

function calculateWeightedTotalPercent(stages: LearningStage[], completedStageIds: Set<string>): number {
  const stagesByPhase = new Map<number, LearningStage[]>();
  for (const stage of stages) {
    const stageNumber = parseStageNumber(stage.id);
    if (!stageNumber) continue;
    const phaseStages = stagesByPhase.get(stageNumber.phase) ?? [];
    phaseStages.push(stage);
    stagesByPhase.set(stageNumber.phase, phaseStages);
  }

  let totalPercent = 0;
  let knownWeight = 0;
  for (const [phase, phaseStages] of stagesByPhase) {
    const weight = PHASE_WEIGHTS.get(phase) ?? 0;
    if (weight <= 0 || phaseStages.length === 0) continue;
    knownWeight += weight;
    const completedCount = phaseStages.filter((stage) => completedStageIds.has(stage.id)).length;
    totalPercent += weight * (completedCount / phaseStages.length);
  }

  if (knownWeight > 0 && knownWeight < 100) {
    totalPercent = (totalPercent / knownWeight) * 100;
  }
  return totalPercent;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

async function getNoteRootCandidates(studyRoot: string): Promise<string[]> {
  const roots: string[] = [];
  for (const dirName of NOTE_DIR_NAMES) {
    const dirPath = path.join(studyRoot, dirName);
    try {
      const stat = await fs.stat(dirPath);
      if (stat.isDirectory()) roots.push(dirPath);
    } catch {
      // Optional note directories are allowed to be absent.
    }
  }
  roots.push(studyRoot);
  return uniquePaths(roots);
}

async function collectMarkdownFilesFromRoots(roots: string[]): Promise<string[]> {
  const files: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const rootFiles = await collectMarkdownFiles(root);
    for (const filePath of rootFiles) {
      const key = path.resolve(filePath).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(filePath);
      if (files.length >= NOTE_SCAN_FILE_LIMIT) return files.sort((left, right) => left.localeCompare(right));
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function findNotePath(
  noteRoots: string[],
  noteFiles: string[],
  stageNumber?: { phase: number; stage: number },
  stageId?: string,
  practicePath?: string
): Promise<string | undefined> {
  if (!stageNumber) return undefined;

  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: string) => {
    if (!isMarkdownPath(candidate)) return;
    const key = path.resolve(candidate).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const stageBaseNames = buildStageNoteBaseNames(stageNumber, stageId);
  const phaseBaseNames = [`phase-${stageNumber.phase}-cpp-foundation`, `phase-${stageNumber.phase}`];
  const phaseDirNames = [`phase-${stageNumber.phase}`, `phase${stageNumber.phase}`, `p${stageNumber.phase}`];

  for (const root of noteRoots) {
    for (const baseName of [...stageBaseNames, ...phaseBaseNames]) {
      for (const extension of NOTE_EXTENSIONS) {
        addCandidate(path.join(root, `${baseName}${extension}`));
      }
    }

    for (const phaseDirName of phaseDirNames) {
      for (const baseName of stageBaseNames) {
        for (const extension of NOTE_EXTENSIONS) {
          addCandidate(path.join(root, phaseDirName, `${baseName}${extension}`));
        }
      }
    }
  }

  if (practicePath) {
    const practiceBaseNames = ["README", "Readme", "readme", "notes", "NOTES", ...stageBaseNames];
    for (const baseName of practiceBaseNames) {
      for (const extension of NOTE_EXTENSIONS) {
        addCandidate(path.join(practicePath, `${baseName}${extension}`));
      }
    }
    for (const filePath of await collectMarkdownFiles(practicePath)) addCandidate(filePath);
  }

  for (const filePath of noteFiles) addCandidate(filePath);

  const existingCandidates: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) existingCandidates.push(candidate);
  }

  const scored = await Promise.all(
    existingCandidates.map(async (filePath, index) => ({
      filePath,
      index,
      score: await scoreNoteCandidate(filePath, stageNumber, stageId, practicePath)
    }))
  );

  const bestMatch = scored
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0];
  if (bestMatch) return bestMatch.filePath;
  if (scored.length === 1) return scored[0].filePath;
  return undefined;
}

async function findDefaultExercisePath(practicePath: string): Promise<string | undefined> {
  const candidates = ["main.cpp", "main.cc", "app.cpp"].map((file) => path.join(practicePath, file));
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
}

function extractStageExcerpt(markdown: string, stage: LearningStage): string {
  const stageNumber = parseStageNumber(stage.id);
  if (!stageNumber) return markdown.slice(0, 12000);

  const stageMarkerPattern = buildStageMarkerPattern(stageNumber, stage.id);
  const headingPattern = /^(#{1,6})\s+.*$/gm;
  let match: RegExpExecArray | null = null;
  while ((match = headingPattern.exec(markdown))) {
    if (stageMarkerPattern.test(match[0])) break;
  }
  if (!match) return markdown.slice(0, 12000);

  const currentLevel = match[1].length;
  const start = match.index;
  const nextHeadingPattern = new RegExp(`^#{1,${currentLevel}}\\s+`, "gm");
  nextHeadingPattern.lastIndex = start + match[0].length;
  const nextHeading = nextHeadingPattern.exec(markdown);
  const end = nextHeading ? nextHeading.index : markdown.length;
  return markdown.slice(start, end).trim();
}

function buildStageNoteBaseNames(stageNumber: { phase: number; stage: number }, stageId?: string): string[] {
  return uniqueStrings([
    stageId,
    `stage-${stageNumber.phase}-${stageNumber.stage}`,
    `phase-${stageNumber.phase}-stage-${stageNumber.stage}`,
    `phase-${stageNumber.phase}-${stageNumber.stage}`,
    `${stageNumber.phase}.${stageNumber.stage}`,
    `${stageNumber.phase}-${stageNumber.stage}`,
    `${stageNumber.phase}_${stageNumber.stage}`
  ].filter((item): item is string => Boolean(item)));
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const seenDirs = new Set<string>();
  await collectMarkdownFilesInDir(root, files, seenDirs);
  return files.sort((left, right) => left.localeCompare(right));
}

async function collectMarkdownFilesInDir(currentDir: string, files: string[], seenDirs: Set<string>): Promise<void> {
  if (files.length >= NOTE_SCAN_FILE_LIMIT) return;

  const resolvedDir = path.resolve(currentDir);
  const dirKey = resolvedDir.toLowerCase();
  if (seenDirs.has(dirKey)) return;
  seenDirs.add(dirKey);

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(resolvedDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= NOTE_SCAN_FILE_LIMIT) return;
    const entryPath = path.join(resolvedDir, entry.name);
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

async function scoreNoteCandidate(
  filePath: string,
  stageNumber: { phase: number; stage: number },
  stageId?: string,
  practicePath?: string
): Promise<number> {
  let score = 0;
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
  const baseName = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();
  const stageMarkers = buildStageMarkers(stageNumber, stageId);
  const stageMarkerPattern = buildStageMarkerPattern(stageNumber, stageId);

  if (stageMarkers.some((marker) => baseName === marker || baseName.startsWith(`${marker}-`))) score += 500;
  if (stageMarkerPattern.test(normalizedPath)) score += 180;
  if (normalizedPath.includes(`/phase-${stageNumber.phase}/`) || normalizedPath.includes(`phase-${stageNumber.phase}-`)) {
    score += 60;
  }
  if (fileName === `phase-${stageNumber.phase}-cpp-foundation.md` || fileName === `phase-${stageNumber.phase}.md`) {
    score += 40;
  }
  if (practicePath && isPathWithin(practicePath, filePath)) {
    score += 80;
    if (fileName.startsWith("readme") || fileName.startsWith("notes")) score += 20;
  }

  const preview = await readMarkdownPreview(filePath);
  if (hasStageHeading(preview, stageNumber, stageId)) score += 1000;
  else if (stageMarkerPattern.test(preview)) score += 180;
  if (buildPhaseMarkerPattern(stageNumber.phase).test(preview)) score += 30;

  return score;
}

async function readMarkdownPreview(filePath: string): Promise<string> {
  try {
    return (await fs.readFile(filePath, "utf8")).slice(0, 120000);
  } catch {
    return "";
  }
}

function hasStageHeading(markdown: string, stageNumber: { phase: number; stage: number }, stageId?: string): boolean {
  const stageMarkerPattern = buildStageMarkerPattern(stageNumber, stageId);
  return markdown
    .split(/\r?\n/)
    .some((line) => /^#{1,6}\s+/.test(line) && stageMarkerPattern.test(line));
}

function buildStageMarkers(stageNumber: { phase: number; stage: number }, stageId?: string): string[] {
  return uniqueStrings([
    stageId?.toLowerCase(),
    `stage-${stageNumber.phase}-${stageNumber.stage}`,
    `${stageNumber.phase}.${stageNumber.stage}`,
    `${stageNumber.phase}-${stageNumber.stage}`,
    `${stageNumber.phase}_${stageNumber.stage}`
  ].filter((item): item is string => Boolean(item)));
}

function buildStageMarkerPattern(stageNumber: { phase: number; stage: number }, stageId?: string): RegExp {
  const markers = buildStageMarkers(stageNumber, stageId).map(escapeRegExp).join("|");
  return new RegExp(`(^|[^a-z0-9])(?:${markers})(?![a-z0-9])`, "i");
}

function buildPhaseMarkerPattern(phase: number): RegExp {
  return new RegExp(`(^|[^a-z0-9])phase\\s*-?\\s*${phase}(?![a-z0-9])`, "i");
}

function isMarkdownPath(filePath: string): boolean {
  return NOTE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isPathWithin(basePath: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function uniquePaths(paths: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of paths) {
    const key = path.resolve(item).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readCourseState(studyRoot: string): Promise<CourseState> {
  const coursePath = getCourseJsonPath(studyRoot);
  const completedStageIds = new Set(await readStageCompletionMarkers(studyRoot));
  if (!(await pathExists(coursePath))) {
    return { currentStageId: DEFAULT_CURRENT_STAGE_ID, completedStageIds: [...completedStageIds] };
  }

  try {
    const parsed = JSON.parse(await fs.readFile(coursePath, "utf8")) as CourseJson;
    if (Array.isArray(parsed.completedStageIds)) {
      for (const stageId of parsed.completedStageIds) completedStageIds.add(stageId);
    }
    if (Array.isArray(parsed.stages)) {
      for (const stage of parsed.stages) {
        if (stage.status === "completed") completedStageIds.add(stage.id);
      }
    }
    return {
      currentStageId: parsed.progress?.currentStageId ?? DEFAULT_CURRENT_STAGE_ID,
      completedStageIds: [...completedStageIds]
    };
  } catch {
    return { currentStageId: DEFAULT_CURRENT_STAGE_ID, completedStageIds: [...completedStageIds] };
  }
}

async function readStageCompletionMarkers(studyRoot: string): Promise<string[]> {
  const markersPath = getCompletedStageMarkersPath(studyRoot);
  try {
    const entries = await fs.readdir(markersPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -".json".length))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function writeStageCompletionMarker(studyRoot: string, stageId: string): Promise<void> {
  const markersPath = getCompletedStageMarkersPath(studyRoot);
  await ensureDir(markersPath);
  await fs.writeFile(
    path.join(markersPath, `${stageId}.json`),
    `${JSON.stringify({ stageId, completedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

async function writeCourseState(studyRoot: string, state: CourseState): Promise<void> {
  const sources: LearningSource[] = [];
  const stages = await getStatefulStages(studyRoot);
  const completedStageIds = new Set(state.completedStageIds);
  const currentStageId = resolveCurrentStageId(stages, state.currentStageId, completedStageIds);
  const statefulStages = applyStageState(stages, currentStageId, completedStageIds);
  await writeCourseJson(
    studyRoot,
    {
      studyRoot,
      courseName: "C++ Project Study Coach",
      industryType: "Software Engineering",
      progress: buildProgressSnapshot(statefulStages, currentStageId, completedStageIds),
      stages: statefulStages,
      sources,
      updatedAt: new Date().toISOString()
    },
    [...completedStageIds]
  );
}

async function writeCourseJson(studyRoot: string, overview: CourseOverview, completedStageIds: string[]): Promise<void> {
  const coursePath = getCourseJsonPath(studyRoot);
  await ensureDir(path.dirname(coursePath));
  const payload = {
    schemaVersion: 1,
    courseName: overview.courseName,
    industryType: overview.industryType,
    studyRoot: overview.studyRoot,
    progress: overview.progress,
    completedStageIds,
    stages: overview.stages.map((stage) => ({
      ...stage,
      notePath: stage.notePath ? toRelativePath(studyRoot, stage.notePath) : undefined,
      practicePath: stage.practicePath ? toRelativePath(studyRoot, stage.practicePath) : undefined
    })),
    updatedAt: overview.updatedAt
  };
  await fs.writeFile(coursePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function getCourseJsonPath(studyRoot: string): string {
  return path.join(getLearningDataPath(studyRoot), "course.json");
}

function getCompletedStageMarkersPath(studyRoot: string): string {
  return path.join(getLearningDataPath(studyRoot), COMPLETED_STAGE_MARKERS_DIR);
}
