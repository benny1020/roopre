import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
if (process.platform === "darwin") {
  mkdirSync("resources/bin", { recursive: true });
  execFileSync(
    "swiftc",
    ["resources/native/approve.swift", "-o", "resources/bin/roopre-approve"],
    { stdio: "inherit" },
  );
}
