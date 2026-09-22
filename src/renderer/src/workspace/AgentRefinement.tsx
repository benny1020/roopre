import { useEffect, useRef, useState } from "react";
import type { ConnectionInfo } from "../../../shared/runtime";
import type { RefinementOutput } from "../../../shared/agent-refinement";
import type { Stage } from "./WorkflowGraph";
import MarkdownPreview from "../MarkdownPreview";
export default function AgentRefinement({
  stage,
  connections,
  onApply,
}: {
  stage: Stage;
  connections: ConnectionInfo[];
  onApply: (draft: RefinementOutput) => void;
}) {
  const [brief, setBrief] = useState("");
  const [connection, setConnection] = useState(connections[0]?.id ?? "");
  const [result, setResult] = useState<RefinementOutput>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <details className="agent-refinement">
      <summary>간단히 적고 AI로 구체화</summary>
      <label className="field">
        원하는 역할
        <textarea
          maxLength={6000}
          placeholder="예: 접근성과 작은 화면에서 깨지는 UI를 검사해줘"
          value={brief}
          disabled={busy}
          onChange={(e) => {
            setBrief(e.target.value);
            setResult(undefined);
          }}
        />
      </label>
      <label className="field">
        초안을 만들 AI 연결
        <select
          value={connection}
          disabled={busy}
          onChange={(e) => setConnection(e.target.value)}
        >
          <option value="">연결 선택</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.model}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        입력한 역할과 단계만 선택한 AI 연결에 전송합니다. 모델 사용 비용이
        발생할 수 있습니다. 결과는 검토 후 편집기에 적용하며 자동 저장하지
        않습니다.
      </p>
      {!connections.length && (
        <p>설정의 AI 연결에서 API key와 endpoint를 먼저 등록하세요.</p>
      )}
      <button
        disabled={
          busy ||
          brief.trim().length < 3 ||
          !connection ||
          !window.roopre?.refineAgent
        }
        onClick={async () => {
          setBusy(true);
          setError("");
          setResult(undefined);
          try {
            const draft = await window.roopre!.refineAgent({
              connectionId: connection,
              stage,
              brief,
            });
            if (mounted.current) setResult(draft);
          } catch (e) {
            if (mounted.current) setError((e as Error).message);
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
      >
        {busy ? "AI 초안 작성 중…" : "AI로 구체화"}
      </button>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {result && (
        <section aria-label="AI 에이전트 제안">
          <h3>{result.name}</h3>
          <p>{result.description}</p>
          <MarkdownPreview text={result.markdown} />
          <p className="muted">
            적용하면 현재 이름·설명·Markdown을 이 제안으로 바꿉니다. 권한·공유
            범위·연결 설정은 유지합니다.
          </p>
          <div className="button-row">
            <button
              onClick={() => {
                onApply(result);
                setResult(undefined);
              }}
            >
              제안을 편집기에 적용
            </button>
            <button onClick={() => setResult(undefined)}>제안 버리기</button>
          </div>
        </section>
      )}
    </details>
  );
}
