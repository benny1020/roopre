import { useEffect, useState, useRef } from "react";
import type { Snapshot } from "../../shared/contracts";
import {
  standardSteps,
  type ConnectionInfo,
  type ExecutionProfile,
} from "../../shared/runtime";
const defaults = [
  {
    name: "typecheck",
    argv: ["pnpm", "run", "typecheck"],
    timeoutSeconds: 120,
  },
  { name: "test", argv: ["pnpm", "test"], timeoutSeconds: 300 },
  {
    name: "e2e",
    argv: ["pnpm", "exec", "playwright", "test"],
    timeoutSeconds: 600,
  },
];
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
  const [budget, setBudget] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [checks, setChecks] = useState(JSON.stringify(defaults, null, 2));
  const [web, setWeb] = useState(true);
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
  }, [projectId, JSON.stringify(project?.executionProfile)]);
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
                    image: "roopre-runner:0.2",
                    checks: JSON.parse(checks),
                    webRequired: web,
                    budgetUsd: Number(budget),
                    timeoutMinutes: minutes,
                    repairLimit: 2,
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
              <p className="muted">
                필수 typecheck·test와 선택한 e2e 명령이 통과해야 합니다. 별도 AI
                리뷰는 자동 적용됩니다. gateway의 실제 청구액은 추정 예산과 다를
                수 있습니다.
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
