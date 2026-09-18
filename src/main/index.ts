import { installDesktop } from "./desktop";
import { app, BrowserWindow, session, shell, dialog } from "electron";
import { join, dirname } from "node:path";
import { APP_NAME, APP_ID } from "../shared/brand";
import { fileURLToPath } from "node:url";
import { productionCsp } from "./security";

// Keep existing local drafts/settings when the display name changes.
app.setPath("userData", join(app.getPath("appData"), APP_ID));
app.setName(APP_NAME);
const iconPath = join(app.getAppPath(), "resources/icon.png");

const here = dirname(fileURLToPath(import.meta.url));
function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    icon: iconPath,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: "#F6F7F9",
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("render-process-gone", async (_event, details) => {
    if (details.reason === "clean-exit" || window.isDestroyed()) return;
    const { response } = await dialog.showMessageBox(window, {
      type: "error",
      message: "앱 화면을 다시 열어야 합니다.",
      detail:
        "저장된 설계와 실행 기록은 유지됩니다. 화면만 다시 불러옵니다. 저장하지 않은 입력은 복구되지 않을 수 있습니다.",
      buttons: ["화면 다시 열기", "닫기"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0 && !window.isDestroyed()) window.reload();
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else void window.loadFile(join(here, "../renderer/index.html"));
}
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
else
  app.whenReady().then(async () => {
    let started = false;
    while (!started) {
      try {
        await installDesktop();
        started = true;
      } catch (error) {
        const { response } = await dialog.showMessageBox({
          type: "warning",
          message: "루프리 실행 환경을 확인해 주세요",
          detail:
            error instanceof Error
              ? error.message
              : "실행 환경을 시작하지 못했습니다.",
          buttons: ["다시 연결", "설치 안내 열기", "종료"],
          defaultId: 0,
          cancelId: 2,
        });
        if (response === 2) {
          app.quit();
          return;
        }
        if (response === 1) {
          const result = await shell.openPath(
            app.isPackaged
              ? join(process.resourcesPath, "setup")
              : join(app.getAppPath(), "resources/setup"),
          );
          if (result)
            dialog.showErrorBox(
              "설치 안내",
              "설치 안내 폴더를 열지 못했습니다. 앱을 다시 설치하거나 저장소의 docs/DISTRIBUTION.md를 확인하세요.",
            );
        }
      }
    }
    app.dock?.setIcon(iconPath);
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on("will-download", (event) =>
      event.preventDefault(),
    );
    if (!process.env.ELECTRON_RENDERER_URL || app.isPackaged) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [productionCsp],
          },
        }),
      );
    }
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
