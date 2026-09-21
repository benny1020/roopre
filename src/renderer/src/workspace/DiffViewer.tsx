import { useMemo, useState } from "react";
import { FileCode2 } from "lucide-react";
import { parseDiff } from "./diff";
import { Empty } from "./Controls";
export default function DiffViewer({ patch }: { patch: string }) {
  const files = useMemo(() => parseDiff(patch), [patch]);
  const [selected, setSelected] = useState("0");
  const current = files.find((f) => f.id === selected) || files[0];
  if (!current)
    return (
      <Empty title="변경 내용이 없습니다">
        현재 작업 공간에 표시할 diff가 없습니다.
      </Empty>
    );
  return (
    <div className="diff-workspace">
      <nav className="diff-files" aria-label="변경 파일">
        <div className="pane-label">
          변경 파일 <span>{files.length}</span>
        </div>
        {files.map((f) => (
          <button
            key={f.id}
            aria-current={f.id === current.id ? "true" : undefined}
            title={f.path}
            onClick={() => setSelected(f.id)}
          >
            <FileCode2 size={14} />
            <span>{f.path}</span>
            <small className="ok">+{f.additions}</small>
            <small className="failure-text">−{f.removals}</small>
          </button>
        ))}
      </nav>
      <section className="diff-source" aria-label="파일 변경 내용">
        <header>
          <FileCode2 size={14} />
          <span title={current.path}>{current.path}</span>
          <small>읽기 전용</small>
        </header>
        <div
          className="diff-scroll"
          tabIndex={0}
          aria-label={`${current.path} diff`}
        >
          <table className="diff-code">
            <tbody>
              {current.lines.map((line, i) => (
                <tr key={i} className={line.kind}>
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
      </section>
    </div>
  );
}
