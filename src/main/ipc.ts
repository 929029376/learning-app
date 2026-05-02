import { dialog, ipcMain } from "electron";

import type { CreateTextFileRequest, DeleteTextFileRequest, ListExerciseFilesRequest, RunCppExerciseRequest, RunExerciseProjectRequest, SaveUserDecisionRequest, StageActionRequest, ValidateCppContentRequest } from "../shared/types.js";
import { completeStage, getStageContent, setCurrentStage } from "./course.js";
import { runCppExercise, runExerciseProject, validateCppContent } from "./cppRunner.js";
import { StudyDatabase } from "./database.js";
import { DEFAULT_STUDY_ROOT, isDirectory, pathExists } from "./fileUtils.js";
import { getCourseOverview, scanStudyRoot } from "./scanner.js";
import { createTextFile, deleteTextFile, listExerciseFiles, readTextFile, saveTextFile } from "./textFile.js";

export function registerIpcHandlers(): void {
  ipcMain.handle("study:getDefaultStudyRoot", async () => {
    return (await pathExists(DEFAULT_STUDY_ROOT)) ? DEFAULT_STUDY_ROOT : null;
  });

  ipcMain.handle("study:isStudyRootAvailable", async (_event, studyRoot: string) => {
    return isDirectory(studyRoot);
  });

  ipcMain.handle("study:selectStudyRoot", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select study directory",
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("study:scanStudyRoot", async (_event, studyRoot: string) => {
    return scanStudyRoot(studyRoot);
  });

  ipcMain.handle("study:getCourseOverview", async (_event, studyRoot: string) => {
    return getCourseOverview(studyRoot);
  });

  ipcMain.handle("study:getStageContent", async (_event, studyRoot: string, stageId: string) => {
    const database = await StudyDatabase.open(studyRoot);
    return getStageContent(studyRoot, stageId, database.listSources());
  });

  ipcMain.handle("study:runCppExercise", async (_event, request: RunCppExerciseRequest) => {
    return runCppExercise(request);
  });

  ipcMain.handle("study:runExerciseProject", async (_event, request: RunExerciseProjectRequest) => {
    return runExerciseProject(request);
  });

  ipcMain.handle("study:validateCppContent", async (_event, request: ValidateCppContentRequest) => {
    return validateCppContent(request);
  });

  ipcMain.handle("study:listExerciseFiles", async (_event, request: ListExerciseFilesRequest) => {
    return listExerciseFiles(request);
  });

  ipcMain.handle("study:createTextFile", async (_event, request: CreateTextFileRequest) => {
    return createTextFile(request);
  });

  ipcMain.handle("study:deleteTextFile", async (_event, request: DeleteTextFileRequest) => {
    return deleteTextFile(request);
  });

  ipcMain.handle("study:readTextFile", async (_event, request) => {
    return readTextFile(request);
  });

  ipcMain.handle("study:saveTextFile", async (_event, request) => {
    return saveTextFile(request);
  });

  ipcMain.handle("study:saveUserDecision", async (_event, request: SaveUserDecisionRequest) => {
    const database = await StudyDatabase.open(request.studyRoot);
    database.saveUserDecision(request.stageId, request.decisionType, request.content);
  });

  ipcMain.handle("study:completeStage", async (_event, request: StageActionRequest) => {
    const database = await StudyDatabase.open(request.studyRoot);
    return completeStage(request.studyRoot, request.stageId, database.listSources());
  });

  ipcMain.handle("study:setCurrentStage", async (_event, request: StageActionRequest) => {
    const database = await StudyDatabase.open(request.studyRoot);
    return setCurrentStage(request.studyRoot, request.stageId, database.listSources());
  });
}
