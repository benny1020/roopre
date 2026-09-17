import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Format/size export only; the original artwork is resources/icon.png.
if (process.platform !== "darwin")
  throw new Error("ICNS export requires macOS sips/iconutil.");
const temporary = await mkdtemp(join(tmpdir(), "roopre-icons-"));
const iconset = join(temporary, "icon.iconset");
const { mkdir } = await import("node:fs/promises");
await mkdir(iconset);
try {
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = size * scale;
      execFileSync(
        "sips",
        [
          "-z",
          String(pixels),
          String(pixels),
          "resources/icon.png",
          "--out",
          join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
        ],
        { stdio: "ignore" },
      );
    }
  }
  execFileSync("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    resolve("resources/icon.icns"),
  ]);
  console.log("Exported resources/icon.icns (16–1024 px)");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
