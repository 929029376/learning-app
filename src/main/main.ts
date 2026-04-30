import { app, BrowserWindow, ipcMain } from "electron";
import type { BrowserWindow as BrowserWindowInstance } from "electron";
import fs from "node:fs";
import path from "node:path";

import type { PanelWindowRequest, WorkspacePanel } from "../shared/types.js";
import { registerIpcHandlers } from "./ipc.js";

let mainWindow: BrowserWindowInstance | null = null;
const detachedPanelWindows = new Map<WorkspacePanel, BrowserWindowInstance>();

interface CreateWindowOptions {
  panel?: WorkspacePanel;
  fullscreen?: boolean;
  studyRoot?: string;
  stageId?: string;
}

const panelTitles: Record<WorkspacePanel, string> = {
  progress: "Study Progress",
  lesson: "Lesson Notes",
  studio: "Code Studio"
};

function createWindow(options: CreateWindowOptions = {}): BrowserWindowInstance {
  const panelSize = getPanelWindowSize(options.panel);
  const window = new BrowserWindow({
    width: panelSize.width,
    height: panelSize.height,
    minWidth: panelSize.minWidth,
    minHeight: panelSize.minHeight,
    fullscreen: options.fullscreen ?? false,
    title: options.panel ? `${panelTitles[options.panel]} - Local Learning Studio` : "Local Learning Studio",
    backgroundColor: "#f2eadf",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  attachWindowDiagnostics(window, options.panel);
  void loadApp(window, options);

  if (!options.panel) {
    mainWindow = window;
    window.on("closed", () => {
      mainWindow = null;
    });
  }

  return window;
}

function attachWindowDiagnostics(window: BrowserWindowInstance, panel?: WorkspacePanel): void {
  const label = panel ?? "main";
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    appendRuntimeLog(`[renderer:${label}] level=${level} ${sourceId}:${line} ${message}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    appendRuntimeLog(`[renderer:${label}] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    appendRuntimeLog(`[renderer:${label}] did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  window.on("unresponsive", () => {
    appendRuntimeLog(`[window:${label}] unresponsive`);
  });
}

function appendRuntimeLog(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  console.log(line.trimEnd());
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "runtime.log"), line, "utf8");
  } catch {
    // Logging should never affect the learning app itself.
  }
}

function getPanelWindowSize(panel?: WorkspacePanel): { width: number; height: number; minWidth: number; minHeight: number } {
  if (panel === "progress") return { width: 520, height: 860, minWidth: 420, minHeight: 640 };
  if (panel === "lesson") return { width: 920, height: 900, minWidth: 680, minHeight: 640 };
  if (panel === "studio") return { width: 1120, height: 920, minWidth: 820, minHeight: 680 };
  return { width: 1440, height: 900, minWidth: 1180, minHeight: 720 };
}

async function loadApp(window: BrowserWindowInstance, options: CreateWindowOptions): Promise<void> {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const url = new URL(devServerUrl);
    setWindowQueryParams(url.searchParams, options);
    await window.loadURL(url.toString());
    return;
  }

  const query = getWindowQuery(options);
  await window.loadFile(path.join(__dirname, "../../dist-renderer/index.html"), query ? { query } : undefined);
}

function setWindowQueryParams(searchParams: URLSearchParams, options: CreateWindowOptions): void {
  if (options.panel) searchParams.set("panel", options.panel);
  if (options.studyRoot) searchParams.set("studyRoot", options.studyRoot);
  if (options.stageId) searchParams.set("stageId", options.stageId);
}

function getWindowQuery(options: CreateWindowOptions): Record<string, string> | undefined {
  const query: Record<string, string> = {};
  if (options.panel) query.panel = options.panel;
  if (options.studyRoot) query.studyRoot = options.studyRoot;
  if (options.stageId) query.stageId = options.stageId;
  return Object.keys(query).length > 0 ? query : undefined;
}

function registerWindowHandlers(): void {
  ipcMain.handle("window:openPanelWindow", (_event, request: PanelWindowRequest) => {
    detachPanelWindow(request);
  });

  ipcMain.handle("window:dockPanelWindow", (_event, panel: WorkspacePanel) => {
    dockPanelWindow(panel);
  });

  ipcMain.handle("window:getDetachedPanels", () => {
    return getDetachedPanels();
  });

  ipcMain.handle("window:setCurrentWindowFullscreen", (event, fullscreen: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setFullScreen(fullscreen);
  });
}

function detachPanelWindow(request: PanelWindowRequest): void {
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

function dockPanelWindow(panel: WorkspacePanel): void {
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

function getDetachedPanels(): WorkspacePanel[] {
  return [...detachedPanelWindows.entries()]
    .filter(([, window]) => !window.isDestroyed())
    .map(([panel]) => panel);
}

function broadcastDetachedPanels(): void {
  const detachedPanels = getDetachedPanels();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("window:detachedPanelsChanged", detachedPanels);
    }
  }
}

void app.whenReady().then(() => {
  registerIpcHandlers();
  registerWindowHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
