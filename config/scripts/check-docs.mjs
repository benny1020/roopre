import { readFile, readdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
const files = ["README.md", "CONTRIBUTING.md", "AGENTS.md"];
for (const entry of await readdir("docs", { withFileTypes: true }))
  if (entry.isFile() && entry.name.endsWith(".md"))
    files.push(join("docs", entry.name));
for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    await access(join(dirname(file), decodeURIComponent(target)));
  }
}
const hash = createHash("sha256")
  .update(await readFile("docs/design/PRODUCT-DESIGN.md"))
  .digest("hex");
if (hash !== "31a7f8c0c2bf171f6432dc70973f5056e5d33f791c9030bb8b6d19055c228832")
  throw new Error(
    "Approved v0.1 snapshot changed. Keep it immutable and publish a new design version.",
  );
console.log(
  `PASS: ${files.length} current documentation files and approved design hash`,
);
