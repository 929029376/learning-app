export type SourceType = "markdown" | "text" | "pdf" | "docx" | "pptx" | "cpp" | "header" | "unknown";

export type ParseStatus = "pending" | "parsed" | "failed" | "skipped";

export type StageStatus = "not-started" | "learning" | "completed";

export type WorkspacePanel = "progress" | "lesson" | "studio";

export interface PanelWindowRequest {
  panel: WorkspacePanel;
  fullscreen?: boolean;
  studyRoot?: string;
  stageId?: string;
}

export interface LearningSource {
  id: string;
  path: string;
  relativePath: string;
  type: SourceType;
  size: number;
  mtimeMs: number;
  hash: string;
  parseStatus: ParseStatus;
  errorMessage?: string;
  title?: string;
}

export interface LearningStage {
  id: string;
  title: string;
  phase: string;
  status: StageStatus;
  grade?: string;
  notePath?: string;
  practicePath?: string;
}

export interface ProgressSnapshot {
  totalLearnedPercent: number;
  totalRemainingPercent: number;
  currentPhase: string;
  currentPhaseLearnedPercent: number;
  currentPhaseRemainingPercent: number;
  currentStageId?: string;
}

export interface CourseOverview {
  studyRoot: string;
  courseName: string;
  industryType: string;
  progress: ProgressSnapshot;
  stages: LearningStage[];
  sources: LearningSource[];
  updatedAt: string;
}

export interface StageContent {
  stage: LearningStage;
  content: string;
  sources: LearningSource[];
  defaultExercisePath?: string;
}

export interface ExerciseFile {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  kind: "source" | "header" | "build" | "text";
}

export interface ExerciseResult {
  id: string;
  sourcePath: string;
  command: string;
  compileOutput: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  passed: boolean;
  createdAt: string;
}

export type CodeDiagnosticSeverity = "error" | "warning" | "info";

export interface CodeDiagnostic {
  filePath: string;
  line: number;
  column: number;
  severity: CodeDiagnosticSeverity;
  message: string;
}

export interface ValidateCppContentRequest {
  studyRoot: string;
  practicePath: string;
  filePath: string;
  content: string;
}

export interface ValidateCppContentResult {
  filePath: string;
  command: string;
  output: string;
  diagnostics: CodeDiagnostic[];
  passed: boolean;
  checkedAt: string;
}

export interface ScanResult {
  overview: CourseOverview;
  parsedCount: number;
  failedCount: number;
  skippedCount: number;
}

export interface RunCppExerciseRequest {
  studyRoot: string;
  sourcePath: string;
  stdin?: string;
}

export interface RunExerciseProjectRequest {
  studyRoot: string;
  practicePath: string;
  stdin?: string;
}

export interface ListExerciseFilesRequest {
  studyRoot: string;
  practicePath: string;
}

export interface CreateTextFileRequest {
  studyRoot: string;
  practicePath: string;
  relativePath: string;
  content?: string;
}

export interface DeleteTextFileRequest {
  studyRoot: string;
  practicePath: string;
  filePath: string;
}

export interface DeleteTextFileResult {
  path: string;
  deletedAt: string;
}

export interface TextFileRequest {
  studyRoot: string;
  filePath: string;
}

export interface TextFileContent {
  path: string;
  content: string;
  updatedAt: string;
}

export interface SaveTextFileRequest extends TextFileRequest {
  content: string;
}

export interface SaveUserDecisionRequest {
  studyRoot: string;
  stageId?: string;
  content: string;
  decisionType: "save-note" | "save-score";
}

export interface StageActionRequest {
  studyRoot: string;
  stageId: string;
}

export interface LearningApi {
  getDefaultStudyRoot(): Promise<string | null>;
  isStudyRootAvailable(studyRoot: string): Promise<boolean>;
  selectStudyRoot(): Promise<string | null>;
  scanStudyRoot(studyRoot: string): Promise<ScanResult>;
  getCourseOverview(studyRoot: string): Promise<CourseOverview>;
  getStageContent(studyRoot: string, stageId: string): Promise<StageContent>;
  runCppExercise(request: RunCppExerciseRequest): Promise<ExerciseResult>;
  runExerciseProject(request: RunExerciseProjectRequest): Promise<ExerciseResult>;
  validateCppContent(request: ValidateCppContentRequest): Promise<ValidateCppContentResult>;
  listExerciseFiles(request: ListExerciseFilesRequest): Promise<ExerciseFile[]>;
  createTextFile(request: CreateTextFileRequest): Promise<TextFileContent>;
  deleteTextFile(request: DeleteTextFileRequest): Promise<DeleteTextFileResult>;
  readTextFile(request: TextFileRequest): Promise<TextFileContent>;
  saveTextFile(request: SaveTextFileRequest): Promise<TextFileContent>;
  saveUserDecision(request: SaveUserDecisionRequest): Promise<void>;
  completeStage(request: StageActionRequest): Promise<CourseOverview>;
  setCurrentStage(request: StageActionRequest): Promise<CourseOverview>;
}

export interface WindowApi {
  openPanelWindow(request: PanelWindowRequest): Promise<void>;
  dockPanelWindow(panel: WorkspacePanel): Promise<void>;
  getDetachedPanels(): Promise<WorkspacePanel[]>;
  onDetachedPanelsChanged(callback: (panels: WorkspacePanel[]) => void): () => void;
  setCurrentWindowFullscreen(fullscreen: boolean): Promise<void>;
}
