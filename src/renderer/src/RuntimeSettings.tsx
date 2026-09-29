import { useEffect, useState, useRef } from "react";
import type { Snapshot } from "../../shared/contracts";
import {
  defaultChecksForRuntime,
  executionCapacityOf,
  runnerImageForRuntime,
  standardSteps,
  type ConnectionInfo,
  type ExecutionProfile,
  type ExecutionCapacity,
  type ProjectRuntime,
} from "../../shared/runtime";
import type {
  GitHostConnectionInfo,
  GitHostKind,
  GitRemote,
} from "../../shared/git-host";
const defaults = defaultChecksForRuntime("node");
export default function RuntimeSettings({
  snapshot,
  initialProjectId,
  onProjectChange,
  focusSection,
  onSaved,
}: {
  snapshot: Snapshot;
  initialProjectId?: string;
  onProjectChange?: (id: string) => void;
  focusSection?: "connection" | "profile";
  onSaved: () => Promise<unknown>;
}) {
  const desktop = window.roopre;
  const gitHostSupported = !!desktop?.gitHostConnections;
  const connectionSection = useRef<HTMLElement>(null);
  const profileSection = useRef<HTMLElement>(null);
  useEffect(() => {
    const section =
      focusSection === "connection"
        ? connectionSection.current
        : focusSection === "profile"
          ? profileSection.current
          : undefined;
    section?.scrollIntoView({ block: "start" });
    section?.focus({ preventScroll: true });
  }, [focusSection]);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [gitConnections, setGitConnections] = useState<GitHostConnectionInfo[]>(
    [],
  );
  const [name, setName] = useState("Claude Code");
  const [endpoint, setEndpoint] = useState("https://api.anthropic.com");
  const [auth, setAuth] = useState<"api-key" | "bearer">("api-key");
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState<string>();
  const [projectId, setProjectId] = useState(
    initialProjectId && snapshot.projects.some((p) => p.id === initialProjectId)
      ? initialProjectId
      : (snapshot.projects[0]?.id ?? ""),
  );
  const project = snapshot.projects.find((p) => p.id === projectId);
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("main");
  const [connectionId, setConnectionId] = useState("");
  const [remote, setRemote] = useState<GitRemote>();
  const [gitConnectionId, setGitConnectionId] = useState("");
  const [gitName, setGitName] = useState("GitHub");
  const [gitKind, setGitKind] = useState<GitHostKind>("github");
  const [gitHost, setGitHost] = useState("github.com");
  const [gitEndpoint, setGitEndpoint] = useState("https://api.github.com");
  const [gitToken, setGitToken] = useState("");
  const [budget, setBudget] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [checks, setChecks] = useState(JSON.stringify(defaults, null, 2));
  const [web, setWeb] = useState(true);
  const [runtime, setRuntime] = useState<ProjectRuntime>("node");
  const [capacity, setCapacity] = useState<ExecutionCapacity>(() =>
    executionCapacityOf(snapshot.executionCapacity),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState("");
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (desktop)
      void desktop
        .connections()
        .then(setConnections)
        .catch((e) => setError(e.message));
    if (desktop?.gitHostConnections)
      void desktop
        .gitHostConnections()
        .then(setGitConnections)
        .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const p = project?.executionProfile;
    setPath(p?.repositoryPath ?? "");
    setBranch(p?.baseBranch ?? "main");
    setConnectionId(p?.connectionId ?? "");
    setBudget(p ? String(p.budgetUsd) : "");
    setMinutes(p?.timeoutMinutes ?? 60);
    setChecks(JSON.stringify(p?.checks ?? defaults, null, 2));
    setWeb(p?.webRequired ?? true);
    setRuntime(p?.runtime ?? "node");
    setRemote(p?.gitHost?.remote);
    setGitConnectionId(p?.gitHost?.connectionId ?? "");
  }, [projectId, JSON.stringify(project?.executionProfile)]);
  useEffect(() => {
    setCapacity(executionCapacityOf(snapshot.executionCapacity));
  }, [JSON.stringify(snapshot.executionCapacity)]);
  return (
    <div className="content-page runtime-settings">
      <div className="page-heading">
        <div>
          <h1>표준 · 연결 · 실행 환경</h1>
          <p>같은 절차로 시작하고, 근거를 확인한 뒤 다음 단계로 진행합니다.</p>
        </div>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <details className="runtime-card runtime-standard">
        <summary>
          적용 중인 팀 표준 v{snapshot.policies.at(-1)!.version}
        </summary>
        <div className="standard-steps">
          {standardSteps.map((s) => (
            <div key={s.id}>
              <strong>{s.name}</strong>
              <p>{s.artifact}</p>
              <small>{s.gate}</small>
            </div>
          ))}
        </div>
        <p className="muted">
          필수 검사: {snapshot.policies.at(-1)!.requiredChecks.join(" · ")}.
          프로젝트 설정으로 삭제할 수 없습니다.
        </p>
      </details>
      {!desktop ? (
        <section className="runtime-card">
          <h2>맥 앱에서 연결하세요</h2>
          <p>
            API key 저장·저장소 선택·본인 승인은 macOS 앱에서 사용할 수
            있습니다. 이 브라우저는 로컬 개발 미리보기입니다.
          </p>
        </section>
      ) : (
        <>
          <section className="runtime-card execution-capacity-card">
            <div className="runtime-section-heading">
              <div>
                <h2>동시 실행 정책</h2>
                <p>
                  실행기 자원을 나누되, 같은 프로젝트의 기능도 독립 worktree로
                  함께 진행합니다.
                </p>
              </div>
              <span className="host-state">
                최대 {capacity.maxConcurrentRuns} 실행 · 프로젝트당{" "}
                {capacity.maxConcurrentRunsPerProject}
              </span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await desktop.command({
                    type: "configure_execution_capacity",
                    expectedRevision: snapshot.revision,
                    capacity,
                  });
                  await onSaved();
                  setMessage(
                    "동시 실행 정책을 저장했습니다. 진행 중인 실행은 유지하고 다음 실행부터 반영합니다.",
                  );
                });
              }}
            >
              <div className="runtime-grid">
                <label className="field">
                  전체 동시 실행
                  <input
                    type="number"
                    min="1"
                    max="6"
                    value={capacity.maxConcurrentRuns}
                    onChange={(e) => {
                      const maxConcurrentRuns = Number(e.target.value);
                      setCapacity((current) => ({
                        ...current,
                        maxConcurrentRuns,
                        maxConcurrentRunsPerProject: Math.min(
                          current.maxConcurrentRunsPerProject,
                          maxConcurrentRuns,
                        ),
                      }));
                    }}
                    required
                  />
                </label>
                <label className="field">
                  프로젝트당 동시 실행
                  <input
                    type="number"
                    min="1"
                    max={capacity.maxConcurrentRuns}
                    value={capacity.maxConcurrentRunsPerProject}
                    onChange={(e) =>
                      setCapacity((current) => ({
                        ...current,
                        maxConcurrentRunsPerProject: Number(e.target.value),
                      }))
                    }
                    required
                  />
                </label>
                <label className="field">
                  단계 안 병렬 에이전트
                  <input
                    type="number"
                    min="1"
                    max="4"
                    value={capacity.maxAgentsPerStage}
                    onChange={(e) =>
                      setCapacity((current) => ({
                        ...current,
                        maxAgentsPerStage: Number(e.target.value),
                      }))
                    }
                    required
                  />
                </label>
              </div>
              <button className="primary" disabled={busy}>
                동시 실행 정책 저장
              </button>
              <p className="muted">
                기본값은 전체 3개·프로젝트당 2개·단계당 3개입니다. 실행 수를
                낮춰도 이미 시작한 작업은 중단하지 않습니다. 메모리와 Docker
                상태를 보며 조절하세요.
              </p>
            </form>
          </section>
          <section
            className="runtime-card"
            ref={connectionSection}
            tabIndex={-1}
            aria-label="AI 연결 설정"
          >
            <h2>AI 연결</h2>
            <p>
              Claude Code · Anthropic Messages 규격. key는 이 맥의 암호화
              저장소에 보관합니다.
            </p>
            {connections.map((c) => (
              <div className="connection-row" key={c.id}>
                <div>
                  <strong>{c.name}</strong>
                  <small>
                    {c.model} · v{c.version} · {c.endpoint}
                  </small>
                  <small>{c.diagnostic ?? "연결 검사 전"}</small>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      setConnections(await desktop.testConnection(c.id));
                    })
                  }
                >
                  연결 검사
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setEditing(c.id);
                    setName(c.name);
                    setEndpoint(c.endpoint);
                    setAuth(c.auth);
                    setModel(c.model);
                    setKey("");
                  }}
                >
                  수정
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      setConnections(await desktop.removeConnection(c.id));
                      setMessage(
                        "연결을 삭제했습니다. 해당 연결의 실행은 중단됩니다.",
                      );
                    })
                  }
                >
                  삭제
                </button>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = {
                  id: editing,
                  name,
                  endpoint,
                  auth,
                  model,
                  key: key || undefined,
                };
                setKey("");
                void act(async () => {
                  setConnections(await desktop.saveConnection(input));
                  setEditing(undefined);
                  setMessage(
                    "연결을 저장했습니다. 연결 검사 후 실행 프로필을 지정하세요.",
                  );
                });
              }}
            >
              <div className="runtime-grid">
                <label className="field">
                  연결 이름
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  모델 ID
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  Endpoint
                  <input
                    type="url"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  인증 방식
                  <select
                    value={auth}
                    onChange={(e) => setAuth(e.target.value as typeof auth)}
                  >
                    <option value="api-key">API key · x-api-key</option>
                    <option value="bearer">Bearer token</option>
                  </select>
                </label>
                <label className="field">
                  {editing ? "새 key (유지하려면 비워 두기)" : "API key"}
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    required={!editing}
                  />
                </label>
              </div>
              <button className="primary" disabled={busy}>
                {editing ? "연결 변경 저장" : "연결 추가"}
              </button>
              <p className="muted">
                연결 검사는 소량의 실제 모델 요청으로 과금될 수 있습니다. 저장소
                코드는 보내지 않습니다.
              </p>
            </form>
          </section>
          <section
            className="runtime-card git-host-card"
            aria-label="Git host 연결 설정"
          >
            <div className="runtime-section-heading">
              <div>
                <h2>Git host</h2>
                <p>
                  원격 저장소의 provider API 연결입니다. access token은 이 맥의
                  암호화 저장소에만 보관합니다.
                </p>
              </div>
              {remote && (
                <span className="host-state">
                  {remote.kind === "github"
                    ? "GitHub"
                    : remote.kind === "gitlab"
                      ? "GitLab"
                      : "일반 Git"}{" "}
                  · {remote.host}
                </span>
              )}
            </div>
            {remote ? (
              <p className="git-remote-line">
                <code>
                  {remote.namespace}/{remote.repository}
                </code>{" "}
                · 실행은 worktree에서 격리됩니다. 원격 게시와 Draft PR/MR 생성은
                실행 성공 후 별도로 선택합니다.
              </p>
            ) : (
              <p className="muted">
                저장소 폴더를 선택하면 origin remote를 안전하게 감지합니다. 알
                수 없는 host도 로컬 Git 실행은 그대로 사용할 수 있습니다.
              </p>
            )}
            {!gitHostSupported && (
              <p className="muted">
                이 미리보기는 Git host 연결 API를 제공하지 않습니다. macOS
                앱에서 연결을 추가할 수 있습니다.
              </p>
            )}
            {gitConnections.map((connection) => (
              <div className="connection-row" key={connection.id}>
                <div>
                  <strong>{connection.name}</strong>
                  <small>
                    {connection.kind === "github" ? "GitHub" : "GitLab"} ·{" "}
                    {connection.host} · v{connection.version}
                  </small>
                  <small>{connection.diagnostic ?? "연결 검사 전"}</small>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () =>
                      setGitConnections(
                        await desktop.testGitHostConnection(connection.id),
                      ),
                    )
                  }
                >
                  연결 검사
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      setGitConnections(
                        await desktop.removeGitHostConnection(connection.id),
                      );
                      if (gitConnectionId === connection.id)
                        setGitConnectionId("");
                    })
                  }
                >
                  삭제
                </button>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!desktop.saveGitHostConnection) return;
                const input = {
                  name: gitName,
                  kind: gitKind,
                  host: gitHost,
                  endpoint: gitEndpoint,
                  token: gitToken,
                };
                setGitToken("");
                void act(async () => {
                  const next = await desktop.saveGitHostConnection(input);
                  setGitConnections(next);
                  setGitConnectionId(next.at(-1)?.id ?? "");
                  setMessage(
                    "Git host 연결을 저장했습니다. 연결 검사를 마친 뒤 프로젝트에 연결하세요.",
                  );
                });
              }}
            >
              <div className="runtime-grid">
                <label className="field">
                  연결 이름
                  <input
                    value={gitName}
                    onChange={(e) => setGitName(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  Provider
                  <select
                    value={gitKind}
                    onChange={(e) => {
                      const next = e.target.value as GitHostKind;
                      setGitKind(next);
                      setGitHost(
                        next === "github" ? "github.com" : "gitlab.com",
                      );
                      setGitEndpoint(
                        next === "github"
                          ? "https://api.github.com"
                          : "https://gitlab.com",
                      );
                    }}
                  >
                    <option value="github">GitHub / GitHub Enterprise</option>
                    <option value="gitlab">GitLab / 사내 GitLab</option>
                  </select>
                </label>
                <label className="field">
                  Web host
                  <input
                    value={gitHost}
                    onChange={(e) => setGitHost(e.target.value)}
                    placeholder="gitlab.company.example"
                    required
                  />
                </label>
                <label className="field">
                  API endpoint
                  <input
                    type="url"
                    value={gitEndpoint}
                    onChange={(e) => setGitEndpoint(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  Access token
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={gitToken}
                    onChange={(e) => setGitToken(e.target.value)}
                    required
                  />
                </label>
              </div>
              <button disabled={busy || !gitHostSupported}>
                Git host 연결 추가
              </button>
              <p className="muted">
                GitHub는 API endpoint를, GitLab은 instance 기본 URL을
                입력합니다. HTTP·인증서 우회·remote URL의 token은 허용하지
                않습니다.
              </p>
            </form>
          </section>
          <section
            className="runtime-card"
            ref={profileSection}
            tabIndex={-1}
            aria-label="프로젝트 실행 프로필 설정"
          >
            <h2>프로젝트 실행 프로필</h2>
            {!project && (
              <p className="muted">
                프로젝트를 먼저 만든 뒤 저장소와 실행 프로필을 연결하세요.
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  const profile: ExecutionProfile = {
                    repositoryPath: path,
                    baseBranch: branch,
                    baseCommit: "0".repeat(40),
                    connectionId,
                    connectionVersion: 1,
                    image: runnerImageForRuntime(runtime),
                    checks: JSON.parse(checks),
                    webRequired: web,
                    budgetUsd: Number(budget),
                    timeoutMinutes: minutes,
                    repairLimit: 2,
                    runtime,
                    ...(remote
                      ? {
                          gitHost: {
                            remote,
                            ...(gitConnectionId
                              ? { connectionId: gitConnectionId }
                              : {}),
                          },
                        }
                      : {}),
                  };
                  await desktop.configureProject(projectId, profile);
                  await onSaved();
                  setMessage(
                    "실행 프로필을 저장했습니다. 이 기준으로 설계를 게시하고 승인하세요.",
                  );
                });
              }}
            >
              <div className="runtime-grid">
                <label className="field">
                  프로젝트
                  <select
                    value={projectId}
                    onChange={(e) => {
                      setProjectId(e.target.value);
                      onProjectChange?.(e.target.value);
                    }}
                  >
                    {snapshot.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  모델 연결
                  <select
                    value={connectionId}
                    onChange={(e) => setConnectionId(e.target.value)}
                    required
                  >
                    <option value="">연결 선택</option>
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.model}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  저장소 폴더
                  <input value={path} readOnly required />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const r = await desktop.chooseRepository();
                        if (r) {
                          setPath(r.path);
                          setBranch(r.branch || "main");
                          setRuntime(r.runtime);
                          if (!project?.executionProfile) {
                            setChecks(
                              JSON.stringify(
                                defaultChecksForRuntime(r.runtime),
                                null,
                                2,
                              ),
                            );
                            setWeb(r.runtime === "node");
                          }
                          setRemote(r.remote);
                          if (!r.remote) setGitConnectionId("");
                        }
                      })
                    }
                  >
                    폴더 선택
                  </button>
                </label>
                <label className="field">
                  기준 브랜치
                  <input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  프로젝트 런타임
                  <select
                    value={runtime}
                    onChange={(e) =>
                      setRuntime(e.target.value as ProjectRuntime)
                    }
                  >
                    <option value="node">Node.js / 웹</option>
                    <option value="java-gradle">
                      Java · Gradle / Spring Boot
                    </option>
                  </select>
                </label>
                {remote && (
                  <label className="field">
                    Git host 연결
                    <select
                      value={gitConnectionId}
                      onChange={(e) => setGitConnectionId(e.target.value)}
                    >
                      <option value="">일반 Git만 사용</option>
                      {gitConnections
                        .filter(
                          (c) =>
                            c.host === remote.host &&
                            (!remote.kind || c.kind === remote.kind),
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ·{" "}
                            {c.testStatus === "passed" ? "검사됨" : "검사 필요"}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label className="field">
                  실행당 추정 예산 (USD)
                  <input
                    type="number"
                    min="0.1"
                    max="1000"
                    step="0.1"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  시간 한도 (분)
                  <input
                    type="number"
                    min="1"
                    max="240"
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={web}
                  onChange={(e) => setWeb(e.target.checked)}
                />
                웹 변경 · e2e 검사 필수
              </label>
              <label className="field">
                고정 검사 명령 (argv 배열 · 셸 해석 없음)
                <textarea
                  rows={10}
                  value={checks}
                  spellCheck={false}
                  onChange={(e) => setChecks(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setChecks(
                    JSON.stringify(defaultChecksForRuntime(runtime), null, 2),
                  );
                  if (runtime === "java-gradle") setWeb(false);
                }}
              >
                {runtime === "java-gradle"
                  ? "Gradle 기본 검사 적용"
                  : "Node 기본 검사 적용"}
              </button>
              <p className="muted">
                {runtime === "java-gradle"
                  ? "Java 21·Gradle 8 실행 환경에서 classes와 test를 고정 검사합니다. Spring Boot 통합 검사는 프로젝트의 test task에 포함하세요."
                  : "필수 typecheck·test와 선택한 e2e 명령이 통과해야 합니다."}{" "}
                별도 AI 리뷰는 자동 적용됩니다. gateway의 실제 청구액은 추정
                예산과 다를 수 있습니다.
              </p>
              <button
                className="primary"
                disabled={busy || !project || !path || !connectionId}
              >
                실행 프로필 저장
              </button>
            </form>
          </section>
          <section className="runtime-card">
            <h2>이 맥의 준비 상태</h2>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const d = await desktop.diagnostics();
                  setDiagnostic(
                    `Docker ${d.docker ? "준비됨" : "확인 필요"} · 실행 이미지 ${d.image ? "준비됨" : "pnpm runner:image 필요"} · 본인 확인 도구 ${d.approvalHelper ? "준비됨" : "설치 필요"}\n${d.message}`,
                  );
                })
              }
            >
              환경 검사
            </button>
            <p className="preserve">{diagnostic}</p>
          </section>
        </>
      )}
    </div>
  );
}
