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
// Git quotes non-ASCII paths using UTF-8 octal bytes; decode only display labels.
// Never use a displayed path to read or execute anything on the host.
function displayPath(value: string) {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const escaped: Record<string, string> = {
    n: "\n",
    r: "\r",
    t: "\t",
    b: "\b",
    f: "\f",
    v: "\v",
    a: "\x07",
    '"': '"',
    "\\": "\\",
  };
  const raw = value.slice(1, -1);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\") {
      const octal = /^[0-7]{3}/.exec(raw.slice(i + 1));
      if (octal) {
        bytes.push(parseInt(octal[0], 8));
        i += 3;
        continue;
      }
      const next = escaped[raw[++i]];
      if (next === undefined) return value;
      bytes.push(...encoder.encode(next));
    } else {
      const character = String.fromCodePoint(raw.codePointAt(i)!);
      bytes.push(...encoder.encode(character));
      i += character.length - 1;
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(bytes),
    );
  } catch {
    return value;
  }
}
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
        id: text,
        path: text.startsWith("diff --git ") ? text.slice(11) : "변경 출력",
        lines: [],
        additions: 0,
        removals: 0,
      };
      files.push(file);
      inHunk = false;
    }
    if (!inHunk) {
      if (text.startsWith("--- ") && text !== "--- /dev/null")
        file.path = displayPath(text.slice(4)).replace(/^a\//, "");
      if (text.startsWith("+++ ") && text !== "+++ /dev/null")
        file.path = displayPath(text.slice(4)).replace(/^b\//, "");
      if (text.startsWith("rename to "))
        file.path = displayPath(text.slice(10));
      if (text.startsWith("copy to ")) file.path = displayPath(text.slice(8));
    }
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
