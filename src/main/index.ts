import { installDesktop } from "./desktop";
import { app, BrowserWindow, session, shell } from "electron";
import { join, dirname } from "node:path";
import { APP_NAME, APP_ID } from "../shared/brand";
import { fileURLToPath } from "node:url";

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
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else void window.loadFile(join(here, "../renderer/index.html"));
}
if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(async () => {
  try {
    await installDesktop();
  } catch {
    const { dialog } = await import("electron");
    dialog.showErrorBox(
      "루프리 시작 실패",
      "실행 환경을 시작하지 못했습니다. Docker와 PostgreSQL(pnpm db:start)을 확인하세요. 이전 실행이 있었다면 컨테이너 종료 확인도 필요합니다.",
    );
    app.quit();
    return;
  }
  app.dock?.setIcon(iconPath);
  if (!process.env.ELECTRON_RENDERER_URL || app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src http://127.0.0.1:4318; object-src 'none'",
          ],
        },
      }),
    );
  }
  createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
