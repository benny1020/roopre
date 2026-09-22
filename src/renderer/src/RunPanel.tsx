import EventLog from "./workspace/EventLog";
import ExecutionSetup, {
  type SetupDestination,
} from "./workspace/ExecutionSetup";
import { workflowIssues } from "../../shared/harness";
import ExecutionGraph from "./workspace/ExecutionGraph";
import ReviewEvidence from "./workspace/ReviewEvidence";
import { stageNames } from "../../shared/harness";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  FileCode2,
  PanelRight,
  Play,
  RefreshCw,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import type { Command, Feature, Snapshot } from "../../shared/contracts";
import { activeStatuses } from "../../shared/runtime";
import { runNames } from "./workspace/presentation";
import { Tabs, Empty, ResizeHandle } from "./workspace/Controls";
import DiffViewer from "./workspace/DiffViewer";
export { runNames } from "./workspace/presentation";

export default function RunPanel({
  snapshot,
  feature,
  send,
  connected = true,
  onDesign,
  onSetup,
}: {
  snapshot: Snapshot;
  feature: Feature;
  send: (c: Command) => Promise<unknown>;
  connected?: boolean;
  onDesign: () => void;
  onSetup: (destination: SetupDestination) => void;
}) {
  const runs = snapshot.runs
    .filter((r) => r.featureId === feature.id)
    .slice()
    .reverse();
  const current = runs[0];
  const [selected, setSelected] = useState(
    () => localStorage.getItem(`ade:run:${feature.id}`) || "",
  );
  const run = runs.find((r) => r.id === selected) || current;
  const runtime = run?.runtime;
  const gate = snapshot.gates[feature.id];
  const project = snapshot.projects.find((p) => p.id === feature.projectId)!;
  const planningConfigured =
    !!project.executionProfile &&
    !!project.workflow?.assignments.some(
      (a) => a.stage === "requirements" || a.stage === "design",
    ) &&
    !workflowIssues(snapshot, project).length;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("flow");
  const [inspector, setInspector] = useState(true);
  const [defaultOutput, setOutput] = useState(true);
  const [graphOutput, setGraphOutput] = useState(false);
  const [diffOutput, setDiffOutput] = useState(false);
  const output =
    tab === "flow"
      ? graphOutput
      : tab === "changes"
        ? diffOutput
        : defaultOutput;
  const [outputTab, setOutputTab] = useState("events");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState(600);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setAvailableHeight(entry.contentRect.height),
    );
    if (workspaceRef.current) observer.observe(workspaceRef.current);
    return () => observer.disconnect();
  }, []);
  const outputLimit = Math.max(
    120,
    Math.min(320, Math.floor(availableHeight * 0.35)),
  );
  const [height, setHeight] = useState(() => {
    const n = Number(localStorage.getItem("ade:output-height"));
    return n ? Math.max(120, Math.min(320, n)) : 180;
  });
  const [width, setWidth] = useState(() => {
    const n = Number(localStorage.getItem("ade:inspector-width"));
    return n ? Math.max(240, Math.min(360, n)) : 280;
  });
  useEffect(() => {
    localStorage.setItem("ade:output-height", String(height));
  }, [height]);
  useEffect(() => {
    localStorage.setItem("ade:inspector-width", String(width));
  }, [width]);
  const [diff, setDiff] = useState<{
    runId: string;
    patch: string;
    at: string;
  }>();
  const [diffLoading, setDiffLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    request.current++;
    setDiff(undefined);
    setDiffLoading(false);
    setError("");
  }, [run?.id]);
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
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
  const fetchDiff = async () => {
    if (!run || !window.roopre) return;
    const runId = run.id;
    const ticket = ++request.current;
    setDiffLoading(true);
    setError("");
    try {
      const patch = await window.roopre.runAction(runId, "diff");
      if (ticket === request.current)
        setDiff({ runId, patch, at: new Date().toLocaleTimeString() });
    } catch (e) {
      if (ticket === request.current) setError((e as Error).message);
    } finally {
      if (ticket === request.current) setDiffLoading(false);
    }
  };
  const working = runs.some(
    (r) =>
      activeStatuses.includes(r.status) ||
      r.runtime?.terminationConfirmed === false,
  );
  const attemptAgents =
    runtime?.agents?.filter((a) => a.attempt === runtime.attempt) || [];
  const liveAgent =
    run && activeStatuses.includes(run.status)
      ? attemptAgents.find((a) => a.status === "running")
      : undefined;
  const agent = liveAgent || attemptAgents.at(-1);
  const reviewers = attemptAgents.filter((a) => a.stage === "review");
  const pastReviewers =
    runtime?.agents?.filter(
      (a) => a.stage === "review" && a.attempt !== runtime.attempt,
    ) || [];
  const evidence =
    runtime?.evidence.filter((e) => e.attempt === runtime.attempt) || [];
  const history =
    runtime?.evidence.filter((e) => e.attempt !== runtime.attempt) || [];
  return (
    <div className="execution-workspace" ref={workspaceRef}>
      <div className="execution-toolbar">
        <label className="run-picker">
          실행
          <select
            aria-label="실행 선택"
            value={run?.id || ""}
            onChange={(e) => {
              setSelected(e.target.value);
              localStorage.setItem(`ade:run:${feature.id}`, e.target.value);
            }}
          >
            {!runs.length && <option value="">아직 실행 없음</option>}
            {runs.map((r, i) => (
              <option key={r.id} value={r.id}>
                {i === 0 ? "최신 · " : ""}
                {runNames[r.status]} · {r.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        {run && (
          <span className="run-attempt">
            시도 {runtime?.attempt ?? 1}
            {run.id !== current?.id && <strong> · 이전 실행</strong>}
          </span>
        )}
        <div className="button-row">
          {run && <button onClick={() => onSetup("profile")}>실행 설정</button>}
          <button
            className="secondary"
            title={
              !planningConfigured
                ? "실행 프로필과 요구사항 또는 설계 에이전트를 먼저 설정하세요."
                : "현재 저장된 초안을 기준으로 계획합니다."
            }
            disabled={!connected || busy || working || !planningConfigured}
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
            <Bot size={14} />
            요구사항·설계 에이전트 실행
          </button>
          <button
            className="primary"
            disabled={
              !connected ||
              busy ||
              !gate.eligible ||
              working ||
              runs.some((r) => ["blocked", "interrupted"].includes(r.status))
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
            <Play size={13} />
            개발 시작
          </button>
          {tab === "flow" &&
            current &&
            (!["cancelled", "ready_for_merge", "completed"].includes(
              current.status,
            ) ||
              current.runtime?.terminationConfirmed === false) && (
              <button
                disabled={!connected || busy}
                onClick={() =>
                  void act(() =>
                    send({ type: "cancel_run", runId: current.id }),
                  )
                }
              >
                <Square size={12} />
                최신 실행 취소
              </button>
            )}
          {tab === "flow" &&
            current &&
            ["failed", "interrupted"].includes(current.status) &&
            current.runtime?.kind !== "planning" && (
              <button
                disabled={
                  !connected ||
                  busy ||
                  current.runtime?.terminationConfirmed !== true
                }
                title={
                  current.runtime?.terminationConfirmed !== true
                    ? "이전 컨테이너 종료 확인 후 재시도할 수 있습니다."
                    : "보존한 변경으로 새 실행을 준비합니다."
                }
                onClick={() =>
                  void act(() => window.roopre!.runAction(current.id, "retry"))
                }
              >
                <RefreshCw size={12} />
                최신 변경 재시도
              </button>
            )}
          {tab !== "flow" && (
            <button
              className="icon-button"
              aria-label="에이전트 패널"
              title="에이전트 패널 표시"
              aria-pressed={inspector}
              onClick={() => setInspector(!inspector)}
            >
              <PanelRight size={16} />
            </button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {!gate.eligible && (
        <details className="execution-gate">
          <summary>설계 승인 조건 · {gate.reasons.length}개 확인 필요</summary>
          <ul>
            {gate.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <button onClick={onDesign}>설계 검토로 이동</button>
        </details>
      )}
      {!run ? (
        <ExecutionSetup
          snapshot={snapshot}
          feature={feature}
          onSetup={onSetup}
          onDesign={onDesign}
        />
      ) : (
        <>
          <div
            className={`execution-split ${inspector && tab !== "flow" ? "with-inspector" : ""}`}
            style={{ "--inspector-width": `${width}px` } as React.CSSProperties}
          >
            <section className="execution-center" aria-label="실행 작업 공간">
              <Tabs
                label="실행 결과"
                value={tab}
                onChange={setTab}
                items={[
                  { id: "flow", label: "흐름" },
                  { id: "changes", label: <>변경</> },
                  {
                    id: "checks",
                    label: (
                      <>
                        검증 <span>{evidence.length}</span>
                      </>
                    ),
                  },
                  { id: "review", label: "AI 리뷰" },
                  { id: "artifacts", label: "산출물" },
                ]}
              />
              <div
                className={`execution-surface ${tab === "flow" ? "is-flow" : ""}`}
              >
                {tab === "flow" && (
                  <ExecutionGraph
                    key={`${run.id}:${runtime?.attempt ?? 1}`}
                    run={run}
                    connected={connected}
                    onNavigate={setTab}
                  />
                )}
                {tab === "changes" && (
                  <>
                    <div className="surface-toolbar">
                      <span>
                        {diff?.runId === run.id
                          ? `작업 공간 diff · ${diff.at} 조회`
                          : "작업 공간의 변경 내용"}
                      </span>
                      <button
                        className="soft"
                        disabled={
                          !connected || diffLoading || !runtime?.worktree
                        }
                        onClick={() => void fetchDiff()}
                      >
                        <RefreshCw
                          size={13}
                          className={diffLoading ? "spin" : ""}
                        />
                        {diffLoading ? "불러오는 중…" : "변경 내용 보기"}
                      </button>
                    </div>
                    {diff?.runId === run.id ? (
                      <DiffViewer key={diff.runId} patch={diff.patch} />
                    ) : (
                      <Empty
                        title={
                          runtime?.worktree
                            ? "변경 내용을 확인하세요"
                            : "아직 작업 공간이 없습니다"
                        }
                      >
                        {runtime?.worktree
                          ? "현재 작업 공간에서 diff를 가져옵니다. 실행 중인 변경은 검증한 commit과 다를 수 있습니다."
                          : "격리된 작업 공간이 준비되면 변경 파일을 확인할 수 있습니다."}
                      </Empty>
                    )}
                  </>
                )}
                {tab === "checks" && (
                  <div className="evidence-list">
                    <div className="surface-toolbar">
                      <strong>SYSTEM · 고정 검사</strong>
                      <span>
                        현재 시도 {runtime?.attempt ?? 1} · 결과{" "}
                        {evidence.length}개
                      </span>
                    </div>
                    {runtime?.head && (
                      <p className="evidence-binding">
                        검증 commit <code>{runtime.head}</code>
                      </p>
                    )}
                    {!evidence.length && (
                      <Empty title="아직 검증 근거가 없습니다">
                        검사를 실행하면 종료 코드, 검사한 tree와 출력을 확인할
                        수 있습니다. 대기는 통과가 아닙니다.
                      </Empty>
                    )}
                    {evidence.map((e, i) => (
                      <details className={`check-result ${e.status}`} key={i}>
                        <summary>
                          {e.status === "passed" ? (
                            <Check size={15} />
                          ) : (
                            <XCircle size={15} />
                          )}
                          <strong>{e.name}</strong>
                          <span>{e.status === "passed" ? "통과" : "실패"}</span>
                          <code>tree {e.tree.slice(0, 8)}</code>
                        </summary>
                        <div className="evidence-binding">
                          종료 코드 {e.code} · {new Date(e.at).toLocaleString()}{" "}
                          · 시도 {e.attempt}
                          <br />
                          <code>{e.tree}</code>
                        </div>
                        <pre className="output-text">
                          {e.log || "출력 없음"}
                        </pre>
                      </details>
                    ))}
                    {runtime?.profile.checks.map((check) => (
                      <div className="check-command" key={check.name}>
                        <span>{check.name}</span>
                        <code>{check.argv.join(" ")}</code>
                        <small>{check.timeoutSeconds}s 제한</small>
                      </div>
                    ))}
                    {!!history.length && (
                      <details className="history-evidence">
                        <summary>
                          이전 시도 검사 {history.length}개 · 현재 시도의 통과
                          근거가 아닙니다
                        </summary>
                        {history.map((e, i) => (
                          <details key={i}>
                            <summary>
                              시도 {e.attempt} · {e.name} · {e.status} · tree{" "}
                              {e.tree.slice(0, 8)}
                            </summary>
                            <pre className="output-text">
                              {e.log || "출력 없음"}
                            </pre>
                          </details>
                        ))}
                      </details>
                    )}
                  </div>
                )}
                {tab === "review" && (
                  <div className="review-evidence">
                    <div className="surface-toolbar">
                      <strong>AGENT · 독립 리뷰</strong>
                      <span>최종 판단은 검증 근거와 함께</span>
                    </div>
                    {!reviewers.length && (
                      <Empty title="현재 시도의 AI 리뷰가 아직 없습니다">
                        구현과 검사가 끝나면 독립 리뷰의 결과와 근거를 확인할 수
                        있습니다. 이전 시도의 통과 의견은 현재 시도의 검증
                        근거가 아닙니다.
                      </Empty>
                    )}
                    {reviewers.map((a) => (
                      <details key={a.id} open>
                        <summary>
                          {a.name} v{a.revision} · 시도 {a.attempt} ·{" "}
                          {a.required ? "필수" : "선택"} ·{" "}
                          {a.status === "passed"
                            ? "통과"
                            : a.status === "failed"
                              ? "실패"
                              : "진행 중"}
                        </summary>
                        <div className="evidence-binding">
                          입력 tree <code>{a.inputTree}</code>
                          <br />
                          출력 tree <code>{a.outputTree || "기록 대기"}</code>
                        </div>
                        <ReviewEvidence
                          value={a.output || a.error || "출력 대기"}
                        />
                      </details>
                    ))}
                    {!!pastReviewers.length && (
                      <details className="review-history">
                        <summary>
                          이전 시도 AI 리뷰 {pastReviewers.length}개 · 현재 검증
                          근거가 아닙니다
                        </summary>
                        {pastReviewers.map((a) => (
                          <details key={a.id}>
                            <summary>
                              시도 {a.attempt} · {a.name} v{a.revision} ·{" "}
                              {a.required ? "필수" : "선택"} · {a.status}
                            </summary>
                            <div className="evidence-binding">
                              입력 tree <code>{a.inputTree}</code>
                              <br />
                              출력 tree{" "}
                              <code>{a.outputTree || "기록 없음"}</code>
                            </div>
                            <ReviewEvidence
                              value={a.output || a.error || "출력 없음"}
                            />
                          </details>
                        ))}
                      </details>
                    )}
                    {runtime?.review && (
                      <details className="review-original">
                        <summary>전체 리뷰 원문 · 이전 시도 포함 가능</summary>
                        <pre className="output-text">{runtime.review}</pre>
                      </details>
                    )}
                  </div>
                )}
                {tab === "artifacts" && (
                  <div className="artifact-list">
                    <div className="surface-toolbar">
                      <strong>실행 산출물</strong>
                      <span>무결성 검증 후 Finder에서 열기</span>
                    </div>
                    {!runtime?.artifacts?.length ? (
                      <Empty title="아직 저장된 산출물이 없습니다">
                        실행기가 수집한 보고서, 테스트 결과와 증거 파일이 여기에
                        표시됩니다.
                      </Empty>
                    ) : (
                      runtime.artifacts.map((file, i) => (
                        <button
                          key={file.path}
                          className="artifact-row"
                          disabled={!connected || busy}
                          onClick={() =>
                            void act(() =>
                              window.roopre!.revealArtifact(run.id, i),
                            )
                          }
                        >
                          <FileCode2 size={16} />
                          <span>
                            {file.path}
                            <small>
                              {file.bytes.toLocaleString()} bytes · 시도{" "}
                              {file.attempt}
                            </small>
                          </span>
                          <code>{file.hash.slice(0, 12)}</code>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </section>
            {inspector && tab !== "flow" && (
              <>
                <ResizeHandle
                  value={width}
                  onChange={setWidth}
                  min={240}
                  max={360}
                  label="에이전트 패널 너비"
                />
                <aside className="agent-inspector" aria-label="에이전트 상태">
                  <header>
                    <Bot size={15} />
                    <strong>에이전트</strong>
                    <span>{runtime?.agents?.length || 0}</span>
                  </header>
                  <div className="inspector-scroll">
                    <div className="actor-label">
                      {liveAgent
                        ? `AGENT · ${attemptAgents.filter((a) => a.status === "running").length}개 실행 중`
                        : "AGENT · 최근 활동"}
                    </div>
                    <h3>{agent?.name || "현재 시도 · 에이전트 대기"}</h3>
                    <p>
                      {run.reason ||
                        (agent
                          ? `${stageNames[agent.stage]} · ${agent.status === "running" ? "실행 중" : agent.status === "passed" ? "완료" : "실패"}`
                          : "실행기에서 작업을 시작하면 활동이 표시됩니다.")}
                    </p>
                    {agent?.error && (
                      <p className="failure-text">{agent.error}</p>
                    )}
                    <dl>
                      <dt>모델</dt>
                      <dd>{agent?.model || "실행 후 표시"}</dd>
                      <dt>최근 확인</dt>
                      <dd>
                        {runtime?.heartbeat
                          ? new Date(runtime.heartbeat).toLocaleTimeString()
                          : "대기"}
                      </dd>
                      <dt>추정 비용</dt>
                      <dd>
                        {runtime?.costReported
                          ? `$${runtime.costUsd.toFixed(4)}`
                          : "미확인"}{" "}
                        / ${runtime?.profile.budgetUsd ?? "—"}
                      </dd>
                    </dl>
                    <small className="muted">
                      CLI 추정값 · 확정 청구액 아님
                    </small>
                    {!!runtime?.agents?.length && (
                      <section>
                        <h4>단계별 작업</h4>
                        {runtime.agents.map((a) => (
                          <details className="agent-task" key={a.id}>
                            <summary>
                              <i className={`agent-dot ${a.status}`} />
                              <span>
                                {a.name}
                                <small>
                                  {stageNames[a.stage]} · v{a.revision} ·{" "}
                                  {a.required ? "필수" : "선택"}
                                  {" · "}
                                  {a.status === "running"
                                    ? "실행 중"
                                    : a.status === "passed"
                                      ? "완료"
                                      : "실패"}
                                </small>
                              </span>
                            </summary>
                            <p>
                              {a.model} · 시도 {a.attempt}
                            </p>
                            <p className="failure-text">{a.error}</p>
                            <details>
                              <summary>작업 결과</summary>
                              <pre className="output-text">
                                {a.output || "출력 대기"}
                              </pre>
                            </details>
                            <details>
                              <summary>실제 적용한 지침</summary>
                              <code>{a.instructionHash}</code>
                              <pre className="output-text">
                                {a.instructions}
                              </pre>
                            </details>
                            <p>
                              입력 tree <code>{a.inputTree}</code>
                            </p>
                            <p>
                              출력 tree <code>{a.outputTree || "대기"}</code>
                            </p>
                            {a.worktree && (
                              <p>
                                작업 공간 <code>{a.worktree}</code>
                              </p>
                            )}
                          </details>
                        ))}
                      </section>
                    )}
                    <section>
                      <h4>SYSTEM · 실행 계약</h4>
                      <dl>
                        <dt>설계</dt>
                        <dd>
                          <code>{runtime?.binding.slice(0, 12) || "대기"}</code>
                        </dd>
                        <dt>브랜치</dt>
                        <dd>{runtime?.branch || "대기"}</dd>
                        <dt>작업 공간</dt>
                        <dd>{runtime?.worktree || "준비 전"}</dd>
                      </dl>
                      <details>
                        <summary>실행 시점의 전체 지침</summary>
                        <pre className="output-text">
                          {run.effectivePolicy || "기록 없음"}
                        </pre>
                      </details>
                    </section>
                    {current && (
                      <section className="run-actions">
                        <h4>실행 제어 · 최신 작업</h4>
                        {["failed", "interrupted"].includes(current.status) &&
                          current.runtime?.kind !== "planning" && (
                            <button
                              disabled={
                                !connected ||
                                busy ||
                                current.runtime?.terminationConfirmed !== true
                              }
                              title={
                                current.runtime?.terminationConfirmed !== true
                                  ? "이전 컨테이너 종료 확인 후 재시도할 수 있습니다."
                                  : "보존한 변경으로 새 실행을 준비합니다."
                              }
                              onClick={() =>
                                void act(() =>
                                  window.roopre!.runAction(current.id, "retry"),
                                )
                              }
                            >
                              <RefreshCw size={13} />
                              변경을 이어서 재시도
                            </button>
                          )}
                        {(![
                          "cancelled",
                          "ready_for_merge",
                          "completed",
                        ].includes(current.status) ||
                          current.runtime?.terminationConfirmed === false) && (
                          <button
                            disabled={!connected || busy}
                            onClick={() =>
                              void act(() =>
                                send({ type: "cancel_run", runId: current.id }),
                              )
                            }
                          >
                            <Square size={12} />
                            실행 취소
                          </button>
                        )}
                        <p>
                          {current.status === "ready_for_merge"
                            ? "결과 검토 후 기존 병합 절차를 따르세요. 자동 병합하지 않습니다."
                            : "재시도·취소는 최신 실행에 적용됩니다."}
                        </p>
                      </section>
                    )}
                  </div>
                </aside>
              </>
            )}
          </div>
          {output && (
            <ResizeHandle
              horizontal
              value={Math.min(height, outputLimit)}
              onChange={setHeight}
              min={120}
              max={outputLimit}
              label="실행 출력 높이"
            />
          )}
          <section
            className={`execution-output ${output ? "expanded" : ""}`}
            style={
              {
                "--output-height": `${Math.min(height, outputLimit)}px`,
              } as React.CSSProperties
            }
            aria-label="실행 출력"
          >
            <header>
              <button
                className="soft"
                onClick={() =>
                  tab === "flow"
                    ? setGraphOutput(!graphOutput)
                    : tab === "changes"
                      ? setDiffOutput(!diffOutput)
                      : setOutput(!defaultOutput)
                }
                aria-expanded={output}
              >
                <Terminal size={14} />
                실행 출력{" "}
                {output ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>
              {output && (
                <Tabs
                  label="출력 종류"
                  value={outputTab}
                  onChange={setOutputTab}
                  items={[
                    { id: "events", label: "진행 기록" },
                    { id: "agent", label: "에이전트 결과" },
                  ]}
                />
              )}
              <span>
                {run.id.slice(0, 8)} · 시도 {runtime?.attempt ?? 1}
              </span>
            </header>
            {output &&
              (outputTab === "events" ? (
                <EventLog key={run.id} events={runtime?.events || []} />
              ) : (
                <div
                  className="output-scroll"
                  tabIndex={0}
                  aria-label="에이전트 결과"
                >
                  <pre className="output-text">
                    {agent?.output ||
                      agent?.error ||
                      "완료된 결과가 아직 없습니다. 실시간 내부 추론은 표시하지 않습니다."}
                  </pre>
                </div>
              ))}
          </section>
        </>
      )}
    </div>
  );
}
