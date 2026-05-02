"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const learningApi = {
    getDefaultStudyRoot: () => electron_1.ipcRenderer.invoke("study:getDefaultStudyRoot"),
    isStudyRootAvailable: (studyRoot) => electron_1.ipcRenderer.invoke("study:isStudyRootAvailable", studyRoot),
    selectStudyRoot: () => electron_1.ipcRenderer.invoke("study:selectStudyRoot"),
    scanStudyRoot: (studyRoot) => electron_1.ipcRenderer.invoke("study:scanStudyRoot", studyRoot),
    getCourseOverview: (studyRoot) => electron_1.ipcRenderer.invoke("study:getCourseOverview", studyRoot),
    getStageContent: (studyRoot, stageId) => electron_1.ipcRenderer.invoke("study:getStageContent", studyRoot, stageId),
    runCppExercise: (request) => electron_1.ipcRenderer.invoke("study:runCppExercise", request),
    runExerciseProject: (request) => electron_1.ipcRenderer.invoke("study:runExerciseProject", request),
    validateCppContent: (request) => electron_1.ipcRenderer.invoke("study:validateCppContent", request),
    listExerciseFiles: (request) => electron_1.ipcRenderer.invoke("study:listExerciseFiles", request),
    createTextFile: (request) => electron_1.ipcRenderer.invoke("study:createTextFile", request),
    deleteTextFile: (request) => electron_1.ipcRenderer.invoke("study:deleteTextFile", request),
    readTextFile: (request) => electron_1.ipcRenderer.invoke("study:readTextFile", request),
    saveTextFile: (request) => electron_1.ipcRenderer.invoke("study:saveTextFile", request),
    saveUserDecision: (request) => electron_1.ipcRenderer.invoke("study:saveUserDecision", request),
    completeStage: (request) => electron_1.ipcRenderer.invoke("study:completeStage", request),
    setCurrentStage: (request) => electron_1.ipcRenderer.invoke("study:setCurrentStage", request)
};
const windowApi = {
    openPanelWindow: (request) => electron_1.ipcRenderer.invoke("window:openPanelWindow", request),
    dockPanelWindow: (panel) => electron_1.ipcRenderer.invoke("window:dockPanelWindow", panel),
    getDetachedPanels: () => electron_1.ipcRenderer.invoke("window:getDetachedPanels"),
    onDetachedPanelsChanged: (callback) => {
        const listener = (_event, panels) => callback(panels);
        electron_1.ipcRenderer.on("window:detachedPanelsChanged", listener);
        return () => electron_1.ipcRenderer.removeListener("window:detachedPanelsChanged", listener);
    },
    setCurrentWindowFullscreen: (fullscreen) => electron_1.ipcRenderer.invoke("window:setCurrentWindowFullscreen", fullscreen)
};
electron_1.contextBridge.exposeInMainWorld("learningApi", learningApi);
electron_1.contextBridge.exposeInMainWorld("windowApi", windowApi);
