import RuntimeSettings from "./RuntimeSettings";
import RunPanel, { runNames } from "./RunPanel";
import RunOverview from "./RunOverview";
import { activeStatuses } from "../../shared/runtime";
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  FileText,
  Folder,
  GitBranch,
  Inbox,
  ListFilter,
  MessageSquare,
  Moon,
  PanelLeft,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  Terminal,
  X,
  AlertCircle,
  LoaderCircle,
  WifiOff,
} from "lucide-react";
import {
  gate,
  latestDesign,
  sections,
  type Snapshot,
  type Feature,
  type Command,
  type Design,
  type Thread,
} from "../../shared/contracts.ts";
import "./style.css";
import appIcon from "../../../resources/icon.png";
import { APP_NAME } from "../../shared/brand";

const API = "http://127.0.0.1:4318";
const localKey = (key: string) =>
  (window.roopre && key !== "theme" ? "owner:" : "") + key;
const readLocal = <T,>(key: string, fallback: T): T => {
  try {
    return (
      JSON.parse(localStorage.getItem(localKey(key)) || "null") ?? fallback
    );
  } catch {
    return fallback;
  }
};
const saveLocal = (key: string, value: unknown) =>
  localStorage.setItem(localKey(key), JSON.stringify(value));
const labels = {
  draft: "설계 초안",
  in_review: "설계 리뷰",
  changes_requested: "수정 요청",
  approved: "설계 승인",
};
const ago = (date: string) => {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
  return m < 1
    ? "방금 전"
    : m < 60
      ? `${m}분 전`
      : `${Math.floor(m / 60)}시간 전`;
};
type Send = (command: Command) => Promise<any>;

export default function App() {
  const actor = "owner";
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState("");
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState(readLocal("view", "list"));
  useEffect(() => saveLocal("view", view), [view]);
  const [scope, setScope] = useState(readLocal("scope", "inbox"));
  const [selected, setSelected] = useState<string | null>(
    readLocal("selected", null),
  );
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [modal, setModal] = useState<"feature" | "project" | null>(null);
  const [theme, setTheme] = useState(readLocal("theme", "system"));
  const [events, setEvents] = useState<
    { type: string; at: string; featureId?: string }[]
  >([]);
  const currentActor = useRef(actor);
  currentActor.current = actor;
  const refresh = async (as = actor) => {
    if (window.roopre) {
      const data = await window.roopre.snapshot();
      setSnapshot((previous) =>
        previous && previous.revision > data.revision ? previous : data,
      );
      setConnected(true);
      setSyncError("");
      setLastSync(new Date().toISOString());
      return data;
    }
    const response = await fetch(`${API}/state`, {
      headers: { "x-devflow-actor": as },
    });
    if (!response.ok)
      throw new Error("팀 상태를 불러올 수 없습니다. API 연결을 확인하세요.");
    const data = await response.json();
    if (currentActor.current === as) {
      setSnapshot((previous) =>
        previous && previous.revision > data.revision ? previous : data,
      );
      setLastSync(new Date().toISOString());
    }
    return data as Snapshot;
  };
  useEffect(() => {
    if (window.roopre) {
      let live = true;
      let timer: ReturnType<typeof setTimeout>;
      const poll = async () => {
        try {
          await refresh(actor);
        } catch (e) {
          if (live) {
            setConnected(false);
            setSyncError((e as Error).message);
          }
        } finally {
          if (live) timer = setTimeout(() => void poll(), 1000);
        }
      };
      void poll();
      return () => {
        live = false;
        clearTimeout(timer);
      };
    }
    saveLocal("actor", actor);
    let active = true;
    let stream: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout>;
    setConnected(false);
    setSnapshot(undefined);
    const start = async () => {
      try {
        const data = await refresh(actor);
        if (!active) return;
        stream = new EventSource(
          `${API}/events?actor=${actor}&after=${data.sequence}`,
        );
        stream.onopen = () => {
          if (active) {
            setConnected(true);
            setError("");
            void refresh(actor).catch(() => setConnected(false));
          }
        };
        stream.onerror = () => {
          if (active) setConnected(false);
        };
        stream.onmessage = (message) => {
          if (active) {
            const event = JSON.parse(message.data);
            setEvents((old) => [event, ...old].slice(0, 30));
            void refresh(actor).catch(() => setConnected(false));
          }
        };
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          retry = setTimeout(start, 2000);
        }
      }
    };
    void start();
    return () => {
      active = false;
      stream?.close();
      clearTimeout(retry);
    };
  }, [actor]);
  useEffect(() => {
    saveLocal("scope", scope);
    saveLocal("selected", selected);
  }, [scope, selected]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    saveLocal("theme", theme);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearch((s) => !s);
      }
      if (e.key === "Escape") {
        setModal(null);
        setSearch(false);
      }
      if ((e.metaKey || e.ctrlKey) && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        setSelected(null);
        setScope(e.key === "1" ? "inbox" : e.key === "2" ? "all" : "policies");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const send: Send = async (command) => {
    if (!connected)
      throw new Error("연결이 끊겼습니다. 동기화 후 다시 시도하세요.");
    if (window.roopre) {
      const result = await window.roopre.command(command);
      await refresh();
      return result;
    }
    const as = actor;
    const response = await fetch(`${API}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-devflow-actor": as },
      body: JSON.stringify({ requestId: crypto.randomUUID(), command }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    await refresh(as);
    return result;
  };
  const act = async (fn: () => Promise<any>, success?: string) => {
    setError("");
    try {
      await fn();
      if (success) setNotice(success);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const feature = snapshot?.features.find((f) => f.id === selected);
  const me = snapshot?.people.find((p) => p.id === actor);
  const inboxCount =
    snapshot?.features.filter(
      (f) =>
        latestDesign(f)?.reviewers.includes(actor) &&
        !latestDesign(f)?.decisions.some(
          (d) => d.actorId === actor && d.decision === "approve",
        ),
    ).length || 0;
  const project = snapshot?.projects.find((p) => p.id === scope);
  const visible =
    snapshot?.features.filter(
      (f) =>
        (scope === "all" ||
          scope === "inbox" ||
          scope === "blocked" ||
          scope === "queued" ||
          f.projectId === scope) &&
        (scope !== "inbox" ||
          latestDesign(f)?.reviewers.includes(actor) ||
          f.authorId === actor) &&
        (scope !== "blocked" ||
          snapshot.gates[f.id].blockers > 0 ||
          snapshot.runs.some(
            (r) => r.featureId === f.id && r.status === "blocked",
          )) &&
        (scope !== "queued" ||
          snapshot.runs.some(
            (r) => r.featureId === f.id && r.status === "queued",
          )) &&
        (!query ||
          `${f.title} ${snapshot.projects.find((p) => p.id === f.projectId)?.name}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    ) || [];
  const navigate = (next: string) => {
    setScope(next);
    setSelected(null);
    setQuery("");
  };
  return (
    <div className="app">
      <header className="titlebar">
        <span className="window-space" />
        <span className="app-wordmark">{APP_NAME}</span>
        <span className="titlebar-divider" />
        <span className="caption">팀의 기준으로, 함께 개발하기</span>
        <div className="titlebar-right">
          <button
            className="icon-button notification-button"
            aria-label="작업 알림"
            onClick={() => setNotifications(!notifications)}
          >
            <Bell size={15} />
            {events.length > 0 && <i />}
          </button>
          <span className={`connection ${connected ? "" : "offline"}`}>
            <span className="dot" />
            {connected ? "동기화됨" : "연결 확인 중"}
          </span>
          <select
            className="theme-select"
            aria-label="화면 테마"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="system">시스템 설정</option>
            <option value="light">라이트</option>
            <option value="dark">다크</option>
          </select>
        </div>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <div className="team">
            <img className="team-mark" src={appIcon} alt="루프리" />
            <div>
              <strong>루프리 워크스페이스</strong>
              <small>로컬 개발 워크스페이스</small>
            </div>
          </div>
          <button className="search-button" onClick={() => setSearch(true)}>
            <Search size={15} /> 작업 검색 <kbd>⌘ K</kbd>
          </button>
          <nav aria-label="주요 화면">
            <Nav
              active={scope === "inbox" && !selected}
              icon={<Inbox size={17} />}
              label="내 할 일"
              count={inboxCount}
              onClick={() => navigate("inbox")}
            />
            <Nav
              active={scope === "all" && !selected}
              icon={<PanelLeft size={17} />}
              label="전체 작업"
              onClick={() => navigate("all")}
            />
            <Nav
              active={scope === "blocked" && !selected}
              icon={<AlertCircle size={17} />}
              label="확인 필요한 작업"
              onClick={() => navigate("blocked")}
            />
            <Nav
              active={scope === "queued" && !selected}
              icon={<Clock3 size={17} />}
              label={window.roopre ? "실행 현황" : "실행 대기"}
              count={
                snapshot?.runs.filter((r) => activeStatuses.includes(r.status))
                  .length
              }
              onClick={() => navigate("queued")}
            />
          </nav>
          <div className="nav-section">
            <span>프로젝트</span>
            {me?.role === "admin" && (
              <button
                className="icon-button"
                aria-label="프로젝트 추가"
                onClick={() => setModal("project")}
              >
                <Plus size={15} />
              </button>
            )}
          </div>
          <nav aria-label="프로젝트">
            {snapshot?.projects.map((p) => (
              <div key={p.id}>
                <Nav
                  active={scope === p.id && !selected}
                  icon={
                    <span
                      className="project-dot"
                      style={{ background: p.color }}
                    />
                  }
                  label={p.name}
                  count={
                    snapshot.features.filter((f) => f.projectId === p.id).length
                  }
                  onClick={() => navigate(p.id)}
                />
                {(scope === p.id || feature?.projectId === p.id) && (
                  <div className="feature-nav">
                    {snapshot.features
                      .filter((f) => f.projectId === p.id)
                      .map((f) => (
                        <button
                          key={f.id}
                          className={f.id === selected ? "selected" : ""}
                          onClick={() => setSelected(f.id)}
                        >
                          <Circle size={8} />
                          <span>{f.title}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <Nav
              active={scope === "runtime" && !selected}
              icon={<Terminal size={17} />}
              label="표준 · 연결 · 환경"
              onClick={() => navigate("runtime")}
            />
            <Nav
              active={scope === "policies" && !selected}
              icon={<Settings2 size={17} />}
              label="지침 · 팀 설정"
              onClick={() => navigate("policies")}
            />
            {window.roopre ? (
              <div className="profile">
                <div className="avatar">나</div>
                <span>
                  프로젝트 소유자
                  <br />
                  <small>macOS 본인 승인</small>
                </span>
              </div>
            ) : (
              <div className="profile">
                <div className="avatar">나</div>
                <span>
                  로컬 미리보기
                  <br />
                  <small>실제 실행·승인은 맥 앱에서</small>
                </span>
              </div>
            )}
          </div>
        </aside>
        <main className="workspace">
          <div className="dev-strip">
            <span className="dev-label">
              {window.roopre ? "로컬 워크스페이스" : "개발 미리보기"}
            </span>
            {window.roopre
              ? "본인 승인 · 격리 실행 · 고정 품질 기준"
              : "로컬 미리보기 · 실제 실행은 macOS 앱에서"}
            <span>필수 설계 승인 적용</span>
            <ShieldCheck size={14} />
          </div>
          {!connected && snapshot && (
            <div className="offline-banner">
              <WifiOff size={16} />
              마지막 동기화 {lastSync ? ago(lastSync) : "미확인"} · 읽기와 초안
              작성만 가능합니다.
            </div>
          )}
          {syncError && (
            <div className="error-banner" role="alert">
              연결 복구 중 · {syncError} · 저장된 화면을 유지하며 자동으로 다시
              연결합니다.
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="오류 닫기"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!snapshot ? (
            <div className="loading">
              <LoaderCircle size={24} className="spin" />
              <h2>팀 작업을 불러오는 중</h2>
              <p>로컬 API와 데이터베이스 연결을 확인하고 있습니다.</p>
            </div>
          ) : feature ? (
            <FeatureView
              key={`${feature.id}:${actor}`}
              snapshot={snapshot}
              feature={feature}
              actor={actor}
              connected={connected}
              send={send}
              act={act}
              onBack={() => setSelected(null)}
            />
          ) : scope === "queued" && window.roopre ? (
            <RunOverview
              snapshot={snapshot}
              onSelect={(id) => {
                saveLocal(`tab:${id}`, "execution");
                setSelected(id);
              }}
            />
          ) : scope === "runtime" ? (
            <RuntimeSettings snapshot={snapshot} onSaved={refresh} />
          ) : scope === "policies" ? (
            <PolicyView
              snapshot={snapshot}
              actor={actor}
              send={send}
              act={act}
              connected={connected}
            />
          ) : !snapshot.projects.length ? (
            <div className="content-page">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">시작하기</div>
                  <h1>내 프로젝트로 시작하세요</h1>
                  <p>
                    프로젝트를 만들고 저장소와 AI 연결을 설정한 뒤, 요구사항과
                    설계부터 진행하세요.
                  </p>
                  <button
                    className="primary spaced"
                    disabled={!connected}
                    onClick={() => setModal("project")}
                  >
                    <Plus size={16} />
                    프로젝트 만들기
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {project ? "프로젝트" : "워크스페이스"}
                  </div>
                  <h1>
                    {project?.name ||
                      (
                        {
                          inbox: "내 할 일",
                          all: "전체 작업",
                          blocked: "확인 필요한 작업",
                          queued: "실행 대기",
                        } as Record<string, string>
                      )[scope]}
                  </h1>
                  <p>
                    {project?.description ||
                      (scope === "inbox"
                        ? "설계 검토와 필요한 판단부터 확인하세요."
                        : "여러 프로젝트의 기능과 다음 단계를 한곳에서 확인하세요.")}
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => setModal("feature")}
                  disabled={!connected}
                >
                  <Plus size={16} />새 기능
                </button>
              </div>
              <div className="list-toolbar">
                <div className="view-tabs">
                  <button
                    className={view === "list" ? "active" : ""}
                    onClick={() => setView("list")}
                  >
                    <FileText size={15} />
                    기능 목록 <span>{visible.length}</span>
                  </button>
                  <button
                    className={view === "board" ? "active" : ""}
                    onClick={() => setView("board")}
                  >
                    단계 보드
                  </button>
                </div>
                <label className="inline-search">
                  <Search size={15} />
                  <input
                    placeholder="기능 검색"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {view === "board" ? (
                <div className="phase-board" aria-label="개발 단계 보드">
                  {Object.entries(labels).map(([status, label]) => (
                    <section key={status}>
                      <h3>
                        {label}
                        <span>
                          {
                            visible.filter(
                              (f) => snapshot.gates[f.id].status === status,
                            ).length
                          }
                        </span>
                      </h3>
                      {visible
                        .filter((f) => snapshot.gates[f.id].status === status)
                        .map((f) => (
                          <button key={f.id} onClick={() => setSelected(f.id)}>
                            <strong>{f.title}</strong>
                            <small>
                              {
                                snapshot.projects.find(
                                  (p) => p.id === f.projectId,
                                )?.name
                              }
                            </small>
                            <span>
                              {snapshot.gates[f.id].approved}/
                              {snapshot.gates[f.id].required} 승인
                            </span>
                          </button>
                        ))}
                    </section>
                  ))}
                </div>
              ) : (
                <div
                  className="feature-table"
                  role="region"
                  aria-label="기능 목록"
                >
                  <div className="table-head">
                    <span>기능</span>
                    <span>현재 단계</span>
                    <span>설계 승인</span>
                    <span>최근 변경</span>
                  </div>
                  {visible.map((f) => {
                    const g = snapshot.gates[f.id];
                    const run = snapshot.runs
                      .slice()
                      .reverse()
                      .find(
                        (r) => r.featureId === f.id && r.status !== "cancelled",
                      );
                    return (
                      <button
                        className="feature-row"
                        key={f.id}
                        onClick={() => setSelected(f.id)}
                      >
                        <div className="feature-cell">
                          <span className={`state-icon ${g.status}`}>
                            <CircleDot size={17} />
                          </span>
                          <div>
                            <strong>{f.title}</strong>
                            <small>
                              {
                                snapshot.projects.find(
                                  (p) => p.id === f.projectId,
                                )?.name
                              }
                              <span className="meta-separator">/</span>
                              {f.template === "bug" ? "버그 수정" : "신규 기능"}
                              {g.blockers > 0 && (
                                <span className="blocking-note">
                                  차단 의견 {g.blockers}
                                </span>
                              )}
                            </small>
                          </div>
                        </div>
                        <span className={`status ${run ? "queued" : g.status}`}>
                          {run ? runNames[run.status] : labels[g.status]}
                        </span>
                        <span className="approval-count">
                          <ShieldCheck size={14} />
                          {g.approved} / {g.required}
                        </span>
                        <span className="muted">
                          {ago(f.updatedAt)}
                          <ChevronRight size={14} />
                        </span>
                      </button>
                    );
                  })}
                  {!visible.length && (
                    <div className="empty">
                      <CheckCheck size={25} />
                      <h3>지금 확인할 작업이 없습니다</h3>
                      <p>새 기능을 등록하거나 다른 프로젝트를 선택하세요.</p>
                    </div>
                  )}
                </div>
              )}
              <div className="workspace-note">
                <ShieldCheck size={17} />
                <div>
                  <strong>설계가 승인되면 개발을 시작합니다.</strong>
                  <p>
                    필수 검토자의 승인과 차단 의견 해결 상태를 함께 확인합니다.
                  </p>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      {notifications && (
        <aside className="notification-panel" aria-label="작업 알림 목록">
          <header>
            <strong>작업 알림</strong>
            <button
              className="icon-button"
              aria-label="알림 닫기"
              onClick={() => setNotifications(false)}
            >
              <X size={16} />
            </button>
          </header>
          {events
            .filter((e) =>
              [
                "publish_design",
                "review",
                "add_thread",
                "resolve_thread",
                "queue_run",
                "publish_policy",
                "update_project_policy",
              ].includes(e.type),
            )
            .map((e, i) => (
              <button
                key={i}
                onClick={() => {
                  if (e.featureId) setSelected(e.featureId);
                  else navigate("policies");
                  setNotifications(false);
                }}
              >
                <MessageSquare size={15} />
                <span>
                  {snapshot?.features.find((f) => f.id === e.featureId)
                    ?.title || "팀 지침"}
                  <small>
                    {
                      (
                        {
                          publish_design: "새 설계 리뷰 요청",
                          review: "검토 상태 변경",
                          add_thread: "새 리뷰 의견",
                          resolve_thread: "의견 해결 확인",
                          queue_run: "실행 요청 저장",
                          publish_policy: "지침 버전 변경",
                          update_project_policy: "프로젝트 기준 변경",
                        } as Record<string, string>
                      )[e.type]
                    }{" "}
                    · {ago(e.at)}
                  </small>
                </span>
              </button>
            ))}
          {!events.length && (
            <p>연결 이후의 검토 요청과 변경 알림을 표시합니다.</p>
          )}
        </aside>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {search && (
        <div className="modal-backdrop" onClick={() => setSearch(false)}>
          <div
            className="command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="작업 검색"
            onClick={(e) => e.stopPropagation()}
          >
            <label>
              <Search size={20} />
              <input
                autoFocus
                placeholder="프로젝트 또는 기능 검색…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="icon-button"
                onClick={() => setSearch(false)}
                aria-label="검색 닫기"
              >
                <X size={18} />
              </button>
            </label>
            <div>
              {snapshot?.features
                .filter((f) =>
                  `${f.title} ${snapshot.projects.find((p) => p.id === f.projectId)?.name}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setSelected(f.id);
                      setSearch(false);
                      setQuery("");
                    }}
                  >
                    <FileText size={16} />
                    <span>
                      {f.title}
                      <small>
                        {
                          snapshot.projects.find((p) => p.id === f.projectId)
                            ?.name
                        }
                      </small>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
      {modal && snapshot && (
        <CreateDialog
          kind={modal}
          snapshot={snapshot}
          defaultProject={project?.id || snapshot.projects[0]?.id || ""}
          send={send}
          onClose={() => setModal(null)}
          onCreated={(id) => {
            setModal(null);
            if (modal === "feature") setSelected(id);
            else navigate(id);
          }}
        />
      )}
    </div>
  );
}

function Nav({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {count !== undefined && count > 0 && <small>{count}</small>}
    </button>
  );
}

function FeatureView({
  snapshot,
  feature: f,
  actor,
  connected,
  send,
  act,
  onBack,
}: {
  snapshot: Snapshot;
  feature: Feature;
  actor: string;
  connected: boolean;
  send: Send;
  act: (fn: () => Promise<any>, success?: string) => Promise<void>;
  onBack: () => void;
}) {
  const [reviewWidth, setReviewWidth] = useState(
    readLocal(`review-width:${f.id}`, 320),
  );
  useEffect(
    () => saveLocal(`review-width:${f.id}`, reviewWidth),
    [reviewWidth, f.id],
  );
  const latest = latestDesign(f);
  const g = snapshot.gates[f.id];
  const editable =
    f.authorId === actor ||
    snapshot.people.find((p) => p.id === actor)?.role === "admin";
  const [tab, setTab] = useState(readLocal(`tab:${f.id}`, "design"));
  const [edit, setEdit] = useState(!latest);
  const draftKey = `draft:${f.id}:${actor}`;
  const [draft, setDraft] = useState(() =>
    readLocal(draftKey, {
      body: f.draft.body,
      requirements: f.draft.requirements,
      revision: f.draft.revision,
    }),
  );
  const [version, setVersion] = useState(latest?.id || "");
  const d = f.designs.find((d) => d.id === version) || latest;
  const isLatest = d?.id === latest?.id;
  const [compare, setCompare] = useState(false);
  const [checked, setChecked] = useState<(typeof sections)[number][]>(() =>
    readLocal(`checks:${actor}:${latest?.id}`, []),
  );
  const [section, setSection] = useState<(typeof sections)[number]>("요구사항");
  const [comment, setComment] = useState(
    readLocal(`comment:${actor}:${f.id}`, ""),
  );
  const [quote, setQuote] = useState("");
  const [blocking, setBlocking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [threadFilter, setThreadFilter] = useState("open");
  const [log, setLog] = useState(false);
  const documentRef = useRef<HTMLDivElement>(null);
  const oldLatest = useRef(latest?.id);
  useEffect(() => {
    setSection("요구사항");
  }, []);
  useEffect(() => {
    if (oldLatest.current !== latest?.id) {
      oldLatest.current = latest?.id;
      setVersion(latest?.id || "");
      setChecked([]);
      setCompare(false);
    }
  }, [latest?.id]);
  useEffect(() => {
    saveLocal(`tab:${f.id}`, tab);
  }, [tab]);
  useEffect(() => {
    saveLocal(`comment:${actor}:${f.id}`, comment);
  }, [comment]);
  useEffect(() => {
    if (documentRef.current)
      documentRef.current.scrollTop = readLocal(`scroll:${f.id}:${tab}`, 0);
  }, [tab, edit]);
  const operation = async (fn: () => Promise<any>, success?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await act(fn, success);
    } finally {
      setBusy(false);
    }
  };
  const updateDraft = (next: typeof draft) => {
    setDraft(next);
    saveLocal(draftKey, next);
  };
  const save = async () => {
    await send({
      type: "save_draft",
      featureId: f.id,
      expectedRevision: draft.revision,
      body: draft.body,
      requirements: draft.requirements,
    });
    const next = { ...draft, revision: draft.revision + 1 };
    setDraft(next);
    localStorage.removeItem(localKey(draftKey));
    return next;
  };
  const publish = async () => {
    const saved = await save();
    await send({
      type: "publish_design",
      featureId: f.id,
      expectedRevision: saved.revision,
    });
    setEdit(false);
  };
  const reviewer =
    (snapshot.mode === "local-owner" || actor !== f.authorId) &&
    !!d?.reviewers.includes(actor);
  const myDecision = d?.decisions.find((x) => x.actorId === actor)?.decision;
  const run = snapshot.runs.filter((r) => r.featureId === f.id).at(-1);
  const executionStage =
    run?.runtime && !["cancelled", "blocked"].includes(run.status)
      ? ["verifying", "reviewing"].includes(run.status)
        ? 3
        : run.status === "ready_for_merge"
          ? 4
          : 2
      : 1;
  const threadItems = f.threads.filter(
    (t) => threadFilter === "all" || t.status !== "resolved",
  );
  return (
    <div className="feature-detail">
      <div className="detail-heading">
        <button
          className="icon-button"
          aria-label="기능 목록으로"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <span>{snapshot.projects.find((p) => p.id === f.projectId)?.name}</span>
        <ChevronRight size={13} />
        <span>{f.template === "bug" ? "버그 수정" : "신규 기능"}</span>
        <div className="detail-heading-end">
          <span className={`status ${g.status}`}>{labels[g.status]}</span>
        </div>
      </div>
      <div className="feature-title">
        <div>
          <h1>{f.title}</h1>
          <p>{f.draft.requirements}</p>
        </div>
        <span className="owner">
          <span className="avatar tiny">
            {snapshot.people.find((p) => p.id === f.authorId)?.name.slice(0, 1)}
          </span>
          {
            snapshot.people
              .find((p) => p.id === f.authorId)
              ?.name.split(" ·")[0]
          }
        </span>
      </div>
      <div className="phase-track" aria-label="개발 단계">
        <span className="complete">
          <Check size={13} />
          요구사항
        </span>
        <ChevronRight size={13} />
        <span className={executionStage === 1 ? "current" : "complete"}>
          <CircleDot size={14} />
          설계 · {labels[g.status]}
        </span>
        <ChevronRight size={13} />
        <span
          className={
            executionStage === 2
              ? "current"
              : executionStage > 2
                ? "complete"
                : ""
          }
        >
          구현{executionStage === 2 && run ? ` · ${runNames[run.status]}` : ""}
        </span>
        <ChevronRight size={13} />
        <span
          className={
            executionStage === 3
              ? "current"
              : executionStage > 3
                ? "complete"
                : ""
          }
        >
          리뷰·테스트
        </span>
        <ChevronRight size={13} />
        <span className={executionStage === 4 ? "current" : ""}>결과 검토</span>
      </div>
      <div className="detail-tabs" role="tablist" aria-label="기능 정보">
        {[
          ["design", "설계·리뷰"],
          ["requirements", "요구사항"],
          ["policy", "적용 지침"],
          ["execution", "실행·결과"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
            {id === "design" && g.blockers > 0 && (
              <span className="tab-counter">{g.blockers}</span>
            )}
          </button>
        ))}
      </div>
      {tab === "design" ? (
        <div
          className="review-layout"
          style={
            { "--review-width": `${reviewWidth}px` } as React.CSSProperties
          }
        >
          <section className="design-panel" aria-label="설계 문서">
            <div className="document-toolbar">
              <div>
                <FileText size={16} />
                {edit ? (
                  <strong>설계 초안</strong>
                ) : (
                  <select
                    aria-label="설계 버전"
                    value={d?.id || ""}
                    onChange={(e) => setVersion(e.target.value)}
                  >
                    {f.designs.map((d) => (
                      <option key={d.id} value={d.id}>
                        설계 v{d.number}
                        {d.id === latest?.id ? " · 최신" : ""}
                      </option>
                    ))}
                  </select>
                )}
                {d && !edit && (
                  <span className="muted">{d.hash.slice(0, 7)}</span>
                )}
              </div>
              <div>
                {!edit && f.designs.length > 1 && (
                  <button
                    className={compare ? "soft active" : "soft"}
                    onClick={() => setCompare(!compare)}
                  >
                    이전 버전과 비교
                  </button>
                )}
                {editable && (
                  <button
                    className="soft"
                    onClick={() => {
                      if (!edit && !localStorage.getItem(localKey(draftKey)))
                        setDraft({
                          body: f.draft.body,
                          requirements: f.draft.requirements,
                          revision: f.draft.revision,
                        });
                      setEdit(!edit);
                    }}
                  >
                    {edit && latest ? "게시본 보기" : "설계 편집"}
                  </button>
                )}
              </div>
            </div>
            {!isLatest && !edit && (
              <div className="document-info">
                이전 버전입니다. 승인과 의견은 최신 설계에서 작성하세요.
              </div>
            )}
            {edit && draft.revision !== f.draft.revision && (
              <div className="conflict" role="alert">
                서버에 새로운 초안이 있습니다. 아래 내 초안은 보존되어 있습니다.
                <details>
                  <summary>서버 최신 초안 확인</summary>
                  <pre>{f.draft.body}</pre>
                </details>
                <button
                  onClick={() =>
                    updateDraft({ ...draft, revision: f.draft.revision })
                  }
                >
                  내용을 비교했고 현재 초안을 기준으로 다시 저장
                </button>
              </div>
            )}
            <div
              className="document-scroll"
              ref={documentRef}
              onScroll={(e) =>
                saveLocal(`scroll:${f.id}:${tab}`, e.currentTarget.scrollTop)
              }
            >
              {edit ? (
                <div className="editor">
                  <label>
                    기능 목표와 완료 기준
                    <textarea
                      aria-label="요구사항 초안"
                      value={draft.requirements}
                      onChange={(e) =>
                        updateDraft({ ...draft, requirements: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    설계 문서
                    <textarea
                      className="design-editor"
                      aria-label="설계 초안"
                      value={draft.body}
                      onChange={(e) =>
                        updateDraft({ ...draft, body: e.target.value })
                      }
                    />
                  </label>
                </div>
              ) : d ? (
                <Document
                  body={d.body}
                  previous={
                    compare
                      ? f.designs[f.designs.indexOf(d) - 1]?.body
                      : undefined
                  }
                  onComment={(s, q) => {
                    setSection(s);
                    setQuote(q);
                    document
                      .querySelector<HTMLTextAreaElement>("#review-comment")
                      ?.focus();
                  }}
                />
              ) : (
                <div className="empty">
                  설계를 작성해 개발자 리뷰를 요청하세요.
                </div>
              )}
            </div>
            {edit && editable && (
              <footer className="document-footer">
                <span className="muted">초안은 이 기기에 보존됩니다.</span>
                <button
                  className="secondary"
                  disabled={busy || !connected}
                  onClick={() => operation(save, "설계 초안을 저장했습니다.")}
                >
                  초안 저장
                </button>
                <button
                  className="primary"
                  disabled={busy || !connected}
                  onClick={() =>
                    operation(
                      publish,
                      "새 설계를 게시하고 리뷰를 요청했습니다.",
                    )
                  }
                >
                  리뷰 요청
                </button>
              </footer>
            )}
          </section>
          <aside className="review-panel" aria-label="개발자 리뷰">
            <div className="review-panel-title">
              <strong>개발자 리뷰</strong>
              <input
                className="panel-width"
                aria-label="리뷰 패널 너비"
                type="range"
                min="280"
                max="400"
                step="10"
                value={reviewWidth}
                onChange={(e) => setReviewWidth(Number(e.target.value))}
              />
              <span>
                {g.approved}/{g.required} 승인
              </span>
            </div>
            <div className="reviewers">
              {d?.reviewers.map((id) => {
                const decision = d.decisions.find((x) => x.actorId === id);
                return (
                  <div key={id}>
                    <span className="avatar tiny">
                      {snapshot.people
                        .find((p) => p.id === id)
                        ?.name.slice(0, 1)}
                    </span>
                    <span>
                      {snapshot.people.find((p) => p.id === id)?.name}
                    </span>
                    <span
                      className={decision?.decision === "approve" ? "ok" : ""}
                    >
                      {decision?.decision === "approve" ? (
                        <Check size={15} />
                      ) : decision?.decision === "request_changes" ? (
                        "수정 요청"
                      ) : (
                        "대기"
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="review-scroll">
              <div className="thread-heading">
                <strong>
                  리뷰 의견{" "}
                  <span>
                    {f.threads.filter((t) => t.status !== "resolved").length}
                  </span>
                </strong>
                <select
                  aria-label="리뷰 의견 필터"
                  value={threadFilter}
                  onChange={(e) => setThreadFilter(e.target.value)}
                >
                  <option value="open">미해결</option>
                  <option value="all">전체</option>
                </select>
              </div>
              {threadItems.map((t) => (
                <ThreadCard
                  key={t.id}
                  thread={t}
                  feature={f}
                  snapshot={snapshot}
                  actor={actor}
                  connected={connected}
                  send={send}
                  act={act}
                />
              ))}
              {!threadItems.length && (
                <p className="quiet-empty">
                  {f.threads.length
                    ? "미해결 의견이 없습니다."
                    : "아직 리뷰 의견이 없습니다."}
                </p>
              )}
              {isLatest && d && !edit && (
                <div className="comment-form">
                  <label>
                    검토 위치
                    <select
                      aria-label="검토 위치"
                      value={section}
                      onChange={(e) =>
                        setSection(e.target.value as (typeof sections)[number])
                      }
                    >
                      {sections.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  {quote && (
                    <blockquote>
                      {quote}
                      <button
                        className="icon-button"
                        aria-label="인용 해제"
                        onClick={() => setQuote("")}
                      >
                        <X size={12} />
                      </button>
                    </blockquote>
                  )}
                  <textarea
                    id="review-comment"
                    placeholder="확인할 점이나 수정 의견을 남기세요."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        (e.metaKey || e.ctrlKey) &&
                        e.key === "Enter" &&
                        comment.trim()
                      )
                        void operation(async () => {
                          await send({
                            type: "add_thread",
                            featureId: f.id,
                            designId: d.id,
                            section,
                            quote,
                            body: comment,
                            blocking,
                          });
                          setComment("");
                          setQuote("");
                        }, "리뷰 의견을 남겼습니다.");
                    }}
                  />
                  <div>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={blocking}
                        onChange={(e) => setBlocking(e.target.checked)}
                      />
                      해결 전 구현 차단
                    </label>
                    <button
                      className="secondary"
                      disabled={!connected || busy || !comment.trim()}
                      onClick={() =>
                        operation(async () => {
                          await send({
                            type: "add_thread",
                            featureId: f.id,
                            designId: d.id,
                            section,
                            quote,
                            body: comment,
                            blocking,
                          });
                          setComment("");
                          setQuote("");
                        }, "리뷰 의견을 남겼습니다.")
                      }
                    >
                      의견 남기기
                    </button>
                  </div>
                </div>
              )}
              {reviewer && isLatest && d && !edit && (
                <div className="review-checklist">
                  <h4>
                    설계 검토 체크리스트 <span>{checked.length}/7</span>
                  </h4>
                  {sections.map((s) => (
                    <label className="checkbox" key={s}>
                      <input
                        type="checkbox"
                        checked={checked.includes(s)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...checked, s]
                            : checked.filter((x) => x !== s);
                          setChecked(next);
                          saveLocal(`checks:${actor}:${d.id}`, next);
                        }}
                      />
                      {s}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <footer className="review-footer">
              {g.blockers > 0 && (
                <p>
                  <AlertCircle size={14} />
                  차단 의견 {g.blockers}건 해결 확인 필요
                </p>
              )}
              {reviewer && isLatest && d && !edit ? (
                <div>
                  <button
                    className="secondary"
                    disabled={!connected || busy}
                    onClick={() =>
                      operation(
                        () =>
                          send({
                            type: "review",
                            featureId: f.id,
                            designId: d.id,
                            decision: "request_changes",
                            checked,
                          }),
                        "수정 요청을 보냈습니다.",
                      )
                    }
                  >
                    수정 요청
                  </button>
                  {myDecision === "approve" ? (
                    <button
                      className="secondary"
                      disabled={!connected || busy}
                      onClick={() =>
                        operation(
                          () =>
                            send({
                              type: "review",
                              featureId: f.id,
                              designId: d.id,
                              decision: "withdraw",
                              checked,
                            }),
                          "승인을 철회했습니다.",
                        )
                      }
                    >
                      승인 철회
                    </button>
                  ) : (
                    <button
                      className="primary"
                      disabled={
                        !connected ||
                        busy ||
                        checked.length !== 7 ||
                        g.blockers > 0
                      }
                      onClick={() =>
                        operation(
                          () =>
                            send({
                              type: "review",
                              featureId: f.id,
                              designId: d.id,
                              decision: "approve",
                              checked,
                            }),
                          `설계 v${d.number}을 승인했습니다.`,
                        )
                      }
                    >
                      <ShieldCheck size={15} />v{d.number} 승인
                    </button>
                  )}
                </div>
              ) : (
                <p className="muted">
                  {editable
                    ? "개발자 검토자의 승인을 기다립니다."
                    : "최신 게시본에서 검토할 수 있습니다."}
                </p>
              )}
            </footer>
          </aside>
        </div>
      ) : tab === "requirements" ? (
        <div className="content-page">
          <h2>기능 목표와 완료 기준</h2>
          <p className="preserve">{d?.requirements || f.draft.requirements}</p>
          <h3>선행 기능</h3>
          <p className="muted">
            선행 기능이 통합되기 전에는 구현을 시작하지 않습니다.
          </p>
          {snapshot.features
            .filter((x) => x.id !== f.id)
            .map((x) => (
              <label className="dependency-row" key={x.id}>
                <input
                  type="checkbox"
                  checked={f.dependencies.includes(x.id)}
                  disabled={!connected || !editable}
                  onChange={(e) =>
                    operation(
                      () =>
                        send({
                          type: "set_dependencies",
                          featureId: f.id,
                          dependencyIds: e.target.checked
                            ? [...f.dependencies, x.id]
                            : f.dependencies.filter((id) => id !== x.id),
                        }),
                      "의존 관계를 저장했습니다.",
                    )
                  }
                />
                <span>{x.title}</span>
                <small>
                  {snapshot.projects.find((p) => p.id === x.projectId)?.name}
                </small>
              </label>
            ))}
        </div>
      ) : tab === "policy" ? (
        <div className="content-page">
          <h2>이 기능에 적용되는 지침</h2>
          <p className="muted">
            {run
              ? "마지막 실행 요청에 저장된 지침 스냅샷입니다."
              : "실행 요청 전 적용 미리보기입니다. 게시된 설계와 팀 지침을 조합합니다."}
          </p>
          {run ? (
            <pre className="policy-text">{run.effectivePolicy}</pre>
          ) : (
            <>
              {[
                ["전역 지침", snapshot.policies.at(-1)!.global],
                [
                  "프로젝트",
                  snapshot.projects
                    .find((p) => p.id === f.projectId)!
                    .requiredChecks.join(" · "),
                ],
                [
                  "프로젝트 지침",
                  snapshot.projects.find((p) => p.id === f.projectId)!
                    .instructions || "추가 지침 없음",
                ],
                ["설계 단계", snapshot.policies.at(-1)!.design],
                ["구현 단계", snapshot.policies.at(-1)!.implementation],
                ["리뷰 역할", snapshot.policies.at(-1)!.reviewer],
                ["이번 기능", d?.requirements || f.draft.requirements],
              ].map(([title, body]) => (
                <section className="policy-section" key={title}>
                  <h3>
                    {title}
                    <small>팀 v{snapshot.policies.at(-1)!.version}</small>
                  </h3>
                  <p>{body}</p>
                </section>
              ))}
            </>
          )}
        </div>
      ) : snapshot.mode === "local-owner" ? (
        <RunPanel snapshot={snapshot} feature={f} send={send} />
      ) : (
        <div className="content-page">
          <div className="execution-heading">
            <div>
              <h2>개발 실행과 검증 결과</h2>
              <p className="muted">
                M1은 실행 요청과 승인 상태를 저장합니다. 실제 Claude Code·테스트
                실행은 아직 연결되지 않았습니다.
              </p>
            </div>
            <Terminal size={28} />
          </div>
          <div className="execution-status">
            <Clock3 size={20} />
            <div>
              <strong>
                {run?.status === "blocked"
                  ? "실행 요청 차단됨"
                  : run?.status === "queued"
                    ? "실행 요청 저장됨"
                    : "실행기 미연결"}
              </strong>
              <p>
                {run?.reason || "승인 후 실행 대기열에 등록할 수 있습니다."}
              </p>
            </div>
          </div>
          <h3>구현 시작 조건</h3>
          <ul className="gate-list">
            {g.eligible ? (
              <li className="ok">
                <Check size={16} />
                최신 설계의 필수 승인이 모두 완료됐습니다.
              </li>
            ) : (
              g.reasons.map((reason) => (
                <li key={reason}>
                  <AlertCircle size={16} />
                  {reason}
                </li>
              ))
            )}
          </ul>
          {editable && (
            <div className="button-row">
              {run && run.status !== "cancelled" ? (
                <button
                  className="secondary"
                  disabled={!connected || busy}
                  onClick={() =>
                    operation(
                      () => send({ type: "cancel_run", runId: run.id }),
                      "실행 대기를 취소했습니다.",
                    )
                  }
                >
                  대기 취소
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={!connected || busy || !g.eligible}
                  onClick={() =>
                    operation(
                      () =>
                        send({
                          type: "queue_run",
                          featureId: f.id,
                          designId: latest!.id,
                        }),
                      "실행 대기열에 등록했습니다. 실행기는 아직 연결되지 않았습니다.",
                    )
                  }
                >
                  <Play size={15} />
                  실행 대기열에 등록
                </button>
              )}
            </div>
          )}
          <div className="result-placeholder">
            <FileText size={24} />
            <h3>아직 검증 결과가 없습니다</h3>
            <p>실제로 수행한 검사만 이곳에 표시됩니다.</p>
          </div>
          <button className="soft" onClick={() => setLog(!log)}>
            {log ? "실행 기록 접기" : "실행 요청 기록 보기"}
            <ChevronDown size={14} />
          </button>
          {log && (
            <pre className="policy-text">
              {snapshot.runs
                .filter((r) => r.featureId === f.id)
                .map((r) => `${r.at}\n${r.id} · ${r.status}\n${r.reason}`)
                .join("\n\n") || "실행 요청 없음"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Document({
  body,
  previous,
  onComment,
}: {
  body: string;
  previous?: string;
  onComment: (section: (typeof sections)[number], quote: string) => void;
}) {
  const blocks = body.split(/^## /m).filter(Boolean);
  return (
    <article className="design-document">
      {previous !== undefined && (
        <div className="diff-legend">
          <span>추가·변경</span>
          <span>이전 내용</span>
        </div>
      )}
      {blocks.map((block, index) => {
        const [title, ...rest] = block.split("\n");
        const content = rest.join("\n").trim();
        const priorBlock = previous
          ?.split(/^## /m)
          .find((b) => b.startsWith(title + "\n"));
        const old = priorBlock?.split("\n").slice(1).join("\n").trim();
        const changed = previous !== undefined && old !== content;
        return (
          <section className={changed ? "changed" : ""} key={index}>
            <div className="document-section-title">
              <h2>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {title}
              </h2>
              <button
                className="icon-button"
                aria-label={`${title}에 의견 남기기`}
                onClick={() =>
                  onComment(
                    sections.includes(title as any)
                      ? (title as (typeof sections)[number])
                      : "요구사항",
                    window.getSelection()?.toString() || content.slice(0, 300),
                  )
                }
              >
                <MessageSquare size={15} />
              </button>
            </div>
            {changed && old && <p className="removed preserve">{old}</p>}
            <p className={`preserve ${changed ? "added" : ""}`}>{content}</p>
          </section>
        );
      })}
    </article>
  );
}

function ThreadCard({
  thread: t,
  feature: f,
  snapshot,
  actor,
  connected,
  send,
  act,
}: {
  thread: Thread;
  feature: Feature;
  snapshot: Snapshot;
  actor: string;
  connected: boolean;
  send: Send;
  act: (fn: () => Promise<any>, success?: string) => Promise<void>;
}) {
  const [reply, setReply] = useState(readLocal(`reply:${actor}:${t.id}`, ""));
  const [showReply, setShowReply] = useState(false);
  const [busy, setBusy] = useState(false);
  const perform = async (fn: () => Promise<any>, message: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await act(fn, message);
    } finally {
      setBusy(false);
    }
  };
  const canResolve =
    (snapshot.mode === "local-owner" || actor !== f.authorId) &&
    latestDesign(f)?.reviewers.includes(actor);
  return (
    <div className={`thread ${t.status === "resolved" ? "resolved" : ""}`}>
      <div className="thread-meta">
        <span className="avatar tiny">
          {snapshot.people.find((p) => p.id === t.authorId)?.name.slice(0, 1)}
        </span>
        <strong>
          {
            snapshot.people
              .find((p) => p.id === t.authorId)
              ?.name.split(" ·")[0]
          }
        </strong>
        <small>
          {t.status === "resolved"
            ? "해결 확인"
            : t.status === "addressed"
              ? "해결 확인 요청"
              : t.blocking
                ? "차단"
                : "참고"}
        </small>
      </div>
      <div className="thread-anchor">
        <MessageSquare size={12} />
        {t.section} · v{f.designs.find((d) => d.id === t.designId)?.number}
        {t.designId !== latestDesign(f)?.id && " · 이전 버전 의견"}
      </div>
      {t.quote && <blockquote>{t.quote}</blockquote>}
      <p>{t.body}</p>
      {t.replies.map((r, i) => (
        <div className="reply" key={i}>
          <strong>
            {
              snapshot.people
                .find((p) => p.id === r.actorId)
                ?.name.split(" ·")[0]
            }
          </strong>
          <p>{r.body}</p>
        </div>
      ))}
      <div className="thread-actions">
        <button className="soft" onClick={() => setShowReply(!showReply)}>
          답글 {t.replies.length || ""}
        </button>
        {t.status !== "resolved" &&
          (canResolve ? (
            <button
              className="soft"
              disabled={!connected || busy}
              onClick={() =>
                perform(
                  () =>
                    send({
                      type: "resolve_thread",
                      featureId: f.id,
                      threadId: t.id,
                    }),
                  "의견 해결을 확인했습니다.",
                )
              }
            >
              <Check size={13} />
              해결 확인
            </button>
          ) : actor === f.authorId && t.status === "open" ? (
            <button
              className="soft"
              disabled={!connected || busy}
              onClick={() =>
                perform(
                  () =>
                    send({
                      type: "address_thread",
                      featureId: f.id,
                      threadId: t.id,
                    }),
                  "검토자에게 해결 확인을 요청했습니다.",
                )
              }
            >
              수정 완료 알림
            </button>
          ) : null)}
      </div>
      {showReply && (
        <div className="reply-form">
          <textarea
            aria-label="리뷰 답글"
            value={reply}
            onChange={(e) => {
              setReply(e.target.value);
              saveLocal(`reply:${actor}:${t.id}`, e.target.value);
            }}
          />
          <button
            className="secondary"
            disabled={!connected || busy || !reply.trim()}
            onClick={() =>
              perform(async () => {
                await send({
                  type: "reply_thread",
                  featureId: f.id,
                  threadId: t.id,
                  body: reply,
                });
                setReply("");
                saveLocal(`reply:${actor}:${t.id}`, "");
              }, "답글을 저장했습니다.")
            }
          >
            답글 게시
          </button>
        </div>
      )}
    </div>
  );
}

function PolicyView({
  snapshot,
  actor,
  send,
  act,
  connected,
}: {
  snapshot: Snapshot;
  actor: string;
  send: Send;
  act: (fn: () => Promise<any>, success?: string) => Promise<void>;
  connected: boolean;
}) {
  const p = snapshot.policies.at(-1)!;
  const [draft, setDraft] = useState(p);
  const [busy, setBusy] = useState(false);
  const admin = snapshot.people.find((p) => p.id === actor)?.role === "admin";
  const [projectId, setProjectId] = useState(snapshot.projects[0]?.id ?? "");
  const project = snapshot.projects.find((p) => p.id === projectId);
  const [instructions, setInstructions] = useState(project?.instructions || "");
  const [checks, setChecks] = useState(
    project?.requiredChecks.join(", ") ?? "",
  );
  const [reviewers, setReviewers] = useState(project?.reviewerIds ?? []);
  useEffect(() => {
    setInstructions(project?.instructions || "");
    setChecks(project?.requiredChecks.join(", ") ?? "");
    setReviewers(project?.reviewerIds ?? []);
  }, [
    projectId,
    project?.requiredChecks.join(","),
    project?.reviewerIds.join(","),
    project?.instructions,
  ]);
  useEffect(() => setDraft(p), [p.version]);
  const submit = async (fn: () => Promise<any>, message: string) => {
    setBusy(true);
    try {
      await act(fn, message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="policy-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">팀의 공통 기준</div>
          <h1>지침 · 팀 설정</h1>
          <p>필수 기준을 일관되게 적용하고 변경된 버전을 기록합니다.</p>
        </div>
        <span className="version-badge">현재 v{p.version}</span>
      </div>
      <div className="policy-content">
        <section>
          <h2>팀·단계·역할 지침</h2>
          <p className="muted">
            새 버전을 게시하면 기존 설계는 재리뷰가 필요합니다. 필수 검사는
            삭제할 수 없습니다.
          </p>
          {(["global", "design", "implementation", "reviewer"] as const).map(
            (field, i) => (
              <label className="field" key={field}>
                {
                  [
                    "전역 지침",
                    "설계 단계 지침",
                    "구현 단계 지침",
                    "리뷰 역할 지침",
                  ][i]
                }
                <textarea
                  readOnly={!admin}
                  value={draft[field]}
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: e.target.value })
                  }
                />
              </label>
            ),
          )}
          <label className="field">
            팀 필수 검사
            <input
              readOnly={!admin}
              value={draft.requiredChecks.join(", ")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  requiredChecks: e.target.value
                    .split(",")
                    .map((x) => x.trim()),
                })
              }
            />
          </label>
          {admin ? (
            <button
              className="primary"
              disabled={!connected || busy}
              onClick={() =>
                submit(
                  () =>
                    send({
                      type: "publish_policy",
                      expectedVersion: p.version,
                      global: draft.global,
                      design: draft.design,
                      implementation: draft.implementation,
                      reviewer: draft.reviewer,
                      requiredChecks: draft.requiredChecks.filter(Boolean),
                    }),
                  "팀 지침의 새 버전을 게시했습니다.",
                )
              }
            >
              새 지침 버전 게시
            </button>
          ) : (
            <p className="document-info">관리자만 지침을 변경할 수 있습니다.</p>
          )}
        </section>
        <section>
          <h2>프로젝트별 기준</h2>
          {!project && (
            <p className="muted">
              프로젝트를 만든 뒤 프로젝트별 지침을 설정하세요. 전역 지침은 지금
              작성할 수 있습니다.
            </p>
          )}
          <select
            aria-label="설정할 프로젝트"
            disabled={!project}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {snapshot.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="field">
            필수 검사
            <input
              value={checks}
              readOnly={!admin || !project}
              onChange={(e) => setChecks(e.target.value)}
            />
          </label>
          <label className="field">
            프로젝트 지침
            <textarea
              readOnly={!admin || !project}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="프로젝트 구조, 명령, 환경, 도메인 규칙"
            />
          </label>
          <h4>필수 설계 검토자</h4>
          {snapshot.people
            .filter((p) => p.role !== "agent")
            .map((person) => (
              <label className="checkbox" key={person.id}>
                <input
                  type="checkbox"
                  disabled={!admin || !project}
                  checked={reviewers.includes(person.id)}
                  onChange={(e) =>
                    setReviewers(
                      e.target.checked
                        ? [...reviewers, person.id]
                        : reviewers.filter((id) => id !== person.id),
                    )
                  }
                />
                {person.name}
              </label>
            ))}
          {admin && (
            <button
              className="secondary spaced"
              disabled={!connected || busy || !project || !reviewers.length}
              onClick={() =>
                submit(
                  () =>
                    send({
                      type: "update_project_policy",
                      projectId,
                      requiredChecks: checks
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      reviewerIds: reviewers,
                      instructions,
                    }),
                  "프로젝트 기준을 저장했습니다. 기존 설계는 재리뷰가 필요합니다.",
                )
              }
            >
              프로젝트 기준 저장
            </button>
          )}
          <h3 className="spaced">변경 이력</h3>
          {[...snapshot.policies].reverse().map((v) => (
            <div className="history-row" key={v.version}>
              <span>v{v.version}</span>
              <span>
                {
                  snapshot.people
                    .find((p) => p.id === v.authorId)
                    ?.name.split(" ·")[0]
                }
              </span>
              <small>{new Date(v.at).toLocaleString("ko-KR")}</small>
              <details>
                <summary>내용 보기</summary>
                <p>{v.global}</p>
                <p>필수 검사: {v.requiredChecks.join(", ")}</p>
              </details>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function CreateDialog({
  kind,
  snapshot,
  defaultProject,
  send,
  onClose,
  onCreated,
}: {
  kind: "feature" | "project";
  snapshot: Snapshot;
  defaultProject: string;
  send: Send;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState(defaultProject);
  const [template, setTemplate] = useState<"feature" | "bug">("feature");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="modal-backdrop">
      <form
        className="create-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={kind === "feature" ? "새 기능" : "새 프로젝트"}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const result = await send(
              kind === "feature"
                ? {
                    type: "create_feature",
                    projectId,
                    title,
                    template,
                    requirements: description,
                  }
                : {
                    type: "create_project",
                    name: title,
                    description,
                    reviewerIds: ["owner"],
                  },
            );
            onCreated(result.entityId);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog-heading">
          <h2>{kind === "feature" ? "새 기능 시작" : "새 프로젝트"}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="닫기"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <p className="muted">
          {kind === "feature"
            ? "목표를 정리하고 팀 표준에 따라 설계부터 시작합니다."
            : "프로젝트별 기능과 검토 기준을 함께 관리합니다."}
        </p>
        {kind === "feature" && (
          <div className="form-pair">
            <label className="field">
              프로젝트
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {snapshot.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              개발 흐름
              <select
                value={template}
                onChange={(e) =>
                  setTemplate(e.target.value as "feature" | "bug")
                }
              >
                <option value="feature">신규 기능</option>
                <option value="bug">버그 수정</option>
              </select>
            </label>
          </div>
        )}
        <label className="field">
          {kind === "feature" ? "기능 이름" : "프로젝트 이름"}
          <input
            autoFocus
            required
            maxLength={kind === "feature" ? 160 : 80}
            placeholder={
              kind === "feature"
                ? "예: 주문 취소 시 환불 처리"
                : "예: Commerce API"
            }
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          {kind === "feature" ? "목표와 완료 기준" : "설명"}
          <textarea
            required
            value={description}
            placeholder="어떤 문제를 해결하고, 무엇을 확인하면 완료인가요?"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <footer>
          <button type="button" className="secondary" onClick={onClose}>
            취소
          </button>
          <button
            className="primary"
            disabled={busy || !title.trim() || !description.trim()}
          >
            {busy
              ? "저장 중…"
              : kind === "feature"
                ? "기능 만들기"
                : "프로젝트 만들기"}
          </button>
        </footer>
      </form>
    </div>
  );
}
