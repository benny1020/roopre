export type DiffLine = {
  text: string;
  kind: "add" | "remove" | "context" | "meta";
  old?: number;
  next?: number;
};
export type DiffFile = {
  id: string;
  path: string;
  lines: DiffLine[];
  additions: number;
  removals: number;
};
// Preserve Git's quoted paths and metadata verbatim, including binary/rename patches.
export function parseDiff(patch: string): DiffFile[] {
  if (!patch.trim()) return [];
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let old = 0,
    next = 0,
    inHunk = false;
  for (const text of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (text.startsWith("diff --git ") || !file) {
      file = {
        id: String(files.length),
        path: text.startsWith("diff --git ") ? text.slice(11) : "변경 출력",
        lines: [],
        additions: 0,
        removals: 0,
      };
      files.push(file);
      inHunk = false;
    }
    if (text.startsWith("+++ ") && text !== "+++ /dev/null")
      file.path = text.slice(4).replace(/^b\//, "");
    if (text.startsWith("--- ") && file.path.startsWith("a/"))
      file.path = text.slice(4).replace(/^a\//, "");
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      old = Number(hunk[1]);
      next = Number(hunk[2]);
      inHunk = true;
      file.lines.push({ text, kind: "meta" });
    } else if (inHunk && text.startsWith("+")) {
      file.additions++;
      file.lines.push({ text, kind: "add", next: next++ });
    } else if (inHunk && text.startsWith("-")) {
      file.removals++;
      file.lines.push({ text, kind: "remove", old: old++ });
    } else if (inHunk && text.startsWith(" "))
      file.lines.push({ text, kind: "context", old: old++, next: next++ });
    else file.lines.push({ text, kind: "meta" });
  }
  return files;
}
