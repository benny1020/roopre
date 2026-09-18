import { useEffect, useState } from "react";
import App from "./App";
import HarnessPanel from "./HarnessPanel";
import type { BootstrapStatus } from "../../shared/onboarding";
import { onboardingSteps } from "../../shared/onboarding";
import { workflowIssues } from "../../shared/harness";
import type { Snapshot } from "../../shared/contracts";
import type { ConnectionInfo } from "../../shared/runtime";
import icon from "../../../resources/icon.png";
import "./style.css";
const titles = [
  "AI 연결",
  "환경 준비",
  "내 프로젝트",
  "개발 기준",
  "첫 요구사항",
];
export default function DesktopRoot() {
  const [status, setStatus] = useState<BootstrapStatus>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!window.roopre?.bootstrap) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await window.roopre!.bootstrap();
        if (live) {
          setStatus(s);
          setError("");
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) timer = setTimeout(() => void poll(), 1000);
      }
    };
    void poll();
    const reopen = () => {
      void window
        .roopre!.onboarding({
          version: 1,
          step: "connection",
          dismissed: false,
        })
        .then(setStatus)
        .catch((e) => setError(e.message));
    };
    window.addEventListener("roopre:onboarding", reopen);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener("roopre:onboarding", reopen);
    };
  }, []);
  if (!window.roopre?.bootstrap) return <App />;
  if (!status)
    return (
      <div className="onboarding-loading">
        <img src={icon} />
        <h1>루프리 시작 중</h1>
        <p role="status">{error || "저장된 설정을 확인합니다."}</p>
      </div>
    );
  if (status.connected && status.progress.dismissed) return <App />;
  return <Onboarding status={status} update={setStatus} />;
}
function Onboarding({
  status,
  update,
}: {
  status: BootstrapStatus;
  update: (s: BootstrapStatus) => void;
}) {
  const api = window.roopre!;
  const initial = status.progress.draft;
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [key, setKey] = useState("");
  const [endpoint, setEndpoint] = useState("https://api.anthropic.com");
  const [model, setModel] = useState(initial?.model ?? "claude-sonnet-4-6");
  const [connectionName, setConnectionName] = useState(
    initial?.connectionName ?? "Claude Code",
  );
  const [connectionId, setConnectionId] = useState(initial?.connectionId ?? "");
  const [auth, setAuth] = useState<"api-key" | "bearer">(
    initial?.auth ?? "api-key",
  );
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [path, setPath] = useState(initial?.path ?? "");
  const [branch, setBranch] = useState(initial?.branch ?? "main");
  const [budget, setBudget] = useState(initial?.budget ?? "1");
  const [projectInstructions, setProjectInstructions] = useState(
    initial?.projectInstructions ?? "",
  );
  const [checks, setChecks] = useState(
    initial?.checks ??
      JSON.stringify(
        [
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
        ],
        null,
        2,
      ),
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [requirements, setRequirements] = useState(initial?.requirements ?? "");
  const step =
    status.progress.dismissed && !status.connected
      ? "environment"
      : status.progress.step;
  const index = onboardingSteps.indexOf(step);
  const refresh = async () => {
    const list = await api.connections();
    setConnections(list);
    if (!connectionId && list[0]) setConnectionId(list[0].id);
    if (status.connected) {
      const w = await api.snapshot();
      setSnapshot(w);
    }
    return null;
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [status.connected]);
  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const draft = {
    connectionId,
    connectionName,
    model,
    auth,
    projectId,
    name,
    path,
    branch,
    budget,
    checks,
    projectInstructions,
    title,
    requirements,
  };
  const draftJson = JSON.stringify(draft);
  useEffect(() => {
    const timer = setTimeout(() => {
      void api
        .onboarding({ ...status.progress, draft })
        .catch((e) => setError(e.message));
    }, 500);
    return () => clearTimeout(timer);
  }, [draftJson, status.progress.step, status.progress.dismissed]);
  const advance = async (i: number) => {
    update(
      await api.onboarding({
        version: 1,
        step: onboardingSteps[i],
        draft,
        dismissed: false,
      }),
    );
  };
  const finish = async () => {
    update(
      await api.onboarding({
        version: 1,
        step: "requirements",
        draft,
        dismissed: true,
      }),
    );
  };
  const theme = (value: string) => {
    localStorage.setItem("theme", JSON.stringify(value));
    document.documentElement.dataset.theme =
      value === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : value;
  };
  return (
    <div className="onboarding-shell">
      <aside className="onboarding-rail">
        <div className="onboarding-brand">
          <img src={icon} alt="" />
          <strong>루프리</strong>
        </div>
        <h1>
          내 팀의 방식으로
          <br />
          개발을 시작하세요.
        </h1>
        <p>
          요구사항과 설계를 정리하고,
          <br />
          본인 승인 후 구현·검증을 진행합니다.
        </p>
        <ol>
          {titles.map((t, i) => (
            <li key={t} className={index === i ? "current" : ""}>
              <span>{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
        <small>
          입력한 설정은 다음 단계에서도 변경할 수 있습니다. API key는 암호화해서
          보관합니다.
        </small>
      </aside>
      <main className="onboarding-main">
        <header>
          <span>시작 가이드 · {index + 1} / 5</span>
          <select
            aria-label="시작 화면 테마"
            defaultValue={JSON.parse(
              localStorage.getItem("theme") || '"system"',
            )}
            onChange={(e) => theme(e.target.value)}
          >
            <option value="system">시스템 테마</option>
            <option value="light">라이트</option>
            <option value="dark">다크</option>
          </select>
        </header>
        <div className="onboarding-content">
          <h2>{titles[index]}</h2>
          {error && (
            <p role="alert" className="error-banner">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {step === "connection" && (
            <>
              <p>
                사용할 모델과 API 연결을 등록하세요. 현재 Anthropic Messages
                호환 endpoint를 지원합니다.
              </p>
              <div className="onboarding-form">
                <label className="field">
                  연결 이름
                  <input
                    value={connectionName}
                    onChange={(e) => setConnectionName(e.target.value)}
                  />
                </label>
                <label className="field">
                  Endpoint
                  <input
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                  />
                </label>
                <div className="runtime-grid">
                  <label className="field">
                    모델
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    인증 방식
                    <select
                      value={auth}
                      onChange={(e) => setAuth(e.target.value as typeof auth)}
                    >
                      <option value="api-key">API key</option>
                      <option value="bearer">Bearer</option>
                    </select>
                  </label>
                </div>
                <label className="field">
                  API key
                  <input
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
                </label>
                <button
                  className="primary"
                  disabled={busy || !key}
                  onClick={() =>
                    void act(async () => {
                      const list = await api.saveConnection({
                        name: connectionName,
                        endpoint,
                        model,
                        key,
                        auth,
                      });
                      setConnections(list);
                      setConnectionId(list.at(-1)!.id);
                      setKey("");
                      setNotice(
                        "연결을 저장했습니다. 실제 사용 전 연결 검사를 실행하세요.",
                      );
                    })
                  }
                >
                  연결 저장
                </button>
              </div>
              {connections.map((c) => (
                <div className="onboarding-check" key={c.id}>
                  <div>
                    <strong>{c.name}</strong>
                    <p>
                      {c.model} ·{" "}
                      {c.testStatus === "passed"
                        ? "연결 확인됨"
                        : c.testStatus === "failed"
                          ? "연결 검사 실패"
                          : "검사 전"}
                    </p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        setConnections(await api.testConnection(c.id));
                      })
                    }
                  >
                    연결 검사
                  </button>
                </div>
              ))}
              <p className="muted">
                연결 검사는 소량의 실제 모델 요청으로 과금될 수 있습니다.
                저장만으로는 요청을 보내지 않습니다.
              </p>
            </>
          )}
          {step === "environment" && (
            <>
              <p>
                Git과 Docker를 확인하고 루프리 전용 데이터베이스와 격리 실행
                이미지를 준비합니다.
              </p>
              <div className="onboarding-check">
                <div>
                  <strong>{status.stage}</strong>
                  <p>
                    {status.connected
                      ? "데이터베이스 연결됨"
                      : "데이터베이스 준비 필요"}{" "}
                    ·{" "}
                    {status.managed
                      ? "루프리 전용 환경"
                      : "기존 환경 유지 가능"}
                  </p>
                </div>
                {status.busy && <span role="status">준비 중…</span>}
              </div>
              {status.error && (
                <p className="error-banner" role="alert">
                  {status.error}
                </p>
              )}
              <p>
                처음 준비할 때 컨테이너 이미지를 다운로드하므로 시간이 걸릴 수
                있습니다. 기존 프로젝트와 DB 볼륨은 삭제하지 않습니다.
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy || status.busy}
                  onClick={() =>
                    void act(async () => {
                      update(await api.prepareEnvironment());
                    })
                  }
                >
                  환경 준비
                </button>
                {status.connected && !status.managed && (
                  <button
                    disabled={busy || status.busy}
                    onClick={() =>
                      void act(async () => {
                        update(await api.migrateEnvironment());
                      })
                    }
                  >
                    백업 후 전용 DB로 이전
                  </button>
                )}
                {status.busy && (
                  <button
                    onClick={() =>
                      void act(async () => {
                        update(await api.cancelEnvironment());
                      })
                    }
                  >
                    준비 중단
                  </button>
                )}
              </div>
              <p className="muted">
                Docker Desktop과 Git이 설치되어 실행 중이어야 합니다. 권한
                동의·설치는 사용자가 진행합니다. 환경을 준비한 뒤 다음으로
                이동하세요.
              </p>
            </>
          )}
          {step === "project" && (
            <>
              <p>
                실제 저장소를 연결하세요. 코드 변경과 패키지 설치는 아직
                실행하지 않습니다.
              </p>
              {!status.connected ? (
                <p>환경 준비를 먼저 완료하세요.</p>
              ) : (
                <>
                  <label className="field">
                    저장된 프로젝트
                    <select
                      value={projectId}
                      onChange={(e) => {
                        setProjectId(e.target.value);
                        const p = snapshot?.projects.find(
                          (p) => p.id === e.target.value,
                        );
                        setName(p?.name ?? "");
                        setPath(p?.executionProfile?.repositoryPath ?? "");
                        setBranch(p?.executionProfile?.baseBranch ?? "main");
                        setProjectInstructions(p?.instructions ?? "");
                        if (p?.executionProfile) {
                          setConnectionId(p.executionProfile.connectionId);
                          setBudget(String(p.executionProfile.budgetUsd));
                          setChecks(
                            JSON.stringify(p.executionProfile.checks, null, 2),
                          );
                        }
                      }}
                    >
                      <option value="">새 프로젝트</option>
                      {snapshot?.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    프로젝트 이름
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <div className="button-row">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const repo = await api.chooseRepository();
                          if (repo) {
                            setPath(repo.path);
                            setBranch(repo.branch || "main");
                            if (!name)
                              setName(repo.path.split("/").at(-1) ?? "");
                          }
                        })
                      }
                    >
                      저장소 폴더 선택
                    </button>
                    <span>{path || "선택한 저장소 없음"}</span>
                  </div>
                  <div className="runtime-grid">
                    <label className="field">
                      기준 브랜치
                      <input
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      프로젝트 AI 연결
                      <select
                        value={connectionId}
                        onChange={(e) => setConnectionId(e.target.value)}
                      >
                        <option value="">연결 선택</option>
                        {connections.map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name} · {c.model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      실행당 추정 예산 (USD)
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={budget}
                        onChange={(e) => setBudget(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="field">
                    필수 검사 명령 (JSON)
                    <textarea
                      value={checks}
                      onChange={(e) => setChecks(e.target.value)}
                    />
                  </label>
                  <p className="muted">
                    지원하는 Node 단일 패키지 저장소의 실제 명령에 맞게
                    수정하세요. e2e를 포함해 승인된 명령을 고정 실행합니다.
                  </p>
                  <label className="field">
                    프로젝트 Markdown 지침
                    <textarea
                      value={projectInstructions}
                      onChange={(e) => setProjectInstructions(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const text = await api.readMarkdown();
                        if (text !== null) setProjectInstructions(text);
                      })
                    }
                  >
                    지침 파일 가져오기
                  </button>
                  <p className="muted">
                    가져온 문서는 이 프로젝트에만 적용됩니다. 파일의 명령이나
                    hooks를 자동 실행하지 않습니다.
                  </p>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !path ||
                      !connectionId ||
                      (!projectId && !name.trim())
                    }
                    onClick={() =>
                      void act(async () => {
                        const parsed = JSON.parse(checks);
                        let id = projectId;
                        if (!id) {
                          const result = await api.command({
                            type: "create_project",
                            name,
                            description: "",
                            reviewerIds: ["owner"],
                          });
                          id = result.entityId!;
                          setProjectId(id);
                        }
                        await api.configureProject(id, {
                          repositoryPath: path,
                          baseBranch: branch,
                          baseCommit: "0".repeat(40),
                          connectionId,
                          connectionVersion: 1,
                          image: "roopre-runner:0.2",
                          checks: parsed,
                          webRequired: true,
                          budgetUsd: Number(budget),
                          timeoutMinutes: 60,
                          repairLimit: 1,
                        });
                        await api.command({
                          type: "update_project_policy",
                          projectId: id,
                          instructions: projectInstructions,
                          requiredChecks: ["typecheck", "test", "review"],
                          reviewerIds: ["owner"],
                        });
                        setNotice("프로젝트와 실행 기준을 저장했습니다.");
                      })
                    }
                  >
                    프로젝트 연결 저장
                  </button>
                </>
              )}
            </>
          )}
          {step === "harness" && (
            <>
              {snapshot ? (
                <HarnessPanel
                  snapshot={snapshot}
                  send={api.command}
                  onSaved={refresh}
                />
              ) : (
                <p>환경 준비와 프로젝트 등록을 먼저 완료하세요.</p>
              )}
            </>
          )}
          {step === "requirements" && (
            <>
              <section className="settings-card" aria-label="시작 체크리스트">
                <h3>실제 작업 기록</h3>
                <p className="muted">
                  저장된 설정과 작업으로 집계합니다. 과거 완료 기록이 현재 실행
                  승인을 대신하지 않습니다.
                </p>
                <ul>
                  {[
                    [
                      "모델 연결 검사",
                      connections.some((c) => c.testStatus === "passed"),
                    ],
                    [
                      "프로젝트 실행 설정",
                      snapshot?.projects.some((p) => !!p.executionProfile),
                    ],
                    [
                      "단계별 개발 기준",
                      snapshot?.projects.some(
                        (p) =>
                          p.workflow &&
                          workflowIssues(snapshot, p).length === 0,
                      ),
                    ],
                    [
                      "첫 설계 게시",
                      snapshot?.features.some((f) => f.designs.length > 0),
                    ],
                    [
                      "본인 설계 승인 기록",
                      snapshot?.features.some((f) =>
                        f.designs.some((d) =>
                          d.decisions.some((r) => r.decision === "approve"),
                        ),
                      ),
                    ],
                    [
                      "검사·리뷰 완료",
                      snapshot?.runs.some(
                        (r) => r.status === "ready_for_merge",
                      ),
                    ],
                  ].map(([label, done]) => (
                    <li key={String(label)}>
                      {done ? "✓" : "○"} {label}
                    </li>
                  ))}
                </ul>
              </section>
              <p>
                첫 기능의 목표와 완료 기준을 작성하세요. 모델 실행과 설계 승인은
                다음 화면에서 별도로 진행합니다.
              </p>
              <label className="field">
                첫 기능 프로젝트
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">프로젝트 선택</option>
                  {snapshot?.projects.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                기능 이름
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="field">
                요구사항과 완료 기준
                <textarea
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder="해결할 문제와 AC01, AC02처럼 확인 가능한 완료 기준을 작성하세요."
                />
              </label>
              <button
                className="primary"
                disabled={
                  busy || !projectId || !title.trim() || !requirements.trim()
                }
                onClick={() =>
                  void act(async () => {
                    const r = await api.command({
                      type: "create_feature",
                      projectId,
                      title,
                      requirements,
                      template: "feature",
                    });
                    localStorage.setItem(
                      "owner:selected",
                      JSON.stringify(r.entityId),
                    );
                    await finish();
                  })
                }
              >
                첫 요구사항 만들기
              </button>
              <p className="muted">
                가상 프로젝트나 실행 결과는 생성하지 않습니다. 설정하지 않은
                항목은 앱의 시작 가이드에서 이어서 완료할 수 있습니다.
              </p>
            </>
          )}
        </div>
        <footer>
          <button
            disabled={busy || status.busy || index === 0}
            onClick={() => void act(() => advance(index - 1))}
          >
            뒤로
          </button>
          <div className="button-row">
            <button
              disabled={busy || status.busy || !status.connected}
              onClick={() => void act(finish)}
            >
              나중에 · 앱 열기
            </button>
            {index < 4 ? (
              <button
                className="primary"
                disabled={busy || status.busy}
                onClick={() => void act(() => advance(index + 1))}
              >
                다음
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || !status.connected}
                onClick={() => void act(finish)}
              >
                앱 열기
              </button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
