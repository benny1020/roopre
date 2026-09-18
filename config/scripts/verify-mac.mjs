import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { listPackage, extractFile } from "@electron/asar";
import { getCurrentFuseWire, FuseState } from "@electron/fuses";
import { fuses } from "../distribution/fuses.mjs";
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const app = resolve(
  process.argv[2] ??
    `release/${metadata.version}/루프리-darwin-arm64/루프리.app`,
);
const archive = join(app, "Contents/Resources/app.asar");
const files = listPackage(archive);
for (const required of [
  "/out/main/index.js",
  "/out/preload/index.cjs",
  "/out/renderer/index.html",
  "/resources/icon.png",
])
  assert(files.includes(required), `패키지 파일 누락: ${required}`);
for (const file of files) {
  assert(
    !/^\/(src|tests|artifacts|\.git|\.env|docs)(\/|$)/.test(file),
    `내부 파일 포함: ${file}`,
  );
  assert(
    !/\/(connections\.json|\.env(?:\.[^/]*)?)$/.test(file),
    "비밀 설정 파일 포함",
  );
}
const packaged = JSON.parse(extractFile(archive, "package.json").toString());
const main = extractFile(archive, "out/main/index.js").toString();
for (const sample of [
  "feature-checkout",
  "결제 실패 안내 개선",
  "민아 · 검토자",
  "Customer Portal",
  "first-project",
])
  assert(!main.includes(sample), `테스트 데이터가 앱에 포함됨: ${sample}`);
assert.equal(packaged.version, metadata.version);
assert.equal(packaged.scripts, undefined);
assert.equal(packaged.devDependencies, undefined);
for (const dependency of ["pg", "zod"]) {
  const actual = JSON.parse(
    extractFile(archive, `node_modules/${dependency}/package.json`).toString(),
  );
  assert.equal(
    actual.version,
    metadata.dependencies[dependency],
    `${dependency} 버전 불일치`,
  );
}
for (const resource of [
  "roopre-approve",
  "runner-proxy.cjs",
  "setup/README.md",
  "setup/compose.yaml",
  "setup/runner.Dockerfile",
  "setup/dependency-inventory.json",
  "setup/third-party-notices.txt",
])
  await access(join(app, "Contents/Resources", resource));
const wire = await getCurrentFuseWire(app);
for (const [key, value] of Object.entries(fuses))
  if (/^\d+$/.test(key))
    assert.equal(
      wire[key],
      value ? FuseState.ENABLE : FuseState.DISABLE,
      `Fuse ${key}`,
    );
execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
  stdio: "inherit",
});
console.log(
  "PASS: 패키지 파일·의존성 버전·비밀 파일 제외·보안 fuse·코드 서명 무결성 (Developer ID/공증 여부와는 별도)",
);
