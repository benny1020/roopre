import {
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import { z } from "zod";

const rectSchema = z.object({
  x: z.number().int().min(-100000).max(100000),
  y: z.number().int().min(-100000).max(100000),
  width: z.number().int().min(1024).max(20000),
  height: z.number().int().min(700).max(20000),
});
const stateSchema = z.object({
  version: z.literal(1),
  bounds: rectSchema,
  maximized: z.boolean(),
});
export type WindowState = z.infer<typeof stateSchema>;
type Rect = { x: number; y: number; width: number; height: number };

export function restoreWindowState(
  raw: unknown,
  workAreas: Rect[],
): WindowState {
  const saved = stateSchema.safeParse(raw);
  const primary = workAreas[0] || { x: 0, y: 0, width: 1440, height: 940 };
  const bounds = saved.success ? saved.data.bounds : undefined;
  const display =
    bounds &&
    workAreas.find(
      (area) =>
        bounds.x < area.x + area.width &&
        bounds.x + bounds.width > area.x &&
        bounds.y < area.y + area.height &&
        bounds.y + bounds.height > area.y,
    );
  const area = display || primary;
  const width = Math.max(1024, Math.min(bounds?.width ?? 1440, area.width));
  const height = Math.max(700, Math.min(bounds?.height ?? 940, area.height));
  // Keep the titlebar reachable after unplugging a display or changing its scale.
  const x = Math.max(
    area.x,
    Math.min(
      display ? bounds!.x : area.x + Math.floor((area.width - width) / 2),
      area.x + Math.max(0, area.width - width),
    ),
  );
  const y = Math.max(
    area.y,
    Math.min(
      display ? bounds!.y : area.y + Math.floor((area.height - height) / 2),
      area.y + Math.max(0, area.height - height),
    ),
  );
  return {
    version: 1,
    bounds: { x, y, width, height },
    maximized: saved.success && saved.data.maximized,
  };
}

export function readWindowState(path: string, workAreas: Rect[]) {
  let raw: unknown;
  try {
    if (statSync(path).size < 4096)
      raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* Invalid or absent UI preferences cannot block startup. */
  }
  return restoreWindowState(raw, workAreas);
}

export function rememberWindow(
  window: BrowserWindow,
  path: string,
  initial: WindowState,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = initial;
  let closing = false;
  const save = () => {
    clearTimeout(timer);
    if (
      closing ||
      window.isDestroyed() ||
      window.isFullScreen() ||
      window.isMinimized()
    )
      return;
    const state = stateSchema.safeParse({
      version: 1,
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
    });
    if (!state.success || JSON.stringify(state.data) === JSON.stringify(last))
      return;
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, JSON.stringify(state.data), { mode: 0o600 });
      renameSync(temporary, path);
      last = state.data;
    } catch {
      console.warn(
        "Window position could not be saved; existing settings were kept.",
      );
    } finally {
      try {
        rmSync(temporary, { force: true });
      } catch {
        /* Best effort for UI preferences. */
      }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    if (!closing) timer = setTimeout(save, 250);
  };
  window.on("move", schedule);
  window.on("resize", schedule);
  window.on("maximize", schedule);
  window.on("unmaximize", schedule);
  const freeze = () => {
    save();
    closing = true;
    clearTimeout(timer);
  };
  window.on("close", freeze);
  window.on("closed", () => clearTimeout(timer));
  return freeze;
}
