import { stageNames } from "../../shared/harness";
import { useState } from "react";
import type { Command, Feature, Snapshot } from "../../shared/contracts";
import { activeStatuses } from "../../shared/runtime";
export const runNames: Record<string, string> = {
  completed: "초안 작성 완료",
  queued: "실행 대기",
  preparing: "환경 준비",
  implementing: "구현 중",
  verifying: "검증 중",
  reviewing: "AI 리뷰",
  repairing: "수정 중",
  ready_for_merge: "결과 확인",
  interrupted: "중단됨",
  failed: "실패",
  cancelled: "취소됨",
  blocked: "승인 확인 필요",
};
export default function RunPanel({
  snapshot,
  feature,
  send,
}: {
  snapshot: Snapshot;
  feature: Feature;
  send: (c: Command) => Promise<unknown>;
}) {
  const runs = snapshot.runs
    .filter((r) => r.featureId === feature.id)
    .slice()
    .reverse();
  const current = runs[0];
  const gate = snapshot.gates[feature.id];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [diff, setDiff] = useState("");
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="content-page">
      <h2>개발 실행과 검증 결과</h2>
      <p>
        승인된 계약 안에서 구현·검사·별도 리뷰를 진행합니다. 자동 병합·배포하지
        않습니다.
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {!gate.eligible && (
        <ul>
          {gate.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div className="button-row">
        <button
          disabled={
            busy ||
            runs.some(
              (r) =>
                activeStatuses.includes(r.status) ||
                r.runtime?.terminationConfirmed === false,
            ) ||
            !snapshot.projects.find((p) => p.id === feature.projectId)?.workflow
          }
          onClick={() =>
            void act(() =>
              send({
                type: "queue_planning",
                featureId: feature.id,
                expectedRevision: feature.draft.revision,
              }),
            )
          }
        >
          요구사항·설계 에이전트 실행
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            !gate.eligible ||
            runs.some(
              (r) =>
                activeStatuses.includes(r.status) ||
                r.status === "blocked" ||
                r.status === "interrupted" ||
                r.runtime?.terminationConfirmed === false,
            )
          }
          onClick={() =>
            void act(() =>
              send({
                type: "queue_run",
                featureId: feature.id,
                designId: feature.designs.at(-1)!.id,
              }),
            )
          }
        >
          개발 시작
        </button>
        {current && ["failed", "interrupted"].includes(current.status) && (
          <button
            disabled={busy}
            onClick={() =>
              void act(() => window.roopre!.runAction(current.id, "retry"))
            }
          >
            변경을 이어서 재시도
          </button>
        )}
        {current &&
          !["cancelled", "ready_for_merge"].includes(current.status) && (
            <button
              disabled={busy}
              onClick={() =>
                void act(() => send({ type: "cancel_run", runId: current.id }))
              }
            >
              실행 취소
            </button>
          )}
      </div>
      {runs.length === 0 && (
        <div className="result-placeholder">
          <h3>실행 전입니다</h3>
          <p>연결·환경을 설정하고 설계를 본인 승인한 뒤 시작하세요.</p>
        </div>
      )}
      {runs.map((run) => (
        <section className="runtime-card" key={run.id}>
          <h3>
            {runNames[run.status]} <small>{run.id}</small>
          </h3>
          <p>{run.reason}</p>
          {run.runtime && (
            <>
              <div className="runtime-grid">
                <span>
                  시도 {run.runtime.attempt} /{" "}
                  {run.runtime.profile.repairLimit + 1}
                </span>
                <span>
                  추정 비용 $
                  {run.runtime.costReported
                    ? run.runtime.costUsd.toFixed(4)
                    : "미확인"}{" "}
                  / ${run.runtime.profile.budgetUsd}
                </span>
                <span>
                  최근 확인{" "}
                  {run.runtime.heartbeat
                    ? new Date(run.runtime.heartbeat).toLocaleTimeString()
                    : "대기"}
                </span>
                <span>설계 계약 {run.runtime.binding.slice(0, 12)}</span>
              </div>
              <p className="muted">
                비용은 CLI 추정값이며 확정 청구액이 아닙니다.
              </p>
              {run.runtime.head && (
                <p>
                  검증한 commit: <code>{run.runtime.head}</code>
                </p>
              )}
              {run.runtime.worktree && (
                <>
                  <p className="muted">작업 경로: {run.runtime.worktree}</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () =>
                        setDiff(await window.roopre!.runAction(run.id, "diff")),
                      )
                    }
                  >
                    변경 내용 보기
                  </button>
                </>
              )}
              {run.runtime.artifacts?.map((file, index) => (
                <div key={file.path}>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        window.roopre!.revealArtifact(run.id, index),
                      )
                    }
                  >
                    산출물: {file.path}
                  </button>
                  <small>
                    {" "}
                    {file.bytes} bytes · {file.hash.slice(0, 8)}
                  </small>
                </div>
              ))}
              {run.runtime.evidence.map((e, i) => (
                <details key={i}>
                  <summary>
                    {e.status === "passed" ? "통과" : "실패"} · {e.name} · 시도{" "}
                    {e.attempt} · tree {e.tree.slice(0, 8)}
                  </summary>
                  <pre className="policy-text">{e.log || "출력 없음"}</pre>
                </details>
              ))}
              {run.runtime.agents?.map((a) => (
                <details className="agent-result" key={a.id}>
                  <summary>
                    {stageNames[a.stage]} · {a.name} v{a.revision} ·{" "}
                    {a.required ? "필수" : "선택"} ·{" "}
                    {a.status === "running"
                      ? "실행 중"
                      : a.status === "passed"
                        ? "통과"
                        : "실패"}
                  </summary>
                  <p>
                    {a.model} · 시도 {a.attempt} · 지침{" "}
                    {a.instructionHash.slice(0, 12)}
                  </p>
                  <p>
                    입력 tree {a.inputTree} · 출력 tree {a.outputTree ?? "대기"}
                  </p>
                  {a.error && <p role="alert">{a.error}</p>}
                  <pre className="policy-text">{a.output}</pre>
                  <details>
                    <summary>실제 적용한 지침</summary>
                    <pre className="policy-text">{a.instructions}</pre>
                  </details>
                </details>
              ))}
              {run.runtime.review && (
                <details>
                  <summary>별도 AI 검토 근거</summary>
                  <pre className="policy-text">{run.runtime.review}</pre>
                </details>
              )}
              <details>
                <summary>진행 기록</summary>
                <ol>
                  {run.runtime.events.map((e, i) => (
                    <li key={i}>
                      {new Date(e.at).toLocaleTimeString()} · {e.message}
                    </li>
                  ))}
                </ol>
              </details>
            </>
          )}
        </section>
      ))}
      {diff && (
        <section>
          <h3>변경 내용</h3>
          <pre className="policy-text">{diff}</pre>
        </section>
      )}
    </div>
  );
}
