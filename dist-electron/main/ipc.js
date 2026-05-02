"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const course_js_1 = require("./course.js");
const cppRunner_js_1 = require("./cppRunner.js");
const database_js_1 = require("./database.js");
const fileUtils_js_1 = require("./fileUtils.js");
const scanner_js_1 = require("./scanner.js");
const textFile_js_1 = require("./textFile.js");
function registerIpcHandlers() {
    electron_1.ipcMain.handle("study:getDefaultStudyRoot", async () => {
        return (await (0, fileUtils_js_1.pathExists)(fileUtils_js_1.DEFAULT_STUDY_ROOT)) ? fileUtils_js_1.DEFAULT_STUDY_ROOT : null;
    });
    electron_1.ipcMain.handle("study:isStudyRootAvailable", async (_event, studyRoot) => {
        return (0, fileUtils_js_1.isDirectory)(studyRoot);
    });
    electron_1.ipcMain.handle("study:selectStudyRoot", async () => {
        const result = await electron_1.dialog.showOpenDialog({
            title: "Select study directory",
            properties: ["openDirectory"]
        });
        if (result.canceled || result.filePaths.length === 0)
            return null;
        return result.filePaths[0];
    });
    electron_1.ipcMain.handle("study:scanStudyRoot", async (_event, studyRoot) => {
        return (0, scanner_js_1.scanStudyRoot)(studyRoot);
    });
    electron_1.ipcMain.handle("study:getCourseOverview", async (_event, studyRoot) => {
        return (0, scanner_js_1.getCourseOverview)(studyRoot);
    });
    electron_1.ipcMain.handle("study:getStageContent", async (_event, studyRoot, stageId) => {
        const database = await database_js_1.StudyDatabase.open(studyRoot);
        return (0, course_js_1.getStageContent)(studyRoot, stageId, database.listSources());
    });
    electron_1.ipcMain.handle("study:runCppExercise", async (_event, request) => {
        return (0, cppRunner_js_1.runCppExercise)(request);
    });
    electron_1.ipcMain.handle("study:runExerciseProject", async (_event, request) => {
        return (0, cppRunner_js_1.runExerciseProject)(request);
    });
    electron_1.ipcMain.handle("study:validateCppContent", async (_event, request) => {
        return (0, cppRunner_js_1.validateCppContent)(request);
    });
    electron_1.ipcMain.handle("study:listExerciseFiles", async (_event, request) => {
        return (0, textFile_js_1.listExerciseFiles)(request);
    });
    electron_1.ipcMain.handle("study:createTextFile", async (_event, request) => {
        return (0, textFile_js_1.createTextFile)(request);
    });
    electron_1.ipcMain.handle("study:deleteTextFile", async (_event, request) => {
        return (0, textFile_js_1.deleteTextFile)(request);
    });
    electron_1.ipcMain.handle("study:readTextFile", async (_event, request) => {
        return (0, textFile_js_1.readTextFile)(request);
    });
    electron_1.ipcMain.handle("study:saveTextFile", async (_event, request) => {
        return (0, textFile_js_1.saveTextFile)(request);
    });
    electron_1.ipcMain.handle("study:saveUserDecision", async (_event, request) => {
        const database = await database_js_1.StudyDatabase.open(request.studyRoot);
        database.saveUserDecision(request.stageId, request.decisionType, request.content);
    });
    electron_1.ipcMain.handle("study:completeStage", async (_event, request) => {
        const database = await database_js_1.StudyDatabase.open(request.studyRoot);
        return (0, course_js_1.completeStage)(request.studyRoot, request.stageId, database.listSources());
    });
    electron_1.ipcMain.handle("study:setCurrentStage", async (_event, request) => {
        const database = await database_js_1.StudyDatabase.open(request.studyRoot);
        return (0, course_js_1.setCurrentStage)(request.studyRoot, request.stageId, database.listSources());
    });
}
