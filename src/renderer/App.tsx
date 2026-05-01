import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  CSSProperties,
  ChangeEvent as ReactChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import CodeMirror from "@uiw/react-codemirror";
import { acceptCompletion, autocompletion, snippetCompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { indentUnit, StreamLanguage } from "@codemirror/language";
import { lintGutter, linter } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { EditorState, Prec } from "@codemirror/state";
import type { Extension, Text } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

import type {
  CodeDiagnostic,
  CourseOverview,
  ExerciseFile,
  ExerciseResult,
  LearningStage,
  ScanResult,
  StageContent,
  WorkspacePanel
} from "../shared/types";

const progressSentence = "总进度：已学习约 21%，还剩约 79%。当前 Phase 2：已学习约 70%，还剩约 30%。";
const columnStorageKey = "learning-studio-column-percents";
const minimizedPanelStorageKey = "learning-studio-minimized-panels";
const editorFontSizeStorageKey = "learning-studio-editor-font-size";
const editorFontFamilyStorageKey = "learning-studio-editor-font-family";
const customEditorFontFamilyStorageKey = "learning-studio-custom-editor-font-family";
const fileTreeWidthStorageKey = "learning-studio-file-tree-width";
const fileTreeHiddenStorageKey = "learning-studio-file-tree-hidden";
const defaultColumnPercents: ColumnPercents = { left: 22, middle: 34, right: 44 };
const minimumColumnPercents: ColumnPercents = { left: 15, middle: 24, right: 28 };
const defaultEditorFontSize = 13.5;
const minimumEditorFontSize = 11;
const maximumEditorFontSize = 22;
const defaultEditorFontFamilyId = "consolas";
const defaultFileTreeWidth = 220;
const minimumFileTreeWidth = 120;
const maximumFileTreeWidth = 520;
const maximumProgramInputLength = 12000;
const workspacePanels: WorkspacePanel[] = ["progress", "lesson", "studio"];

const editorFontOptions = [
  { id: "consolas", label: "Consolas", family: '"Consolas", "Microsoft YaHei UI", monospace' },
  { id: "jetbrains", label: "JetBrains Mono", family: '"JetBrains Mono", "Microsoft YaHei UI", monospace' },
  { id: "cascadia", label: "Cascadia Code", family: '"Cascadia Code", "Microsoft YaHei UI", monospace' },
  { id: "fira", label: "Fira Code", family: '"Fira Code", "Microsoft YaHei UI", monospace' },
  { id: "source-code-pro", label: "Source Code Pro", family: '"Source Code Pro", "Microsoft YaHei UI", monospace' },
  { id: "sarasa", label: "Sarasa Mono SC", family: '"Sarasa Mono SC", "Microsoft YaHei UI", monospace' },
  { id: "system", label: "系统等宽", family: 'ui-monospace, "SFMono-Regular", "Cascadia Mono", "Consolas", "Liberation Mono", monospace' },
  { id: "custom", label: "自定义", family: "" }
];

type ResizeHandle = "left" | "right";

const makefileLanguage = StreamLanguage.define({
  name: "makefile",
  token(stream) {
    if (stream.eatSpace()) return null;

    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }

    const logicalLineStart = stream.string.slice(0, stream.start).trim().length === 0;
    if (logicalLineStart && stream.match(/^[A-Za-z0-9_./$(){}%*-]+(?=\s*:)/)) return "def";
    if (logicalLineStart && stream.match(/^[A-Za-z0-9_.-]+(?=\s*(?:[:+?]?=|!=))/)) return "variableName";
    if (stream.match(/^(include|define|endef|ifdef|ifndef|ifeq|ifneq|else|endif|override|export|unexport|vpath)\b/)) return "keyword";
    if (stream.match(/^\$\([^)]+\)/) || stream.match(/^\$\{[^}]+\}/) || stream.match(/^\$[@<?^+*%]/)) return "variableName";
    if (stream.match(/^"(?:[^"\\]|\\.)*"/) || stream.match(/^'(?:[^'\\]|\\.)*'/)) return "string";
    if (stream.match(/^(?:::+|[:+?]?=|!=|;|\\)/)) return "operator";
    if (stream.match(/^-{1,2}[\w-]+/)) return "keyword";

    stream.eatWhile(/[^\s#$:=;\\]+/);
    if (stream.current().length === 0) stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "#" }
  }
});

const cppCompletions: Completion[] = [
  snippetCompletion("#include <iostream>", { label: "#include <iostream>", type: "keyword", detail: "C++ input/output header" }),
  snippetCompletion("#include <vector>", { label: "#include <vector>", type: "keyword", detail: "std::vector header" }),
  snippetCompletion("#include <string>", { label: "#include <string>", type: "keyword", detail: "std::string header" }),
  snippetCompletion("#include <unordered_map>", { label: "#include <unordered_map>", type: "keyword", detail: "hash map header" }),
  snippetCompletion("int main()\n{\n\t${}\n\treturn 0;\n}", { label: "main", type: "function", detail: "main function" }),
  snippetCompletion("for (int ${index} = 0; ${index} < ${count}; ++${index})\n{\n\t${}\n}", { label: "for", type: "keyword", detail: "indexed loop" }),
  snippetCompletion("while (${condition})\n{\n\t${}\n}", { label: "while", type: "keyword", detail: "while loop" }),
  snippetCompletion("if (${condition})\n{\n\t${}\n}", { label: "if", type: "keyword", detail: "if block" }),
  snippetCompletion("if (${condition})\n{\n\t${}\n}\nelse\n{\n\t\n}", { label: "ifelse", type: "keyword", detail: "if else block" }),
  snippetCompletion("struct ${Name}\n{\n\t${}\n};", { label: "struct", type: "class", detail: "struct definition" }),
  snippetCompletion("class ${Name}\n{\npublic:\n\t${Name}() = default;\n\nprivate:\n\t${}\n};", { label: "class", type: "class", detail: "class definition" }),
  { label: "std::cout", type: "variable", detail: "standard output" },
  { label: "std::cin", type: "variable", detail: "standard input" },
  { label: "std::endl", type: "constant", detail: "line break and flush" },
  { label: "std::string", type: "type", detail: "string type" },
  { label: "std::vector", type: "type", detail: "dynamic array" },
  { label: "std::map", type: "type", detail: "ordered map" },
  { label: "std::unordered_map", type: "type", detail: "hash map" },
  { label: "std::getline", type: "function", detail: "read one line" },
  { label: "std::cin.ignore", type: "function", detail: "ignore input buffer" },
  { label: "const", type: "keyword" },
  { label: "private", type: "keyword" },
  { label: "public", type: "keyword" },
  { label: "return", type: "keyword" },
  { label: "void", type: "type" },
  { label: "int", type: "type" },
  { label: "bool", type: "type" },
  { label: "double", type: "type" }
];

const makefileCompletions: Completion[] = [
  snippetCompletion("all: ${target}\n\n${target}: ${deps}\n\t${command}", { label: "all target", type: "keyword", detail: "default target" }),
  snippetCompletion("clean:\n\trm -f ${files}", { label: "clean", type: "keyword", detail: "clean target" }),
  snippetCompletion("${target}: ${deps}\n\t${command}", { label: "target rule", type: "keyword", detail: "Makefile rule" }),
  { label: "CXX", type: "variable", detail: "C++ compiler variable" },
  { label: "CXXFLAGS", type: "variable", detail: "C++ compiler flags" },
  { label: "LDFLAGS", type: "variable", detail: "linker flags" },
  { label: "$@", type: "variable", detail: "target name" },
  { label: "$<", type: "variable", detail: "first dependency" },
  { label: "$^", type: "variable", detail: "all dependencies" },
  { label: ".PHONY", type: "keyword", detail: "phony target marker" },
  { label: "wildcard", type: "function", detail: "collect matching files" },
  { label: "patsubst", type: "function", detail: "pattern substitution" }
];

const makefileCompletionSource = createSmartCompletionSource(makefileCompletions, false);

function createSmartCompletionSource(baseOptions: Completion[], includeDocumentSymbols: boolean, projectSourceText = ""): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const sourceText = includeDocumentSymbols
      ? `${projectSourceText}\n\n${context.state.doc.toString()}`
      : context.state.doc.toString();
    const memberCompletion = includeDocumentSymbols ? getCppMemberCompletionResult(context, sourceText) : null;
    if (memberCompletion) return memberCompletion;

    const word = context.matchBefore(/[#.$A-Za-z_][#.$A-Za-z0-9_:.-]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    const dynamicOptions = includeDocumentSymbols ? getCppDocumentCompletions(sourceText) : [];
    const options = mergeCompletionOptions([...dynamicOptions, ...baseOptions]);
    return {
      from: word.from,
      options,
      validFor: /^[#.$A-Za-z_][#.$A-Za-z0-9_:.-]*$/
    };
  };
}

function getCppMemberCompletionResult(context: CompletionContext, sourceText: string): CompletionResult | null {
  const access = getCppMemberAccessAtCursor(context);
  if (!access) return null;

  const from = context.pos - access.partial.length;
  const options = getCppMemberCompletions(sourceText, access.objectName);
  if (options.length === 0 && !context.explicit) return null;

  return {
    from,
    options,
    validFor: /^[A-Za-z_][A-Za-z0-9_]*$/
  };
}

function getCppMemberAccessAtCursor(context: CompletionContext): { objectName: string; operator: "." | "->"; partial: string } | null {
  const line = context.state.doc.lineAt(context.pos);
  const textBeforeCursor = context.state.sliceDoc(line.from, context.pos);
  const match = textBeforeCursor.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(\.|->)\s*([A-Za-z_][A-Za-z0-9_]*)?$/);
  if (!match) return null;

  return {
    objectName: match[1],
    operator: match[2] as "." | "->",
    partial: match[3] ?? ""
  };
}

function getCppMemberCompletions(sourceText: string, objectName: string): Completion[] {
  const objectTypes = getCppObjectTypeMap(sourceText);
  const objectType = objectTypes.get(objectName);
  if (!objectType) return [];

  const structMembers = getCppStructMemberMap(sourceText);
  return structMembers.get(objectType) ?? [];
}

function getCppStructMemberMap(sourceText: string): Map<string, Completion[]> {
  const structMembers = new Map<string, Completion[]>();
  const structPattern = /\b(?:struct|class)\s+([A-Za-z_][A-Za-z0-9_]*)[^{;]*\{([\s\S]*?)\};/g;

  for (const structMatch of sourceText.matchAll(structPattern)) {
    const structName = structMatch[1];
    const body = stripCppComments(structMatch[2]);
    const members = new Map<string, Completion>();

    for (const statement of body.split(";")) {
      for (const memberName of getCppFieldNames(statement)) {
        if (!memberName || ignoredCompletionLabels.has(memberName)) continue;
        members.set(memberName, {
          label: memberName,
          type: "property",
          detail: `${structName} member`,
          boost: 130
        });
      }
    }

    structMembers.set(structName, [...members.values()]);
  }

  return structMembers;
}

function getCppFieldNames(statement: string): string[] {
  const cleaned = statement
    .replace(/\b(public|private|protected)\s*:/g, " ")
    .replace(/\b(static|mutable|constexpr|volatile|const)\b/g, " ")
    .trim();

  if (!cleaned || cleaned.includes("(") || cleaned.includes(")") || cleaned.includes("{") || cleaned.includes("}")) {
    return [];
  }

  const declarators = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
  return declarators
    .map((declarator) => getCppDeclaratorName(declarator))
    .filter((name): name is string => Boolean(name));
}

function getCppDeclaratorName(declarator: string): string | null {
  const withoutInitializer = declarator
    .replace(/=.*/, "")
    .replace(/\[[^\]]*\]/g, "")
    .trim();
  const match = withoutInitializer.match(/(?:^|[\s*&])([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  return match?.[1] ?? null;
}

function getCppObjectTypeMap(sourceText: string): Map<string, string> {
  const objectTypes = new Map<string, string>();
  const structMembers = getCppStructMemberMap(sourceText);
  const knownTypes = new Set(structMembers.keys());
  const cleanedText = stripCppComments(sourceText);
  const declarationPattern =
    /(?:^|[;{}\n(,])\s*(?:const\s+)?(?:struct\s+|class\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:[*&]\s*){0,2}([A-Za-z_][A-Za-z0-9_]*)\s*(?=[=;,){}])/g;

  for (const declarationMatch of cleanedText.matchAll(declarationPattern)) {
    const typeName = declarationMatch[1];
    const variableName = declarationMatch[2];
    if (
      !typeName ||
      !variableName ||
      !knownTypes.has(typeName) ||
      ignoredCompletionLabels.has(typeName) ||
      ignoredCompletionLabels.has(variableName)
    ) {
      continue;
    }
    objectTypes.set(variableName, typeName);
  }

  return objectTypes;
}

function stripCppComments(sourceText: string): string {
  return sourceText.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function getCppDocumentCompletions(sourceText: string): Completion[] {
  const completions = new Map<string, Completion>();
  const addCompletion = (label: string, type: Completion["type"], detail: string, boost: number) => {
    if (!label || ignoredCompletionLabels.has(label)) return;
    completions.set(label, { label, type, detail, boost });
  };

  for (const match of sourceText.matchAll(/\b(?:struct|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    addCompletion(match[1], "class", "current file type", 90);
  }

  for (const match of sourceText.matchAll(/(?:^|[;{}\n])\s*(?:inline\s+|static\s+|constexpr\s+|virtual\s+|friend\s+|extern\s+)*(?:[A-Za-z_][A-Za-z0-9_:<>~*&\s]*?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{}]*\)\s*(?:const\s*)?(?=[;{])/gm)) {
    addCompletion(match[1], "function", "current file function", 100);
  }

  for (const match of sourceText.matchAll(/\b(?:const\s+)?(?:std::)?[A-Za-z_][A-Za-z0-9_:<>]*\s*[*&]?\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?=[=;,)])/g)) {
    addCompletion(match[1], "variable", "current file symbol", 70);
  }

  return [...completions.values()];
}

function mergeCompletionOptions(options: Completion[]): Completion[] {
  const merged = new Map<string, Completion>();
  for (const option of options) {
    if (!merged.has(option.label)) {
      merged.set(option.label, option);
    }
  }
  return [...merged.values()];
}

const ignoredCompletionLabels = new Set([
  "if",
  "for",
  "while",
  "return",
  "switch",
  "case",
  "else",
  "const",
  "void",
  "int",
  "double",
  "bool",
  "char",
  "auto",
  "std",
  "include"
]);

interface ColumnPercents {
  left: number;
  middle: number;
  right: number;
}

type ColumnKey = keyof ColumnPercents;

type FileTreeNode = FileTreeDirectory | FileTreeLeaf;

interface FileTreeDirectory {
  type: "directory";
  name: string;
  relativePath: string;
  children: FileTreeNode[];
}

interface FileTreeLeaf {
  type: "file";
  file: ExerciseFile;
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}

interface ProgramInputBoxProps {
  onInputChange: (value: string) => void;
}

type BuildDiagnostic = Omit<CodeDiagnostic, "severity"> & { severity: Diagnostic["severity"] };

const codeEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "0",
    backgroundColor: "#fffdfa",
    color: "#263242",
    fontSize: "var(--editor-font-size, 13.5px)"
  },
  ".cm-content": {
    fontFamily: "var(--editor-font-family, Consolas, monospace)",
    padding: "14px 0"
  },
  ".cm-line": {
    lineHeight: "1.58"
  },
  ".cm-gutters": {
    backgroundColor: "#f5ead8",
    color: "#927b62",
    borderRight: "1px solid rgba(129, 93, 53, 0.12)"
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(242, 166, 90, 0.12)"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(242, 166, 90, 0.16)"
  },
  ".cm-scroller": {
    borderRadius: "18px",
    overflow: "auto"
  }
});

const editorTabKeymap = Prec.highest(
  keymap.of([
    { key: "Tab", run: acceptCompletion },
    indentWithTab
  ])
);

export function App() {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const miniIdeRef = useRef<HTMLDivElement | null>(null);
  const editorFrameRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const editorMeasureFrameRef = useRef<number | null>(null);
  const newFileInputRef = useRef<HTMLInputElement | null>(null);
  const liveDiagnosticRequestRef = useRef(0);
  const exerciseInputRef = useRef("");
  const [studyRoot, setStudyRoot] = useState("");
  const [overview, setOverview] = useState<CourseOverview | null>(null);
  const [stageContent, setStageContent] = useState<StageContent | null>(null);
  const [practicePath, setPracticePath] = useState("");
  const [exerciseFiles, setExerciseFiles] = useState<ExerciseFile[]>([]);
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState("");
  const [exerciseResult, setExerciseResult] = useState<ExerciseResult | null>(null);
  const [liveDiagnostics, setLiveDiagnostics] = useState<BuildDiagnostic[]>([]);
  const [liveDiagnosticStatus, setLiveDiagnosticStatus] = useState("");
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [savedFileContents, setSavedFileContents] = useState<Record<string, string>>({});
  const [codeStatus, setCodeStatus] = useState("选择阶段后会自动打开对应练习代码。");
  const [status, setStatus] = useState("正在准备本地学习工作台...");
  const [isPending, startTransition] = useTransition();
  const [columnPercents, setColumnPercents] = useState<ColumnPercents>(() => loadColumnPercents());
  const [editorFontSize, setEditorFontSize] = useState(() => loadEditorFontSize());
  const [editorFontFamilyId, setEditorFontFamilyId] = useState(() => loadEditorFontFamilyId());
  const [customEditorFontFamily, setCustomEditorFontFamily] = useState(() => loadCustomEditorFontFamily());
  const [fileTreeWidth, setFileTreeWidth] = useState(() => loadFileTreeWidth());
  const [isFileTreeHidden, setIsFileTreeHidden] = useState(() => loadFileTreeHidden());
  const [stagePhaseFilter, setStagePhaseFilter] = useState("all");
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({});
  const [focusedPanel] = useState<WorkspacePanel | null>(() => getFocusedPanelFromUrl());
  const [initialStudyRoot] = useState(() => getSearchParam("studyRoot"));
  const [initialStageId] = useState(() => getSearchParam("stageId"));
  const [detachedPanels, setDetachedPanels] = useState<WorkspacePanel[]>([]);
  const [minimizedPanels, setMinimizedPanels] = useState<WorkspacePanel[]>(() => loadMinimizedPanels());

  const currentStageId = stageContent?.stage.id;
  const handleProgramInputChange = useCallback((value: string) => {
    exerciseInputRef.current = value;
  }, []);
  const stagePhaseOptions = getStagePhaseOptions(overview?.stages ?? []);
  const visibleStages = (overview?.stages ?? []).filter((stage) => stagePhaseFilter === "all" || stage.phase === stagePhaseFilter);
  const stageRouteCounter = formatStageRouteCounter(visibleStages, currentStageId);
  const fileTree = buildFileTree(exerciseFiles);
  const activeCode = activeFilePath ? fileContents[activeFilePath] ?? "" : "";
  const projectCompletionSourceText = useMemo(
    () => getProjectCompletionSourceText(fileContents, activeFilePath, activeCode),
    [fileContents, activeFilePath, activeCode]
  );
  const activeDirty = activeFilePath ? (fileContents[activeFilePath] ?? "") !== (savedFileContents[activeFilePath] ?? "") : false;
  const buildDiagnostics = useMemo(
    () => (activeDirty ? [] : getEditorDiagnostics(activeFilePath, exerciseResult)),
    [activeDirty, activeFilePath, exerciseResult]
  );
  const editorDiagnostics = liveDiagnosticStatus ? liveDiagnostics : buildDiagnostics;
  const editorExtensions = useMemo(
    () => getEditorExtensions(activeFilePath, editorDiagnostics, projectCompletionSourceText),
    [activeFilePath, editorDiagnostics, projectCompletionSourceText]
  );
  const editorErrorCount = editorDiagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const editorWarningCount = editorDiagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const projectDirty = openFilePaths.some((filePath) => (fileContents[filePath] ?? "") !== (savedFileContents[filePath] ?? ""));
  const hiddenPanels = focusedPanel ? [] : getUniquePanels([...detachedPanels, ...minimizedPanels]);
  const visiblePanels = focusedPanel ? workspacePanels : workspacePanels.filter((panel) => !hiddenPanels.includes(panel));
  const visiblePanelCount = focusedPanel ? 1 : Math.max(1, visiblePanels.length);
  const workspacePanelClassNames = focusedPanel ? "" : [`panel-count-${visiblePanelCount}`, ...hiddenPanels.map((panel) => `hidden-${panel}`)].join(" ");
  const editorFontFamily = getEditorFontFamily(editorFontFamilyId, customEditorFontFamily);
  const workspaceStyle = {
    "--left-column": `${columnPercents.left}fr`,
    "--middle-column": `${columnPercents.middle}fr`,
    "--right-column": `${columnPercents.right}fr`,
    "--docked-panel-count": String(visiblePanelCount),
    "--editor-font-size": `${editorFontSize}px`,
    "--editor-font-family": editorFontFamily
  } as CSSProperties;
  const miniIdeStyle = {
    "--file-tree-width": `${fileTreeWidth}px`
  } as CSSProperties;

  function scheduleEditorMeasure() {
    if (editorMeasureFrameRef.current !== null) {
      window.cancelAnimationFrame(editorMeasureFrameRef.current);
    }

    editorMeasureFrameRef.current = window.requestAnimationFrame(() => {
      editorMeasureFrameRef.current = null;
      editorViewRef.current?.requestMeasure();
    });
  }

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    return () => {
      if (editorMeasureFrameRef.current !== null) {
        window.cancelAnimationFrame(editorMeasureFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const editorFrame = editorFrameRef.current;
    if (!editorFrame) return;

    const resizeObserver = new ResizeObserver(() => scheduleEditorMeasure());
    resizeObserver.observe(editorFrame);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    window.addEventListener("resize", scheduleEditorMeasure);
    return () => window.removeEventListener("resize", scheduleEditorMeasure);
  }, []);

  useEffect(() => {
    scheduleEditorMeasure();
  }, [activeFilePath, columnPercents, customEditorFontFamily, detachedPanels, editorFontFamilyId, editorFontSize, fileTreeWidth, focusedPanel, isFileTreeHidden, minimizedPanels, openFilePaths.length, visiblePanelCount]);

  useEffect(() => {
    localStorage.setItem(columnStorageKey, JSON.stringify(columnPercents));
  }, [columnPercents]);

  useEffect(() => {
    localStorage.setItem(minimizedPanelStorageKey, JSON.stringify(minimizedPanels));
  }, [minimizedPanels]);

  useEffect(() => {
    localStorage.setItem(editorFontSizeStorageKey, String(editorFontSize));
  }, [editorFontSize]);

  useEffect(() => {
    localStorage.setItem(editorFontFamilyStorageKey, editorFontFamilyId);
  }, [editorFontFamilyId]);

  useEffect(() => {
    localStorage.setItem(customEditorFontFamilyStorageKey, customEditorFontFamily);
  }, [customEditorFontFamily]);

  useEffect(() => {
    localStorage.setItem(fileTreeWidthStorageKey, String(fileTreeWidth));
  }, [fileTreeWidth]);

  useEffect(() => {
    localStorage.setItem(fileTreeHiddenStorageKey, JSON.stringify(isFileTreeHidden));
  }, [isFileTreeHidden]);

  useEffect(() => {
    document.body.classList.toggle("is-focused-panel", Boolean(focusedPanel));
    return () => document.body.classList.remove("is-focused-panel");
  }, [focusedPanel]);

  useEffect(() => {
    void window.windowApi.getDetachedPanels().then(setDetachedPanels);
    return window.windowApi.onDetachedPanelsChanged(setDetachedPanels);
  }, []);

  useEffect(() => {
    if (detachedPanels.length === 0) return;
    setMinimizedPanels((current) => current.filter((panel) => !detachedPanels.includes(panel)));
  }, [detachedPanels]);

  useEffect(() => {
    if (!isCreatingFile) return;
    const timer = window.setTimeout(() => newFileInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isCreatingFile]);

  useEffect(() => {
    const requestId = liveDiagnosticRequestRef.current + 1;
    liveDiagnosticRequestRef.current = requestId;

    if (!studyRoot || !practicePath || !activeFilePath || !isCppLikeFile(activeFilePath)) {
      setLiveDiagnostics([]);
      setLiveDiagnosticStatus("");
      return;
    }

    setLiveDiagnosticStatus("等待实时检查...");
    const timer = window.setTimeout(async () => {
      if (liveDiagnosticRequestRef.current !== requestId) return;
      setLiveDiagnosticStatus("正在实时检查...");

      try {
        const result = await window.learningApi.validateCppContent({
          studyRoot,
          practicePath,
          filePath: activeFilePath,
          content: activeCode
        });
        if (liveDiagnosticRequestRef.current !== requestId) return;

        const diagnostics = (result.diagnostics as BuildDiagnostic[]).filter((diagnostic) => diagnosticMatchesFile(activeFilePath, diagnostic.filePath));
        const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
        const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
        setLiveDiagnostics(diagnostics);
        setLiveDiagnosticStatus(getLiveDiagnosticStatus(result.passed, errorCount, warningCount));
      } catch (error) {
        if (liveDiagnosticRequestRef.current !== requestId) return;
        setLiveDiagnostics([]);
        setLiveDiagnosticStatus(error instanceof Error ? `实时检查失败：${error.message}` : `实时检查失败：${String(error)}`);
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [activeCode, activeFilePath, practicePath, studyRoot]);

  async function boot() {
    const defaultRoot = initialStudyRoot || (await window.learningApi.getDefaultStudyRoot());
    if (defaultRoot) {
      setStudyRoot(defaultRoot);
      await scanAndLoad(defaultRoot, initialStageId);
    } else {
      setStatus("请选择你的学习资料目录。");
    }
  }

  async function chooseStudyRoot() {
    const selected = await window.learningApi.selectStudyRoot();
    if (!selected) return;
    setStudyRoot(selected);
    await scanAndLoad(selected);
  }

  async function scanAndLoad(root: string, preferredStageId?: string | null) {
    setStatus("正在扫描资料、建立索引和刷新进度...");
    try {
      const result: ScanResult = await window.learningApi.scanStudyRoot(root);
      startTransition(() => {
        setOverview(result.overview);
        setStatus(`扫描完成：新增/更新 ${result.parsedCount} 个文件，跳过 ${result.skippedCount} 个文件，失败 ${result.failedCount} 个文件。`);
      });
      const nextStageId = preferredStageId && result.overview.stages.some((stage) => stage.id === preferredStageId)
        ? preferredStageId
        : result.overview.progress.currentStageId ?? result.overview.stages[0]?.id;
      if (nextStageId) {
        await loadStage(root, nextStageId);
      }
    } catch (error) {
      setStatus(error instanceof Error ? `扫描失败：${error.message}` : `扫描失败：${String(error)}`);
    }
  }

  async function loadStage(root: string, stageId: string) {
    setStatus("正在打开当前小节...");
    try {
      const nextOverview = await window.learningApi.getCourseOverview(root);
      setOverview(nextOverview);
      const content = await window.learningApi.getStageContent(root, stageId);
      const nextExercisePath = content.defaultExercisePath ?? "";
      const nextPracticePath = content.stage.practicePath ?? (nextExercisePath ? getParentDirectory(nextExercisePath) : "");
      setStageContent(content);
      setPracticePath(nextPracticePath);
      setExerciseFiles([]);
      setExpandedDirectories({});
      setOpenFilePaths([]);
      setActiveFilePath("");
      setFileContents({});
      setSavedFileContents({});
      setExerciseResult(null);
      if (nextPracticePath) {
        await loadExerciseWorkspace(root, nextPracticePath, nextExercisePath);
      } else if (nextExercisePath) {
        await openEditorFile(root, nextExercisePath, true);
      }
      setStatus(`当前小节：${content.stage.title}`);
    } catch (error) {
      setStatus(error instanceof Error ? `打开小节失败：${error.message}` : `打开小节失败：${String(error)}`);
    }
  }

  async function loadExerciseWorkspace(root = studyRoot, directoryPath = practicePath, preferredFilePath = activeFilePath) {
    if (!root || !directoryPath) return;

    try {
      const files = await window.learningApi.listExerciseFiles({
        studyRoot: root,
        practicePath: directoryPath
      });
      setExerciseFiles(files);
      setExpandedDirectories((current) => mergeExpandedDirectories(current, files));
      await preloadWorkspaceCodeFiles(root, files);
      const preferred = files.find((file) => file.path === preferredFilePath)?.path;
      const mainFile = files.find((file) => file.name === "main.cpp")?.path;
      const firstSource = files.find((file) => file.kind === "source")?.path;
      const firstFile = files[0]?.path;
      const fileToOpen = preferred ?? mainFile ?? firstSource ?? firstFile;
      if (fileToOpen) {
        await openEditorFile(root, fileToOpen, true);
      } else {
        setCodeStatus("当前练习目录没有可编辑文件。");
      }
    } catch (error) {
      setCodeStatus(error instanceof Error ? error.message : String(error));
      if (preferredFilePath) {
        await openEditorFile(root, preferredFilePath, true);
      }
    }
  }

  async function preloadWorkspaceCodeFiles(root: string, files: ExerciseFile[]) {
    const codeFiles = files.filter((file) => isCppLikeFile(file.path));
    if (codeFiles.length === 0) return;

    const loadedFiles = await Promise.all(
      codeFiles.map(async (file) => {
        try {
          const textFile = await window.learningApi.readTextFile({
            studyRoot: root,
            filePath: file.path
          });
          return textFile;
        } catch {
          return null;
        }
      })
    );

    const contentEntries = loadedFiles.filter((file): file is NonNullable<typeof file> => Boolean(file));
    if (contentEntries.length === 0) return;

    setFileContents((current) => {
      const next = { ...current };
      for (const file of contentEntries) {
        if (next[file.path] === undefined) next[file.path] = file.content;
      }
      return next;
    });
    setSavedFileContents((current) => {
      const next = { ...current };
      for (const file of contentEntries) {
        if (next[file.path] === undefined) next[file.path] = file.content;
      }
      return next;
    });
  }

  async function openEditorFile(root = studyRoot, filePath = activeFilePath, forceReload = false) {
    if (!root || !filePath.trim()) {
      setCodeStatus("还没有可打开的练习文件。");
      return;
    }

    try {
      const normalizedPath = filePath.trim();
      if (fileContents[normalizedPath] === undefined || forceReload) {
        const file = await window.learningApi.readTextFile({
          studyRoot: root,
          filePath: normalizedPath
        });
        setFileContents((current) => ({ ...current, [file.path]: file.content }));
        setSavedFileContents((current) => ({ ...current, [file.path]: file.content }));
        setActiveFilePath(file.path);
        setOpenFilePaths((current) => (current.includes(file.path) ? current : [...current, file.path]));
        setCodeStatus(`已加载 ${shortPath(file.path)}`);
        return;
      }

      setActiveFilePath(normalizedPath);
      setOpenFilePaths((current) => (current.includes(normalizedPath) ? current : [...current, normalizedPath]));
      setCodeStatus(`已切换 ${shortPath(normalizedPath)}`);
    } catch (error) {
      setCodeStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function closeEditorTab(filePath: string) {
    const isDirty = fileContents[filePath] !== savedFileContents[filePath];
    if (isDirty && !window.confirm(`${getFileName(filePath)} 还没有保存，关闭会丢弃本次修改。确定关闭吗？`)) return;

    removeEditorFileFromState(filePath, "已关闭全部文件标签。");
  }

  function removeEditorFileFromState(filePath: string, emptyStatus: string) {
    setOpenFilePaths((current) => {
      const closingIndex = current.indexOf(filePath);
      const nextOpenFiles = current.filter((item) => item !== filePath);

      if (filePath === activeFilePath) {
        const nextActiveFile = nextOpenFiles[Math.min(closingIndex, nextOpenFiles.length - 1)] ?? "";
        setActiveFilePath(nextActiveFile);
        setCodeStatus(nextActiveFile ? `已切换 ${shortPath(nextActiveFile)}` : emptyStatus);
      }

      return nextOpenFiles;
    });

    setFileContents((current) => {
      const next = { ...current };
      delete next[filePath];
      return next;
    });
    setSavedFileContents((current) => {
      const next = { ...current };
      delete next[filePath];
      return next;
    });
  }

  async function deleteActiveEditorFile() {
    if (!studyRoot || !practicePath || !activeFilePath) {
      setCodeStatus("请先打开要删除的文件。");
      return;
    }

    const fileToDelete = activeFilePath;
    const isDirty = fileContents[fileToDelete] !== savedFileContents[fileToDelete];
    const message = isDirty
      ? `${getFileName(fileToDelete)} 还没有保存。确定永久删除这个文件吗？`
      : `确定永久删除 ${shortPath(fileToDelete)} 吗？`;
    if (!window.confirm(message)) return;

    const currentIndex = openFilePaths.indexOf(fileToDelete);
    const nextOpenFiles = openFilePaths.filter((filePath) => filePath !== fileToDelete);
    const nextPreferredFile = nextOpenFiles[Math.min(currentIndex, nextOpenFiles.length - 1)] ?? "";

    try {
      await window.learningApi.deleteTextFile({
        studyRoot,
        practicePath,
        filePath: fileToDelete
      });
      removeEditorFileFromState(fileToDelete, "已删除文件，当前没有打开文件。");
      await loadExerciseWorkspace(studyRoot, practicePath, nextPreferredFile);
      setCodeStatus(`已删除 ${shortPath(fileToDelete)}`);
    } catch (error) {
      setCodeStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function changeEditorFontSize(delta: number) {
    setEditorFontSize((current) => roundFontSize(clamp(current + delta, minimumEditorFontSize, maximumEditorFontSize)));
  }

  function resetEditorFontSize() {
    setEditorFontSize(defaultEditorFontSize);
  }

  function resetEditorFontFamily() {
    setEditorFontFamilyId(defaultEditorFontFamilyId);
    setCustomEditorFontFamily("");
  }

  function beginCreateEditorFile() {
    if (!studyRoot || !practicePath) {
      setCodeStatus("请先选择一个带练习目录的小节。");
      return;
    }

    setNewFilePath("");
    setIsFileTreeHidden(false);
    setIsCreatingFile(true);
    setCodeStatus("请输入新文件相对路径，例如 src/helper.cpp。");
  }

  function cancelCreateEditorFile() {
    setNewFilePath("");
    setIsCreatingFile(false);
    setCodeStatus("已取消新建文件。");
  }

  async function confirmCreateEditorFile() {
    const relativePath = newFilePath.trim();
    if (!relativePath) {
      setCodeStatus("请输入文件名，例如 src/helper.cpp。");
      return;
    }

    try {
      const file = await window.learningApi.createTextFile({
        studyRoot,
        practicePath,
        relativePath,
        content: ""
      });
      setNewFilePath("");
      setIsCreatingFile(false);
      await loadExerciseWorkspace(studyRoot, practicePath, file.path);
      setCodeStatus(`已创建 ${shortPath(file.path)}`);
    } catch (error) {
      setCodeStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function persistActiveFile(): Promise<boolean> {
    if (!studyRoot || !activeFilePath) return false;
    try {
      const file = await window.learningApi.saveTextFile({
        studyRoot,
        filePath: activeFilePath,
        content: activeCode
      });
      setSavedFileContents((current) => ({ ...current, [file.path]: file.content }));
      setCodeStatus(`已保存 ${shortPath(file.path)}`);
      return true;
    } catch (error) {
      setCodeStatus(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function persistAllOpenFiles(): Promise<boolean> {
    for (const filePath of openFilePaths) {
      const content = fileContents[filePath];
      if (content === undefined || content === savedFileContents[filePath]) continue;
      try {
        const file = await window.learningApi.saveTextFile({
          studyRoot,
          filePath,
          content
        });
        setSavedFileContents((current) => ({ ...current, [file.path]: file.content }));
      } catch (error) {
        setCodeStatus(error instanceof Error ? error.message : String(error));
        return false;
      }
    }
    setCodeStatus("已保存全部打开文件。");
    return true;
  }

  async function saveAndRunExercise() {
    if (projectDirty) {
      const saved = await persistAllOpenFiles();
      if (!saved) return;
    }
    await runExercise();
  }

  async function runExercise() {
    if (!studyRoot || !practicePath) return;
    setStatus("正在通过 WSL + g++ 构建并运行当前练习目录...");
    try {
      const result = await window.learningApi.runExerciseProject({
        studyRoot,
        practicePath,
        stdin: toProgramStdin(exerciseInputRef.current)
      });
      setExerciseResult(result);
      setStatus(result.passed ? "编译运行成功。" : "编译或运行失败，请查看代码实验室输出。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function completeCurrentStage() {
    if (!studyRoot || !stageContent) return;
    const nextOverview = await window.learningApi.completeStage({
      studyRoot,
      stageId: stageContent.stage.id
    });
    setOverview(nextOverview);
    const nextStageId = nextOverview.progress.currentStageId ?? getNextStageId(nextOverview, stageContent.stage.id);
    setStatus(`已标记完成：${stageContent.stage.title}。正在进入下一节...`);
    if (nextStageId) {
      await loadStage(studyRoot, nextStageId);
    }
  }

  async function openNextStage() {
    if (!studyRoot || !stageContent) return;

    setStatus("正在标记当前小节完成，并准备进入下一节...");
    const nextOverview = await window.learningApi.completeStage({
      studyRoot,
      stageId: stageContent.stage.id
    });
    setOverview(nextOverview);
    const nextStageId = nextOverview.progress.currentStageId ?? getNextStageId(nextOverview, stageContent.stage.id);
    if (!nextStageId) {
      setStatus("当前已经是已识别阶段列表中的最后一节。");
      return;
    }

    await loadStage(studyRoot, nextStageId);
  }

  async function openPanelWindow(panel: WorkspacePanel, fullscreen = false) {
    await window.windowApi.openPanelWindow({
      panel,
      fullscreen,
      studyRoot,
      stageId: stageContent?.stage.id
    });
  }

  async function setCurrentWindowFullscreen(fullscreen: boolean) {
    await window.windowApi.setCurrentWindowFullscreen(fullscreen);
  }

  async function dockFocusedPanel() {
    if (!focusedPanel) return;
    await window.windowApi.dockPanelWindow(focusedPanel);
  }

  function minimizePanel(panel: WorkspacePanel) {
    if (focusedPanel) return;
    setMinimizedPanels((current) => (current.includes(panel) ? current : [...current, panel]));
  }

  function restorePanel(panel: WorkspacePanel) {
    setMinimizedPanels((current) => current.filter((item) => item !== panel));
  }

  function startColumnResize(handle: ResizeHandle, event: ReactPointerEvent<HTMLDivElement>) {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect) return;

    event.preventDefault();
    const start = columnPercents;
    const visiblePanelsForResize = visiblePanels.length === 2 ? visiblePanels : null;
    document.body.classList.add("is-resizing-columns");

    const onPointerMove = (moveEvent: PointerEvent) => {
      const pointerPercent = clamp(((moveEvent.clientX - rect.left) / rect.width) * 100, 0, 100);
      if (visiblePanelsForResize) {
        const [firstPanel, secondPanel] = visiblePanelsForResize;
        const firstKey = getColumnKey(firstPanel);
        const secondKey = getColumnKey(secondPanel);
        const visibleTotal = start[firstKey] + start[secondKey];
        const nextFirst = clamp(
          visibleTotal * (pointerPercent / 100),
          minimumColumnPercents[firstKey],
          visibleTotal - minimumColumnPercents[secondKey]
        );

        setColumnPercents({
          ...start,
          [firstKey]: roundColumn(nextFirst),
          [secondKey]: roundColumn(visibleTotal - nextFirst)
        });
        scheduleEditorMeasure();
        return;
      }

      if (handle === "left") {
        const leftMiddleTotal = start.left + start.middle;
        const nextLeft = clamp(pointerPercent, minimumColumnPercents.left, leftMiddleTotal - minimumColumnPercents.middle);
        setColumnPercents({
          left: roundColumn(nextLeft),
          middle: roundColumn(leftMiddleTotal - nextLeft),
          right: start.right
        });
        scheduleEditorMeasure();
        return;
      }

      const middleRightTotal = start.middle + start.right;
      const nextMiddle = clamp(pointerPercent - start.left, minimumColumnPercents.middle, middleRightTotal - minimumColumnPercents.right);
      setColumnPercents({
        left: start.left,
        middle: roundColumn(nextMiddle),
        right: roundColumn(middleRightTotal - nextMiddle)
      });
      scheduleEditorMeasure();
    };

    const stopResize = () => {
      document.body.classList.remove("is-resizing-columns");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointercancel", stopResize);
      scheduleEditorMeasure();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
  }

  function startFileTreeResize(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = miniIdeRef.current?.getBoundingClientRect();
    if (!rect || isFileTreeHidden) return;

    event.preventDefault();
    document.body.classList.add("is-resizing-file-tree");

    const maxWidth = Math.max(minimumFileTreeWidth, Math.min(maximumFileTreeWidth, rect.width - 360));
    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = clamp(moveEvent.clientX - rect.left, minimumFileTreeWidth, maxWidth);
      setFileTreeWidth(Math.round(nextWidth));
      scheduleEditorMeasure();
    };

    const stopResize = () => {
      document.body.classList.remove("is-resizing-file-tree");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointercancel", stopResize);
      scheduleEditorMeasure();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
  }

  function toggleFileTree() {
    setIsFileTreeHidden((current) => !current);
    scheduleEditorMeasure();
  }

  function toggleDirectory(relativePath: string) {
    setExpandedDirectories((current) => ({
      ...current,
      [relativePath]: !current[relativePath]
    }));
  }

  function renderFileTreeNode(node: FileTreeNode, depth = 0): ReactNode {
    if (node.type === "directory") {
      const isExpanded = expandedDirectories[node.relativePath] ?? true;
      return (
        <div key={node.relativePath} className="file-tree-group">
          <button
            className="file-tree-directory"
            style={{ "--tree-indent": `${8 + depth * 16}px` } as CSSProperties}
            onClick={() => toggleDirectory(node.relativePath)}
          >
            <span className="tree-chevron">{isExpanded ? "⌄" : "›"}</span>
            <span className="tree-node-icon folder-icon">
              <FolderTreeIcon open={isExpanded} />
            </span>
            <strong>{node.name}</strong>
          </button>
          {isExpanded && node.children.map((child) => renderFileTreeNode(child, depth + 1))}
        </div>
      );
    }

    const isDirty = fileContents[node.file.path] !== savedFileContents[node.file.path];
    return (
      <button
        key={node.file.path}
        className={node.file.path === activeFilePath ? "file-tree-item active" : "file-tree-item"}
        style={{ "--tree-indent": `${8 + depth * 16}px` } as CSSProperties}
        onClick={() => openEditorFile(studyRoot, node.file.path)}
      >
        <span className={`tree-node-icon ${getFileKindClass(node.file)}`}>
          <FileTreeIcon file={node.file} />
        </span>
        <strong>{node.file.name}</strong>
        {isDirty && <em>●</em>}
      </button>
    );
  }

  function renderPanelActionIcons(panel: WorkspacePanel): ReactNode {
    if (focusedPanel) return null;

    return (
      <div className="panel-actions">
        <IconButton label={`Open ${panel} panel in a new window`} onClick={() => openPanelWindow(panel)}>
          <PopOutIcon />
        </IconButton>
        <IconButton label={`Open ${panel} panel fullscreen`} onClick={() => openPanelWindow(panel, true)}>
          <FullscreenIcon />
        </IconButton>
        <IconButton label={`Minimize ${panel} panel`} onClick={() => minimizePanel(panel)}>
          <MinimizePanelIcon />
        </IconButton>
      </div>
    );
  }

  function renderMinimizedPanelDock(): ReactNode {
    if (focusedPanel || minimizedPanels.length === 0) return null;

    return (
      <section className="minimized-panel-dock" aria-label="Minimized panels">
        {minimizedPanels.map((panel) => (
          <IconButton key={panel} label={`Restore ${panel} panel`} onClick={() => restorePanel(panel)}>
            {getPanelDockIcon(panel)}
          </IconButton>
        ))}
      </section>
    );
  }

  return (
    <main className={focusedPanel ? `app-shell focused-panel-shell panel-${focusedPanel}` : `app-shell ${workspacePanelClassNames}`.trim()}>
      {focusedPanel && (
        <section className="panel-window-bar">
          <div>
            <p className="eyebrow">Detached Panel</p>
            <strong>{getPanelTitle(focusedPanel)}</strong>
          </div>
          <div className="panel-actions">
            <IconButton label="Dock panel back to main window" onClick={dockFocusedPanel}>
              <DockIcon />
            </IconButton>
            <IconButton label="Enter fullscreen" onClick={() => setCurrentWindowFullscreen(true)}>
              <FullscreenIcon />
            </IconButton>
            <IconButton label="Exit fullscreen" onClick={() => setCurrentWindowFullscreen(false)}>
              <ExitFullscreenIcon />
            </IconButton>
          </div>
        </section>
      )}

      {!focusedPanel && (
      <section className="topbar">
        <div>
          <p className="eyebrow">Local Learning Studio</p>
          <h1>C++ 本地学习工作台</h1>
        </div>
        <div className="topbar-actions">
          <button onClick={chooseStudyRoot}>选择学习目录</button>
          <button className="ghost-button" disabled={!studyRoot || isPending} onClick={() => scanAndLoad(studyRoot)}>
            重新扫描
          </button>
        </div>
      </section>
      )}

      {!focusedPanel && (
      <section className="status-bar">
        <span>{status}</span>
        <code>{studyRoot || "No study root selected"}</code>
      </section>
      )}

      {renderMinimizedPanelDock()}

      <section className="workspace-grid" ref={workspaceRef} style={workspaceStyle}>
        <aside className="sidebar">
          <section className="panel-dock-actions icon-only-actions">
            {renderPanelActionIcons("progress")}
          </section>

          <section className="progress-hero">
            <div className="progress-ring" style={progressRingStyle(overview?.progress.totalLearnedPercent ?? 21)}>
              <span>{overview?.progress.totalLearnedPercent ?? 21}%</span>
            </div>
            <div>
              <p>总学习进度</p>
              <strong>还剩 {overview?.progress.totalRemainingPercent ?? 79}%</strong>
            </div>
          </section>

          <section className="metric-grid">
            <div className="metric-card">
              <span>当前阶段</span>
              <strong>{overview?.progress.currentPhase ?? "Phase 2"}</strong>
            </div>
            <div className="metric-card">
              <span>阶段进度</span>
              <strong>{overview?.progress.currentPhaseLearnedPercent ?? 70}%</strong>
            </div>
          </section>

          <p className="progress-sentence">{progressSentence}</p>

          <section className="stage-panel">
            <div className="section-title">
              <span>阶段路线</span>
              <strong title="当前小节 / 当前查看范围内的小节总数">{stageRouteCounter}</strong>
            </div>
            <div className="stage-filter">
              <label htmlFor="stage-phase-filter">查看范围</label>
              <select
                id="stage-phase-filter"
                value={stagePhaseFilter}
                disabled={!overview}
                onChange={(event) => setStagePhaseFilter(event.target.value)}
              >
                <option value="all">全部阶段</option>
                {stagePhaseOptions.map((phase) => (
                  <option key={phase} value={phase}>
                    {phase}
                  </option>
                ))}
              </select>
            </div>
            <div className="stage-list">
              {visibleStages.map((stage) => (
                <button
                  key={stage.id}
                  className={stage.id === currentStageId ? "stage-card active" : "stage-card"}
                  onClick={() => loadStage(studyRoot, stage.id)}
                >
                  <span>{stage.title}</span>
                  <small>{formatStageMeta(stage)}</small>
                </button>
              ))}
              {overview && visibleStages.length === 0 && <p className="empty">当前筛选范围内没有阶段。</p>}
              {!overview && <p className="empty">选择目录后会自动生成阶段列表。</p>}
            </div>
          </section>
        </aside>

        <div
          className="column-resizer resize-progress-lesson"
          role="separator"
          aria-label="调整左栏和中栏宽度"
          onPointerDown={(event) => startColumnResize("left", event)}
        />

        <section className="lesson-panel">
          <div className="lesson-header">
            <div>
              <p className="eyebrow">Current Lesson</p>
              <h2>{stageContent?.stage.title ?? "学习内容"}</h2>
            </div>
            <div className="lesson-header-actions">
              <strong>{stageContent?.stage.grade ?? stageContent?.stage.status ?? "Ready"}</strong>
              {renderPanelActionIcons("lesson")}
            </div>
          </div>

          <article className="note-card">
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  pre({ children }) {
                    const codeBlock = getCodeBlock(children);
                    return (
                      <div className="example-card">
                        <div className="example-card-header">
                          <strong>{codeBlock.languageLabel} 示例代码</strong>
                        </div>
                        <SyntaxHighlighter
                          language={codeBlock.language}
                          style={oneLight}
                          customStyle={{
                            margin: 0,
                            padding: "16px 18px",
                            background: "rgba(255, 255, 255, 0.88)",
                            fontSize: "14px",
                            lineHeight: 1.72
                          }}
                          codeTagProps={{
                            style: {
                              fontFamily: editorFontFamily
                            }
                          }}
                        >
                          {codeBlock.code}
                        </SyntaxHighlighter>
                      </div>
                    );
                  }
                }}
              >
                {stageContent?.content ?? "这里会显示当前小节笔记。请选择或扫描学习目录后开始。"}
              </ReactMarkdown>
            </div>
          </article>

          <div className="source-strip">
            <span>关联资料</span>
            {stageContent?.sources.slice(0, 8).map((source) => (
              <code key={source.id} title={source.path}>
                {source.relativePath}
              </code>
            ))}
          </div>
        </section>

        <div
          className="column-resizer resize-lesson-studio"
          role="separator"
          aria-label="调整中栏和右栏宽度"
          onPointerDown={(event) => startColumnResize("right", event)}
        />

        <aside className="studio-panel">
          <section className="code-lab">
            <div className="section-title">
              <span>代码实验室</span>
              <div className="section-title-actions">
                <strong>{projectDirty ? "有未保存文件" : "已同步"}</strong>
                {renderPanelActionIcons("studio")}
              </div>
            </div>
            <code className="practice-path">{practicePath || "No exercise directory loaded"}</code>
            <div className="code-toolbar">
              <button className="ghost-button" onClick={toggleFileTree}>{isFileTreeHidden ? "显示文件栏" : "隐藏文件栏"}</button>
              <button className="ghost-button" onClick={() => loadExerciseWorkspace()}>刷新文件</button>
              <button className="ghost-button" onClick={beginCreateEditorFile}>新建文件</button>
              <button className="ghost-button" onClick={persistActiveFile} disabled={!activeDirty}>保存当前</button>
              <button className="ghost-button danger-button" onClick={() => void deleteActiveEditorFile()} disabled={!activeFilePath}>删除当前</button>
              <button className="ghost-button" onClick={persistAllOpenFiles} disabled={!projectDirty}>保存全部</button>
              <div className="font-family-control" aria-label="代码字体">
                <select
                  value={editorFontFamilyId}
                  onChange={(event) => setEditorFontFamilyId(event.target.value)}
                  title="代码字体"
                >
                  {editorFontOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                {editorFontFamilyId === "custom" && (
                  <input
                    value={customEditorFontFamily}
                    placeholder="Maple Mono, monospace"
                    spellCheck={false}
                    onChange={(event) => setCustomEditorFontFamily(sanitizeEditorFontFamily(event.target.value))}
                    title="自定义 CSS 字体族"
                  />
                )}
                <button
                  className="ghost-button"
                  onClick={resetEditorFontFamily}
                  disabled={editorFontFamilyId === defaultEditorFontFamilyId && customEditorFontFamily === ""}
                >
                  字体重置
                </button>
              </div>
              <div className="font-size-control" aria-label="代码字号调节">
                <button className="ghost-button" onClick={() => changeEditorFontSize(-1)} disabled={editorFontSize <= minimumEditorFontSize}>A-</button>
                <span>{editorFontSize}px</span>
                <button className="ghost-button" onClick={() => changeEditorFontSize(1)} disabled={editorFontSize >= maximumEditorFontSize}>A+</button>
                <button className="ghost-button" onClick={resetEditorFontSize} disabled={editorFontSize === defaultEditorFontSize}>重置</button>
              </div>
              <button onClick={saveAndRunExercise} disabled={!practicePath}>保存并运行</button>
              <button className="ghost-button" onClick={completeCurrentStage} disabled={!stageContent}>本节完成</button>
              <button className="ghost-button" onClick={openNextStage} disabled={!stageContent}>下一节</button>
            </div>
            <div className={isFileTreeHidden ? "mini-ide file-tree-hidden" : "mini-ide"} ref={miniIdeRef} style={miniIdeStyle}>
              <aside className="file-tree">
                <div className="file-tree-title">
                  <span>Files</span>
                  <button className="file-tree-title-action" onClick={toggleFileTree} title="隐藏文件栏">
                    <CollapseFileTreeIcon />
                  </button>
                </div>
                {isCreatingFile && (
                  <div className="new-file-panel">
                    <input
                      ref={newFileInputRef}
                      value={newFilePath}
                      placeholder="src/helper.cpp"
                      onChange={(event) => setNewFilePath(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void confirmCreateEditorFile();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelCreateEditorFile();
                        }
                      }}
                    />
                    <div className="new-file-actions">
                      <button onClick={() => void confirmCreateEditorFile()}>创建</button>
                      <button className="ghost-button" onClick={cancelCreateEditorFile}>取消</button>
                    </div>
                  </div>
                )}
                {fileTree.map((node) => renderFileTreeNode(node))}
                {fileTree.length === 0 && <p className="empty file-tree-empty">No files in this exercise.</p>}
              </aside>

              <div
                className="file-tree-resizer"
                role="separator"
                aria-label="调整文件栏宽度"
                onPointerDown={startFileTreeResize}
              />

              <section className="editor-column">
                <div className="tab-strip">
                  {openFilePaths.map((filePath) => (
                    <button
                      key={filePath}
                      className={filePath === activeFilePath ? "editor-tab active" : "editor-tab"}
                      onClick={() => setActiveFilePath(filePath)}
                      title={filePath}
                    >
                      <span className="editor-tab-name">{getFileName(filePath)}</span>
                      {fileContents[filePath] !== savedFileContents[filePath] && <span className="editor-tab-dirty">●</span>}
                      <span
                        className="editor-tab-close"
                        role="button"
                        aria-label={`关闭 ${getFileName(filePath)}`}
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          closeEditorTab(filePath);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          closeEditorTab(filePath);
                        }}
                      >
                        ×
                      </span>
                    </button>
                  ))}
                </div>
                <div className="editor-frame" ref={editorFrameRef}>
                  <div className="editor-titlebar">
                    <span className="editor-file-badge">{activeFilePath ? getFileExtensionLabel(activeFilePath) : "FILE"}</span>
                    <strong>{activeFilePath ? shortPath(activeFilePath) : "No file opened"}</strong>
                    <small className={editorErrorCount > 0 ? "editor-error-status" : ""}>
                      {getEditorStatus(activeDirty, editorErrorCount, editorWarningCount, codeStatus, liveDiagnosticStatus)}
                    </small>
                  </div>
                  <CodeMirror
                    value={activeCode}
                    width="100%"
                    height="100%"
                    extensions={editorExtensions}
                    basicSetup={{ foldGutter: true, highlightActiveLine: true }}
                    onCreateEditor={(view) => {
                      editorViewRef.current = view;
                      scheduleEditorMeasure();
                    }}
                    onChange={(value) => {
                      if (!activeFilePath) return;
                      setFileContents((current) => ({ ...current, [activeFilePath]: value }));
                    }}
                  />
                </div>
              </section>
            </div>
            <div className="ide-console">
              <div className="console-header">
                <strong>Program Input</strong>
                <div className="console-header-actions">
                  <span>stdin</span>
                  <button type="button" className="console-run-button" onClick={saveAndRunExercise} disabled={!practicePath}>
                    运行
                  </button>
                </div>
              </div>
              <ProgramInputBox onInputChange={handleProgramInputChange} />
            </div>
            {exerciseResult && (
              <div className={exerciseResult.passed ? "run-output pass" : "run-output fail"}>
                <div className="console-header">
                  <strong>{exerciseResult.passed ? "PASS" : "CHECK"}</strong>
                  <span>run result</span>
                </div>
                {renderRunResult(exerciseResult)}
              </div>
            )}
          </section>

          <section className="handoff-card">
            <div className="section-title">
              <span>完成小节后</span>
              <strong>交给老师检查</strong>
            </div>
            <ol>
              <li>先在代码实验室保存并运行。</li>
              <li>确认编译运行结果没有明显问题。</li>
              <li>回到对话里告诉我：我完成 {stageContent?.stage.title ?? "当前小节"} 练习了，请检查。</li>
              <li>我会检查代码、评分、指出问题，并安排下一小节。</li>
            </ol>
          </section>
        </aside>
      </section>
    </main>
  );
}

function loadColumnPercents(): ColumnPercents {
  try {
    const raw = localStorage.getItem(columnStorageKey);
    if (!raw) return defaultColumnPercents;
    const parsed = JSON.parse(raw) as Partial<ColumnPercents>;
    if (!isValidColumnPercents(parsed)) return defaultColumnPercents;
    return normalizeColumns(parsed as ColumnPercents);
  } catch {
    return defaultColumnPercents;
  }
}

function loadEditorFontSize(): number {
  const raw = localStorage.getItem(editorFontSizeStorageKey);
  const value = Number(raw);
  if (!Number.isFinite(value)) return defaultEditorFontSize;
  return roundFontSize(clamp(value, minimumEditorFontSize, maximumEditorFontSize));
}

function loadEditorFontFamilyId(): string {
  const raw = localStorage.getItem(editorFontFamilyStorageKey);
  if (raw && editorFontOptions.some((option) => option.id === raw)) return raw;
  return defaultEditorFontFamilyId;
}

function loadCustomEditorFontFamily(): string {
  return sanitizeEditorFontFamily(localStorage.getItem(customEditorFontFamilyStorageKey) ?? "");
}

function getEditorFontFamily(fontFamilyId: string, customFontFamily: string): string {
  if (fontFamilyId === "custom") {
    return customFontFamily.trim() || editorFontOptions.find((option) => option.id === defaultEditorFontFamilyId)?.family || "Consolas, monospace";
  }
  return editorFontOptions.find((option) => option.id === fontFamilyId)?.family
    ?? editorFontOptions.find((option) => option.id === defaultEditorFontFamilyId)?.family
    ?? "Consolas, monospace";
}

function sanitizeEditorFontFamily(value: string): string {
  return value
    .replace(/[;{}<>]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

function loadFileTreeWidth(): number {
  const raw = localStorage.getItem(fileTreeWidthStorageKey);
  const value = Number(raw);
  if (!Number.isFinite(value)) return defaultFileTreeWidth;
  return Math.round(clamp(value, minimumFileTreeWidth, maximumFileTreeWidth));
}

function loadFileTreeHidden(): boolean {
  try {
    return JSON.parse(localStorage.getItem(fileTreeHiddenStorageKey) ?? "false") === true;
  } catch {
    return false;
  }
}

function loadMinimizedPanels(): WorkspacePanel[] {
  try {
    const raw = localStorage.getItem(minimizedPanelStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return getUniquePanels(parsed.filter(isWorkspacePanel));
  } catch {
    return [];
  }
}

function isWorkspacePanel(value: unknown): value is WorkspacePanel {
  return value === "progress" || value === "lesson" || value === "studio";
}

function getUniquePanels(panels: WorkspacePanel[]): WorkspacePanel[] {
  return workspacePanels.filter((panel) => panels.includes(panel));
}

function getColumnKey(panel: WorkspacePanel): ColumnKey {
  if (panel === "progress") return "left";
  if (panel === "lesson") return "middle";
  return "right";
}

function IconButton({ label, onClick, children, disabled = false }: IconButtonProps) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function ProgramInputBox({ onInputChange }: ProgramInputBoxProps) {
  const [value, setValue] = useState("");

  function handleChange(event: ReactChangeEvent<HTMLTextAreaElement>) {
    const nextValue = normalizeProgramInput(event.currentTarget.value);
    setValue(nextValue);
    onInputChange(nextValue);
  }

  function stopKeyPropagation(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    event.stopPropagation();
  }

  return (
    <textarea
      className="stdin-box"
      value={value}
      rows={3}
      maxLength={maximumProgramInputLength}
      spellCheck={false}
      wrap="soft"
      onChange={handleChange}
      onKeyDown={stopKeyPropagation}
      onKeyUp={stopKeyPropagation}
      placeholder="程序输入，可为空。例如：keyword 回车 title 回车 content"
    />
  );
}

function getPanelDockIcon(panel: WorkspacePanel): ReactNode {
  if (panel === "progress") return <ProgressPanelIcon />;
  if (panel === "lesson") return <LessonPanelIcon />;
  return <StudioPanelIcon />;
}

function MinimizePanelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M8 17h8" />
    </svg>
  );
}

function ProgressPanelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19V5" />
      <path d="M9 19V9" />
      <path d="M13 19v-6" />
      <path d="M17 19V7" />
      <path d="M21 19H3" />
    </svg>
  );
}

function LessonPanelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4h12c.8 0 1.5.7 1.5 1.5V20H7.5A3.5 3.5 0 0 1 4 16.5v-10A2.5 2.5 0 0 1 6.5 4" />
      <path d="M7.5 16H19.5" />
      <path d="M8 8h7" />
      <path d="M8 11h5" />
    </svg>
  );
}

function StudioPanelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 9 5 12l3 3" />
      <path d="M16 9l3 3-3 3" />
      <path d="M13.5 6 10.5 18" />
      <path d="M4.8 4h14.4c1 0 1.8.8 1.8 1.8v12.4c0 1-.8 1.8-1.8 1.8H4.8c-1 0-1.8-.8-1.8-1.8V5.8C3 4.8 3.8 4 4.8 4Z" />
    </svg>
  );
}

function FolderTreeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {open ? (
        <>
          <path d="M3.8 7.5h6.3l1.6 2h8.5" />
          <path d="M3.5 9.5h17l-1.4 8.2c-.2 1-1 1.8-2.1 1.8H6c-1 0-1.9-.7-2.1-1.8L2.8 11c-.2-.8.2-1.5.7-1.5Z" />
        </>
      ) : (
        <>
          <path d="M3.5 7.2c0-1 .8-1.7 1.8-1.7h4.4l1.8 2.2h7.2c1 0 1.8.8 1.8 1.8v7.3c0 1-.8 1.7-1.8 1.7H5.3c-1 0-1.8-.7-1.8-1.7V7.2Z" />
        </>
      )}
    </svg>
  );
}

function FileTreeIcon({ file }: { file: ExerciseFile }) {
  if (file.name === "Makefile" || file.name === "makefile" || file.extension === ".mk") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3.5h8l4 4v13H6z" />
        <path d="M14 3.5v4h4" />
        <path d="M8.3 14.8h7.4" />
        <path d="M8.3 11.2h7.4" />
        <path d="M9 18h6" />
      </svg>
    );
  }

  if (file.kind === "source") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3.5h8l4 4v13H6z" />
        <path d="M14 3.5v4h4" />
        <path d="m10 12-2 2 2 2" />
        <path d="m14 12 2 2-2 2" />
      </svg>
    );
  }

  if (file.kind === "header") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3.5h8l4 4v13H6z" />
        <path d="M14 3.5v4h4" />
        <path d="M9 12v5" />
        <path d="M15 12v5" />
        <path d="M9 14.5h6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4" />
      <path d="M9 13h6" />
      <path d="M9 16h4" />
    </svg>
  );
}

function CollapseFileTreeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5.5h16v13H4z" />
      <path d="M9 5.5v13" />
      <path d="m15 9-3 3 3 3" />
    </svg>
  );
}

function PopOutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7H5.8C4.8 7 4 7.8 4 8.8v9.4c0 1 .8 1.8 1.8 1.8h9.4c1 0 1.8-.8 1.8-1.8V16" />
      <path d="M13 4h7v7" />
      <path d="M20 4l-9 9" />
    </svg>
  );
}

function DockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6.8C4 5.8 4.8 5 5.8 5h12.4c1 0 1.8.8 1.8 1.8v10.4c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8V6.8Z" />
      <path d="M8 5v14" />
      <path d="M14.5 9.5 11 13l3.5 3.5" />
      <path d="M11 13h7" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
      <path d="M9 4L4 9" />
      <path d="M15 4l5 5" />
      <path d="M9 20l-5-5" />
      <path d="M15 20l5-5" />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M9 20v-5H4" />
      <path d="M15 20v-5h5" />
      <path d="M4 9l5-5" />
      <path d="M20 9l-5-5" />
      <path d="M4 15l5 5" />
      <path d="M20 15l-5 5" />
    </svg>
  );
}

function isValidColumnPercents(value: Partial<ColumnPercents>): boolean {
  return typeof value.left === "number" && typeof value.middle === "number" && typeof value.right === "number";
}

function normalizeColumns(value: ColumnPercents): ColumnPercents {
  const left = Math.max(value.left, minimumColumnPercents.left);
  const middle = Math.max(value.middle, minimumColumnPercents.middle);
  const right = Math.max(value.right, minimumColumnPercents.right);
  const total = left + middle + right;
  return {
    left: roundColumn((left / total) * 100),
    middle: roundColumn((middle / total) * 100),
    right: roundColumn((right / total) * 100)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundColumn(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundFontSize(value: number): number {
  return Math.round(value * 2) / 2;
}

function getFocusedPanelFromUrl(): WorkspacePanel | null {
  const panel = getSearchParam("panel");
  if (panel === "progress" || panel === "lesson" || panel === "studio") return panel;
  return null;
}

function getSearchParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function getPanelTitle(panel: WorkspacePanel): string {
  if (panel === "progress") return "总进度与阶段路线";
  if (panel === "lesson") return "学习笔记";
  return "代码实验室";
}

function getCodeBlock(children: ReactNode): { code: string; language: string; languageLabel: string } {
  const child = Children.toArray(children)[0];
  if (!isValidElement(child)) {
    return { code: String(children ?? ""), language: "cpp", languageLabel: "C++" };
  }

  const props = child.props as { className?: string; children?: ReactNode };
  const rawLanguage = props.className?.match(/language-(\w+)/)?.[1] ?? "cpp";
  const language = normalizeCodeLanguage(rawLanguage);
  return {
    code: String(props.children ?? "").replace(/\n$/, ""),
    language,
    languageLabel: getLanguageLabel(language)
  };
}

function normalizeCodeLanguage(language: string): string {
  if (language === "c++") return "cpp";
  if (language === "cxx") return "cpp";
  if (language === "h") return "cpp";
  if (language === "hpp") return "cpp";
  if (language === "bash" || language === "sh" || language === "shell") return "bash";
  if (language === "text" || language === "txt") return "text";
  return language;
}

function getLanguageLabel(language: string): string {
  if (language === "cpp") return "C++";
  if (language === "bash") return "Shell";
  if (language === "text") return "Text";
  return language.toUpperCase();
}

function getNextStageId(overview: CourseOverview | null, currentStageId: string | undefined): string | null {
  if (!overview || !currentStageId) return null;
  const currentIndex = overview.stages.findIndex((stage) => stage.id === currentStageId);
  if (currentIndex < 0) return overview.stages[0]?.id ?? null;
  return overview.stages[currentIndex + 1]?.id ?? null;
}

function progressRingStyle(percent: number) {
  return {
    background: `conic-gradient(#f2a65a ${percent * 3.6}deg, rgba(255,255,255,0.16) 0deg)`
  };
}

function formatStageMeta(stage: LearningStage): string {
  const grade = stage.grade ? ` · ${stage.grade}` : "";
  const status = stage.status === "completed" ? "已完成" : stage.status === "learning" ? "学习中" : "未开始";
  return `${stage.phase} · ${status}${grade}`;
}

function getStagePhaseOptions(stages: LearningStage[]): string[] {
  const phases = new Set(stages.map((stage) => stage.phase).filter(Boolean));
  return [...phases].sort(comparePhaseLabels);
}

function formatStageRouteCounter(stages: LearningStage[], currentStageId: string | undefined): string {
  if (stages.length === 0) return "0/0";
  const currentIndex = stages.findIndex((stage) => stage.id === currentStageId);
  if (currentIndex < 0) return `-/${stages.length}`;
  return `${currentIndex + 1}/${stages.length}`;
}

function comparePhaseLabels(left: string, right: string): number {
  const leftNumber = Number(left.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
  const rightNumber = Number(right.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
  if (leftNumber !== rightNumber) return leftNumber - rightNumber;
  return left.localeCompare(right);
}

function shortPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts.slice(-3).join("/");
}

function getParentDirectory(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  if (index < 0) return "";
  return filePath.slice(0, index);
}

function getFileName(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).pop() ?? filePath;
}

function getFileExtensionLabel(filePath: string): string {
  const fileName = getFileName(filePath);
  if (fileName === "Makefile" || fileName === "makefile") return "MK";
  const extension = fileName.split(".").pop()?.toUpperCase();
  if (!extension || extension === fileName.toUpperCase()) return "FILE";
  if (extension === "CPP" || extension === "CC" || extension === "CXX") return "C++";
  return extension;
}

function getEditorExtensions(filePath: string, diagnostics: BuildDiagnostic[], projectSourceText: string): Extension[] {
  const completionSource = getCompletionSource(filePath, projectSourceText);
  return [
    getLanguageExtension(filePath),
    indentUnit.of("    "),
    EditorState.tabSize.of(4),
    diagnostics.length > 0 && lintGutter(),
    diagnostics.length > 0 && linter((view) => toCodeMirrorDiagnostics(diagnostics, view.state.doc)),
    diagnostics.length > 0 && diagnosticDecorationExtension(diagnostics),
    completionSource && autocompletion({
      activateOnTyping: true,
      maxRenderedOptions: 12,
      override: [completionSource]
    }),
    editorTabKeymap,
    codeEditorTheme
  ].filter(Boolean) as Extension[];
}

function getEditorDiagnostics(filePath: string, result: ExerciseResult | null): BuildDiagnostic[] {
  if (!filePath || !result || result.passed) return [];
  return parseBuildDiagnostics(result).filter((diagnostic) => diagnosticMatchesFile(filePath, diagnostic.filePath));
}

function parseBuildDiagnostics(result: ExerciseResult): BuildDiagnostic[] {
  const text = [result.compileOutput, result.stderr].filter(Boolean).join("\n");
  const diagnostics: BuildDiagnostic[] = [];

  for (const line of text.split(/\r?\n/)) {
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

    diagnostics.push({
      filePath: normalizeBuildFilePath(rawFilePath),
      line: Number.isFinite(lineNumber) ? lineNumber : 1,
      column: Number.isFinite(columnNumber) ? columnNumber : 1,
      severity: getDiagnosticSeverity(rawSeverity),
      message
    });
  }

  return diagnostics;
}

function toCodeMirrorDiagnostics(diagnostics: BuildDiagnostic[], doc: Text): Diagnostic[] {
  return diagnostics.map((diagnostic) => {
    const range = getVisibleDiagnosticRange(diagnostic, doc);
    return {
      from: range.from,
      to: range.to,
      severity: diagnostic.severity,
      message: diagnostic.message
    };
  });
}

function diagnosticDecorationExtension(diagnostics: BuildDiagnostic[]): Extension {
  return EditorView.decorations.of((view) => {
    const ranges = diagnostics.flatMap((diagnostic) => {
      const range = getVisibleDiagnosticRange(diagnostic, view.state.doc);
      const markClass = diagnostic.severity === "error" ? "live-diagnostic-mark-error" : "live-diagnostic-mark-warning";
      const lineClass = diagnostic.severity === "error" ? "live-diagnostic-line-error" : "live-diagnostic-line-warning";
      const decorations = [Decoration.line({ class: lineClass }).range(range.lineFrom)];

      if (range.to > range.from) {
        decorations.push(Decoration.mark({
          class: markClass,
          attributes: { title: diagnostic.message }
        }).range(range.from, range.to));
      }

      return decorations;
    });
    return Decoration.set(ranges, true);
  });
}

function getVisibleDiagnosticRange(diagnostic: BuildDiagnostic, doc: Text): { from: number; to: number; lineFrom: number } {
  const line = doc.line(clamp(diagnostic.line, 1, doc.lines));
  const lineText = line.text;
  const columnIndex = clamp(diagnostic.column - 1, 0, Math.max(lineText.length - 1, 0));

  if (line.length === 0) {
    return { from: line.from, to: line.from, lineFrom: line.from };
  }

  const tokenRange = getTokenRange(lineText, columnIndex);
  if (tokenRange) {
    return {
      from: line.from + tokenRange.start,
      to: line.from + tokenRange.end,
      lineFrom: line.from
    };
  }

  const contextRange = getDiagnosticContextRange(lineText, columnIndex);
  return {
    from: line.from + contextRange.start,
    to: line.from + contextRange.end,
    lineFrom: line.from
  };
}

function getTokenRange(lineText: string, columnIndex: number): { start: number; end: number } | null {
  const tokenPattern = /[A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:\.[0-9]+)?|::|==|!=|<=|>=|&&|\|\||->|[{}()[\].,;:+\-*/%<>=!&|]/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (columnIndex >= start && columnIndex < end) {
      return { start, end };
    }
    if (columnIndex === end && match[0].length > 1) {
      return { start, end };
    }
  }
  return null;
}

function getDiagnosticContextRange(lineText: string, columnIndex: number): { start: number; end: number } {
  const trimmedEnd = Math.max(1, lineText.trimEnd().length);
  const center = clamp(columnIndex, 0, trimmedEnd - 1);
  const start = clamp(center - 6, 0, trimmedEnd - 1);
  const end = clamp(center + 10, start + 1, trimmedEnd);
  return { start, end };
}

function getDiagnosticSeverity(value: string): Diagnostic["severity"] {
  if (value === "warning") return "warning";
  if (value === "note") return "info";
  return "error";
}

function diagnosticMatchesFile(activeFilePath: string, diagnosticFilePath: string): boolean {
  const active = normalizeComparablePath(activeFilePath);
  const diagnostic = normalizeComparablePath(diagnosticFilePath);
  if (!diagnostic) return false;
  return active === diagnostic || active.endsWith(`/${diagnostic}`);
}

function normalizeBuildFilePath(filePath: string): string {
  const cleanPath = filePath.trim().replace(/^"|"$/g, "");
  const wslMatch = cleanPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (wslMatch) {
    return `${wslMatch[1].toUpperCase()}:/${wslMatch[2]}`;
  }
  return cleanPath;
}

function normalizeComparablePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/\/+/g, "/").toLowerCase();
}

function getEditorStatus(activeDirty: boolean, errorCount: number, warningCount: number, fallbackStatus: string, liveDiagnosticStatus: string): string {
  if (liveDiagnosticStatus) return liveDiagnosticStatus;
  if (activeDirty) return "未保存修改";
  if (errorCount > 0 && warningCount > 0) return `${errorCount} 个错误，${warningCount} 个警告`;
  if (errorCount > 0) return `${errorCount} 个错误`;
  if (warningCount > 0) return `${warningCount} 个警告`;
  return fallbackStatus;
}

function getLiveDiagnosticStatus(passed: boolean, errorCount: number, warningCount: number): string {
  if (passed) return warningCount > 0 ? `实时检查：${warningCount} 个警告` : "实时检查通过";
  if (errorCount > 0 && warningCount > 0) return `实时检查：${errorCount} 个错误，${warningCount} 个警告`;
  if (errorCount > 0) return `实时检查：${errorCount} 个错误`;
  if (warningCount > 0) return `实时检查：${warningCount} 个警告`;
  return "实时检查未通过";
}

function getLanguageExtension(filePath: string): Extension | null {
  const fileName = getFileName(filePath);
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (fileName === "Makefile" || fileName === "makefile" || extension === "mk") return makefileLanguage;
  if (["cpp", "cc", "cxx", "h", "hpp"].includes(extension ?? "")) return cpp();
  return null;
}

function isCppLikeFile(filePath: string): boolean {
  const extension = getFileName(filePath).split(".").pop()?.toLowerCase();
  return ["cpp", "cc", "cxx", "h", "hpp"].includes(extension ?? "");
}

function getProjectCompletionSourceText(fileContents: Record<string, string>, activeFilePath: string, activeCode: string): string {
  const codeFileEntries = Object.entries(fileContents)
    .filter(([filePath]) => isCppLikeFile(filePath))
    .sort(([leftPath], [rightPath]) => {
      if (leftPath === activeFilePath) return -1;
      if (rightPath === activeFilePath) return 1;
      return leftPath.localeCompare(rightPath);
    });

  return codeFileEntries
    .map(([filePath, content]) => (filePath === activeFilePath ? activeCode : content))
    .join("\n\n");
}

function getCompletionSource(filePath: string, projectSourceText: string): CompletionSource | null {
  const fileName = getFileName(filePath);
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (fileName === "Makefile" || fileName === "makefile" || extension === "mk") return makefileCompletionSource;
  if (["cpp", "cc", "cxx", "h", "hpp"].includes(extension ?? "")) return createSmartCompletionSource(cppCompletions, true, projectSourceText);
  return null;
}

function getFileKindClass(file: ExerciseFile): string {
  if (file.kind === "source") return "file-kind-source";
  if (file.kind === "header") return "file-kind-header";
  if (file.kind === "build") return "file-kind-build";
  if (file.extension === ".md") return "file-kind-markdown";
  return "file-kind-text";
}

function buildFileTree(files: ExerciseFile[]): FileTreeNode[] {
  const root: FileTreeDirectory = {
    type: "directory",
    name: "",
    relativePath: "",
    children: []
  };

  for (const file of files) {
    const parts = file.relativePath.split("/").filter(Boolean);
    let currentDirectory = root;

    for (const directoryName of parts.slice(0, -1)) {
      const relativePath = currentDirectory.relativePath ? `${currentDirectory.relativePath}/${directoryName}` : directoryName;
      let nextDirectory = currentDirectory.children.find(
        (child): child is FileTreeDirectory => child.type === "directory" && child.relativePath === relativePath
      );

      if (!nextDirectory) {
        nextDirectory = {
          type: "directory",
          name: directoryName,
          relativePath,
          children: []
        };
        currentDirectory.children.push(nextDirectory);
      }

      currentDirectory = nextDirectory;
    }

    currentDirectory.children.push({ type: "file", file });
  }

  sortFileTree(root.children);
  return root.children;
}

function sortFileTree(nodes: FileTreeNode[]): void {
  nodes.sort(compareFileTreeNodes);
  for (const node of nodes) {
    if (node.type === "directory") sortFileTree(node.children);
  }
}

function compareFileTreeNodes(left: FileTreeNode, right: FileTreeNode): number {
  if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
  if (left.type === "directory" && right.type === "directory") {
    return left.name.localeCompare(right.name);
  }

  if (left.type === "file" && right.type === "file") {
    const weightDifference = getFileSortWeight(left.file) - getFileSortWeight(right.file);
    if (weightDifference !== 0) return weightDifference;
    return left.file.name.localeCompare(right.file.name);
  }

  return 0;
}

function getFileSortWeight(file: ExerciseFile): number {
  if (file.name === "Makefile" || file.name === "makefile") return 0;
  if (file.name === "main.cpp") return 1;
  if (file.kind === "source") return 2;
  if (file.kind === "header") return 3;
  return 4;
}

function mergeExpandedDirectories(current: Record<string, boolean>, files: ExerciseFile[]): Record<string, boolean> {
  const directoryPaths = getDirectoryPaths(files);
  const next: Record<string, boolean> = {};
  for (const directoryPath of directoryPaths) {
    next[directoryPath] = current[directoryPath] ?? true;
  }
  return next;
}

function getDirectoryPaths(files: ExerciseFile[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    const parts = file.relativePath.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      paths.add(parts.slice(0, index).join("/"));
    }
  }
  return [...paths].sort();
}

function formatRunOutput(result: ExerciseResult): string {
  const cleanCompileOutput = cleanToolOutput(result.compileOutput);
  const cleanStdout = cleanToolOutput(result.stdout);
  const cleanStderr = cleanToolOutput(result.stderr);

  return [
    cleanCompileOutput && `Compile:\n${cleanCompileOutput}`,
    cleanStdout && `Stdout:\n${cleanStdout}`,
    cleanStderr && `Stderr:\n${cleanStderr}`,
    `ExitCode: ${result.exitCode ?? "null"}`
  ]
    .filter(Boolean)
    .join("\n\n");
}

function renderRunResult(result: ExerciseResult): ReactNode {
  const compileOutput = cleanToolOutput(result.compileOutput);
  const stdout = cleanToolOutput(result.stdout);
  const stderr = cleanToolOutput(result.stderr);
  const hasVisibleOutput = Boolean(stdout || stderr || (!result.passed && compileOutput));

  return (
    <div className="run-result-body">
      {hasVisibleOutput ? (
        <>
          {!result.passed && compileOutput && (
            <section className="run-result-section">
              <strong>编译信息</strong>
              <pre>{compileOutput}</pre>
            </section>
          )}
          {stdout && (
            <section className="run-result-section">
              <strong>程序输出</strong>
              <pre>{stdout}</pre>
            </section>
          )}
          {stderr && (
            <section className="run-result-section warning">
              <strong>错误输出</strong>
              <pre>{stderr}</pre>
            </section>
          )}
        </>
      ) : (
        <p className="run-result-empty">{result.passed ? "程序运行成功，没有输出。" : "没有捕获到程序输出。"}</p>
      )}

      <details className="run-result-details">
        <summary>查看编译细节</summary>
        <code>{result.command}</code>
        <pre>{formatRunOutput(result)}</pre>
      </details>
    </div>
  );
}

function cleanToolOutput(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !isNoisyToolOutputLine(line))
    .join("\n")
    .trim();
}

function isNoisyToolOutputLine(line: string): boolean {
  const normalizedLine = line.toLowerCase();
  return normalizedLine.includes("localhost") && normalizedLine.includes("wsl") && normalizedLine.includes("nat");
}

function normalizeProgramInput(value: string): string {
  return value.replace(/\r\n?/g, "\n").slice(0, maximumProgramInputLength);
}

function toProgramStdin(value: string): string {
  const normalized = normalizeProgramInput(value);
  if (!normalized) return "";
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}
