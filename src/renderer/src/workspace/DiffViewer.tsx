import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileCode2, Search, WrapText } from "lucide-react";
import { parseDiff } from "./diff";
import { Empty } from "./Controls";
export default function DiffViewer({ patch }: { patch: string }) {
  const files = useMemo(() => parseDiff(patch), [patch]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [wrap, setWrap] = useState(false);
  const [hunk, setHunk] = useState(-1);
  const scroll = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { top: number; left: number }>());
  const filtered = files.filter((f) =>
    f.path.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const current = filtered.find((f) => f.id === selected) || filtered[0];
  const hunks =
    current?.lines.flatMap((line, index) =>
      /^@@ /.test(line.text) && line.kind === "meta" ? [index] : [],
    ) || [];
  useEffect(() => {
    setHunk(-1);
    if (scroll.current) {
      const position = positions.current.get(current?.id || "");
      scroll.current.scrollTop = position?.top || 0;
      scroll.current.scrollLeft = position?.left || 0;
    }
  }, [current?.id, patch]);
  useEffect(() => {
    const live = new Set(files.map((f) => f.id));
    for (const id of positions.current.keys())
      if (!live.has(id)) positions.current.delete(id);
  }, [files]);
  const jump = (direction: -1 | 1) => {
    if (!hunks.length) return;
    const next =
      hunk < 0
        ? direction === 1
          ? 0
          : hunks.length - 1
        : (hunk + direction + hunks.length) % hunks.length;
    setHunk(next);
    const target = scroll.current?.querySelector<HTMLElement>(
      `[data-line="${hunks[next]}"]`,
    );
    if (scroll.current && target) {
      // Scroll only this pane, keeping the application chrome in place.
      scroll.current.scrollTop +=
        target.getBoundingClientRect().top -
        scroll.current.getBoundingClientRect().top;
      scroll.current.focus({ preventScroll: true });
    }
  };
  if (!files.length)
    return (
      <Empty title="No changes">
        No diff to display in the current workspace.
      </Empty>
    );
  return (
    <div className="diff-workspace">
      <nav className="diff-files" aria-label="Changed files">
        <div className="pane-label">
          Changed files{" "}
          <span>
            {filtered.length} / {files.length}
          </span>
        </div>
        <label className="diff-filter">
          <Search size={13} />
          <input
            aria-label="Search changed files"
            placeholder="Find a file…"
            value={query}
            maxLength={500}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {filtered.map((f) => (
          <button
            key={f.id}
            aria-current={f.id === current?.id ? "true" : undefined}
            title={f.path}
            onClick={() => setSelected(f.id)}
          >
            <FileCode2 size={14} />
            <span>{f.path}</span>
            <small className="ok">+{f.additions}</small>
            <small className="failure-text">−{f.removals}</small>
          </button>
        ))}
        {!filtered.length && <p className="quiet-empty">No matching files.</p>}
      </nav>
      <section className="diff-source" aria-label="File changes">
        {current ? (
          <>
            <header>
              <FileCode2 size={14} />
              <span title={current.path}>{current.path}</span>
              <small>Read-only</small>
            </header>
            <div className="diff-tools">
              <span>
                {hunks.length
                  ? `${hunk < 0 ? "—" : hunk + 1} / ${hunks.length} Change hunks`
                  : "File metadata"}
              </span>
              <button
                className="icon-button"
                aria-label="Previous hunk"
                title="Previous hunk"
                disabled={!hunks.length}
                onClick={() => jump(-1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                className="icon-button"
                aria-label="Next hunk"
                title="Next hunk"
                disabled={!hunks.length}
                onClick={() => jump(1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                className="icon-button"
                aria-label="Wrap diff lines"
                title="Wrap long lines"
                aria-pressed={wrap}
                onClick={() => setWrap(!wrap)}
              >
                <WrapText size={14} />
              </button>
            </div>
            <div
              ref={scroll}
              className={`diff-scroll ${wrap ? "wrapped" : ""}`}
              tabIndex={0}
              aria-label={`${current.path} diff`}
              onScroll={(e) =>
                positions.current.set(current.id, {
                  top: e.currentTarget.scrollTop,
                  left: e.currentTarget.scrollLeft,
                })
              }
            >
              <table className="diff-code">
                <tbody>
                  {current.lines.map((line, i) => (
                    <tr
                      key={i}
                      data-line={i}
                      className={`${line.kind} ${hunks[hunk] === i ? "current-hunk" : ""}`}
                    >
                      <td className="line-number" aria-hidden="true">
                        {line.old}
                      </td>
                      <td className="line-number" aria-hidden="true">
                        {line.next}
                      </td>
                      <td>
                        <pre>{line.text || " "}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Empty title="No search results">
            Try another filename or clear the search.
          </Empty>
        )}
      </section>
    </div>
  );
}
