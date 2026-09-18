import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { harnessPackageSchema } from "../../src/shared/harness-package.ts";
import {
  importPackageFolder,
  writePackageLock,
} from "../../src/main/harness/files.ts";
import { packageDigest } from "../../src/domain/harness-package.ts";
const [mode, path] = process.argv.slice(2);
if (mode === "schema") {
  const schema = z.toJSONSchema(harnessPackageSchema, {
    unrepresentable: "any",
  });
  await writeFile(
    resolve(path ?? "docs/specs/roopre.harness-v1.schema.json"),
    JSON.stringify(schema, null, 2) + "\n",
  );
  console.log(
    "JSON Schema 생성 완료. 참조·권한 등 교차 필드 검사는 harness:validate로 확인하세요.",
  );
} else if ((mode === "validate" || mode === "lock") && path) {
  const pack = await importPackageFolder(resolve(path), mode === "validate");
  if (mode === "lock") await writePackageLock(resolve(path), pack);
  console.log(
    `PASS ${pack.id}@${pack.version} ${packageDigest(pack)} · 에이전트 ${pack.agents.length} · 프로필 ${pack.profiles.length}`,
  );
} else
  throw Error(
    "사용법: pnpm harness:validate <폴더> / pnpm harness:lock <폴더>",
  );
