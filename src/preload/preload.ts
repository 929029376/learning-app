import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

import type {
  CreateTextFileRequest,
  DeleteTextFileRequest,
  LearningApi,
  ListExerciseFilesRequest,
  PanelWindowRequest,
  RunCppExerciseRequest,
  RunExerciseProjectRequest,
  SaveTextFileRequest,
  SaveUserDecisionRequest,
  StageActionRequest,
  TextFileRequest,
  ValidateCppContentRequest,
  WorkspacePanel,
  WindowApi
} from "../shared/types.js";

const learningApi: LearningApi = {
  getDefaultStudyRoot: () => ipcRenderer.invoke("study:getDefaultStudyRoot"),
  selectStudyRoot: () => ipcRenderer.invoke("study:selectStudyRoot"),
  scanStudyRoot: (studyRoot: string) => ipcRenderer.invoke("study:scanStudyRoot", studyRoot),
  getCourseOverview: (studyRoot: string) => ipcRenderer.invoke("study:getCourseOverview", studyRoot),
  getStageContent: (studyRoot: string, stageId: string) => ipcRenderer.invoke("study:getStageContent", studyRoot, stageId),
  runCppExercise: (request: RunCppExerciseRequest) => ipcRenderer.invoke("study:runCppExercise", request),
  runExerciseProject: (request: RunExerciseProjectRequest) => ipcRenderer.invoke("study:runExerciseProject", request),
  validateCppContent: (request: ValidateCppContentRequest) => ipcRenderer.invoke("study:validateCppContent", request),
  listExerciseFiles: (request: ListExerciseFilesRequest) => ipcRenderer.invoke("study:listExerciseFiles", request),
  createTextFile: (request: CreateTextFileRequest) => ipcRenderer.invoke("study:createTextFile", request),
  deleteTextFile: (request: DeleteTextFileRequest) => ipcRenderer.invoke("study:deleteTextFile", request),
  readTextFile: (request: TextFileRequest) => ipcRenderer.invoke("study:readTextFile", request),
  saveTextFile: (request: SaveTextFileRequest) => ipcRenderer.invoke("study:saveTextFile", request),
  saveUserDecision: (request: SaveUserDecisionRequest) => ipcRenderer.invoke("study:saveUserDecision", request),
  completeStage: (request: StageActionRequest) => ipcRenderer.invoke("study:completeStage", request),
  setCurrentStage: (request: StageActionRequest) => ipcRenderer.invoke("study:setCurrentStage", request)
};

const windowApi: WindowApi = {
  openPanelWindow: (request: PanelWindowRequest) => ipcRenderer.invoke("window:openPanelWindow", request),
  dockPanelWindow: (panel: WorkspacePanel) => ipcRenderer.invoke("window:dockPanelWindow", panel),
  getDetachedPanels: () => ipcRenderer.invoke("window:getDetachedPanels"),
  onDetachedPanelsChanged: (callback: (panels: WorkspacePanel[]) => void) => {
    const listener = (_event: IpcRendererEvent, panels: WorkspacePanel[]) => callback(panels);
    ipcRenderer.on("window:detachedPanelsChanged", listener);
    return () => ipcRenderer.removeListener("window:detachedPanelsChanged", listener);
  },
  setCurrentWindowFullscreen: (fullscreen: boolean) => ipcRenderer.invoke("window:setCurrentWindowFullscreen", fullscreen)
};

contextBridge.exposeInMainWorld("learningApi", learningApi);
contextBridge.exposeInMainWorld("windowApi", windowApi);
