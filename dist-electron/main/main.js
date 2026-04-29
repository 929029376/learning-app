"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const ipc_js_1 = require("./ipc.js");
let mainWindow = null;
const detachedPanelWindows = new Map();
const panelTitles = {
    progress: "Study Progress",
    lesson: "Lesson Notes",
    studio: "Code Studio"
};
function createWindow(options = {}) {
    const panelSize = getPanelWindowSize(options.panel);
    const window = new electron_1.BrowserWindow({
        width: panelSize.width,
        height: panelSize.height,
        minWidth: panelSize.minWidth,
        minHeight: panelSize.minHeight,
        fullscreen: options.fullscreen ?? false,
        title: options.panel ? `${panelTitles[options.panel]} - Local Learning Studio` : "Local Learning Studio",
        backgroundColor: "#f2eadf",
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "../preload/preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });
    void loadApp(window, options);
    if (!options.panel) {
        mainWindow = window;
        window.on("closed", () => {
            mainWindow = null;
        });
    }
    return window;
}
function getPanelWindowSize(panel) {
    if (panel === "progress")
        return { width: 520, height: 860, minWidth: 420, minHeight: 640 };
    if (panel === "lesson")
        return { width: 920, height: 900, minWidth: 680, minHeight: 640 };
    if (panel === "studio")
        return { width: 1120, height: 920, minWidth: 820, minHeight: 680 };
    return { width: 1440, height: 900, minWidth: 1180, minHeight: 720 };
}
async function loadApp(window, options) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
        const url = new URL(devServerUrl);
        setWindowQueryParams(url.searchParams, options);
        await window.loadURL(url.toString());
        return;
    }
    const query = getWindowQuery(options);
    await window.loadFile(node_path_1.default.join(__dirname, "../../dist-renderer/index.html"), query ? { query } : undefined);
}
function setWindowQueryParams(searchParams, options) {
    if (options.panel)
        searchParams.set("panel", options.panel);
    if (options.studyRoot)
        searchParams.set("studyRoot", options.studyRoot);
    if (options.stageId)
        searchParams.set("stageId", options.stageId);
}
function getWindowQuery(options) {
    const query = {};
    if (options.panel)
        query.panel = options.panel;
    if (options.studyRoot)
        query.studyRoot = options.studyRoot;
    if (options.stageId)
        query.stageId = options.stageId;
    return Object.keys(query).length > 0 ? query : undefined;
}
function registerWindowHandlers() {
    electron_1.ipcMain.handle("window:openPanelWindow", (_event, request) => {
        detachPanelWindow(request);
    });
    electron_1.ipcMain.handle("window:dockPanelWindow", (_event, panel) => {
        dockPanelWindow(panel);
    });
    electron_1.ipcMain.handle("window:getDetachedPanels", () => {
        return getDetachedPanels();
    });
    electron_1.ipcMain.handle("window:setCurrentWindowFullscreen", (event, fullscreen) => {
        electron_1.BrowserWindow.fromWebContents(event.sender)?.setFullScreen(fullscreen);
    });
}
function detachPanelWindow(request) {
    const existingWindow = detachedPanelWindows.get(request.panel);
    if (existingWindow && !existingWindow.isDestroyed()) {
        existingWindow.setFullScreen(request.fullscreen ?? existingWindow.isFullScreen());
        existingWindow.focus();
        broadcastDetachedPanels();
        return;
    }
    const panelWindow = createWindow({
        panel: request.panel,
        fullscreen: request.fullscreen ?? false,
        studyRoot: request.studyRoot,
        stageId: request.stageId
    });
    detachedPanelWindows.set(request.panel, panelWindow);
    panelWindow.on("closed", () => {
        if (detachedPanelWindows.get(request.panel) === panelWindow) {
            detachedPanelWindows.delete(request.panel);
            broadcastDetachedPanels();
        }
    });
    broadcastDetachedPanels();
}
function dockPanelWindow(panel) {
    const panelWindow = detachedPanelWindows.get(panel);
    if (!panelWindow || panelWindow.isDestroyed()) {
        detachedPanelWindows.delete(panel);
        broadcastDetachedPanels();
        return;
    }
    detachedPanelWindows.delete(panel);
    broadcastDetachedPanels();
    panelWindow.close();
}
function getDetachedPanels() {
    return [...detachedPanelWindows.entries()]
        .filter(([, window]) => !window.isDestroyed())
        .map(([panel]) => panel);
}
function broadcastDetachedPanels() {
    const detachedPanels = getDetachedPanels();
    for (const window of electron_1.BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
            window.webContents.send("window:detachedPanelsChanged", detachedPanels);
        }
    }
}
void electron_1.app.whenReady().then(() => {
    (0, ipc_js_1.registerIpcHandlers)();
    registerWindowHandlers();
    createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
