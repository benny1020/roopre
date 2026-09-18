import { readFile, readdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
const files = [
  "README.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "docs/design/V02-APPROVAL.md",
  "docs/design/HARNESS-V03.md",
  "docs/design/EXTERNAL-BETA-DESIGN.md",
];
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
const approved = {
  "PRODUCT-DESIGN.md":
    "31a7f8c0c2bf171f6432dc70973f5056e5d33f791c9030bb8b6d19055c228832",
  "PRODUCT-DESIGN-v0.2.md":
    "f848a6f15fb6c987f16d5c581858545cd770c3459061d3f6a2e300911878254b",
  "TEAM-STANDARD-ADDENDUM.md":
    "7c4f9cd55b338063b82f0a65807d7dadc467873468ff282cf1da4d4b15b3ec62",
};
for (const [file, expected] of Object.entries(approved)) {
  const hash = createHash("sha256")
    .update(await readFile(join("docs/design", file)))
    .digest("hex");
  if (hash !== expected)
    throw new Error(
      `Approved snapshot ${file} changed. Publish a new design version instead.`,
    );
}
console.log(
  `PASS: ${files.length} current documentation files and ${Object.keys(approved).length} approved design hashes`,
);
