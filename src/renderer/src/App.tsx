import { useNavigationHistory } from "./workspace/useNavigationHistory";
import type { WorkspaceLocation } from "./workspace/navigation";
import type { SetupDestination } from "./workspace/ExecutionSetup";
import InstructionContext from "./workspace/InstructionContext";
import CommandPalette from "./workspace/CommandPalette";
import { Tabs, ResizeHandle, Dialog } from "./workspace/Controls";
import { workState, phases } from "./workspace/presentation";
import PackageSettings from "./PackageSettings";
import HarnessPanel from "./HarnessPanel";
import RuntimeSettings from "./RuntimeSettings";
import RunPanel from "./RunPanel";
import RunOverview from "./RunOverview";
import PortfolioOverview from "./PortfolioOverview";
import WorkspaceHome, { FlowRail } from "./WorkspaceHome";
import QualityIntelligence from "./QualityIntelligence";
import { activeStatuses } from "../../shared/runtime";
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  FileText,
  House,
  MessageSquare,
  PanelLeft,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
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
  sectionLabels,
  designSectionKey,
  designSectionLabel,
  type Snapshot,
  type Feature,
  type Command,
  type Design,
  type Thread,
} from "../../shared/contracts.ts";
import "./style.css";
import "./workspace/workspace.css";
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
const ago = (date: string) => {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
  return m < 1
    ? "Just now"
    : m < 60
      ? `${m} min ago`
      : `${Math.floor(m / 60)} hr ago`;
};
type Send = (command: Command) => Promise<any>;
type PortfolioState = NonNullable<WorkspaceLocation["portfolio"]>;
const initialPortfolio: PortfolioState = {
  projectScope: "all",
  query: "",
  attentionOnly: false,
  view: "flow",
  collapsedProjectIds: [],
  scrollTop: 0,
};

export default function App() {
  const actor = "owner";
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState("");
  const [acceptedSnapshotAt, setAcceptedSnapshotAt] = useState("");
  const [portfolioNow, setPortfolioNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState(readLocal("view", "list"));
  useEffect(() => saveLocal("view", view), [view]);
  const [scope, setScope] = useState(readLocal("scope", "inbox"));
  const [selected, setSelected] = useState<string | null>(
    readLocal("selected", null),
  );
  const [detailRunId, setDetailRunId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<
    "design" | "requirements" | "execution" | "policy"
  >(() =>
    readLocal(
      `tab:${readLocal<string | null>("selected", null) || ""}`,
      "design",
    ),
  );
  const [portfolio, setPortfolio] = useState<PortfolioState>(() =>
    readLocal("portfolio", initialPortfolio),
  );
  const [qualityProjectId, setQualityProjectId] = useState(() =>
    readLocal("quality-project", "all"),
  );
  useEffect(
    () => saveLocal("quality-project", qualityProjectId),
    [qualityProjectId],
  );
  const [query, setQuery] = useState("");
  const [navigationRestore, setNavigationRestore] = useState(0);
  const [search, setSearch] = useState(false);
  const settingsScopes = ["harness", "agents", "runtime", "policies"];
  const [settingsContext, setSettingsContext] = useState<
    { projectId: string; featureId?: string } | undefined
  >(() => readLocal("settings-context", undefined));
  const [runtimeSection, setRuntimeSection] = useState<
    "connection" | "profile"
  >("connection");
  useEffect(
    () => saveLocal("settings-context", settingsContext),
    [settingsContext],
  );
  const changeSettingsProject = (projectId: string) =>
    setSettingsContext((value) => ({ ...value, projectId }));
  const [notifications, setNotifications] = useState(false);
  const [modal, setModal] = useState<"feature" | "project" | null>(null);
  const [theme, setTheme] = useState(readLocal("theme", "system"));
  const [events, setEvents] = useState<
    { type: string; at: string; featureId?: string }[]
  >([]);
  const currentActor = useRef(actor);
  const acceptedRevision = useRef(-1);
  const defaultEntryApplied = useRef(false);
  const hadSavedLocation = useRef(
    !!localStorage.getItem(localKey("scope")) ||
      !!localStorage.getItem(localKey("selected")),
  );
  const portfolioReturnFocus = useRef<string | null>(null);
  currentActor.current = actor;
  const refresh = async (as = actor) => {
    if (window.roopre) {
      const data = await window.roopre.snapshot();
      if (data.revision >= acceptedRevision.current) {
        acceptedRevision.current = data.revision;
        setSnapshot(data);
        setAcceptedSnapshotAt(new Date().toISOString());
      }
      setConnected(true);
      setSyncError("");
      setLastSync(new Date().toISOString());
      return data;
    }
    const response = await fetch(`${API}/state`, {
      headers: { "x-devflow-actor": as },
    });
    if (!response.ok)
      throw new Error(
        "Unable to load the workspace. Check the API connection.",
      );
    const data = await response.json();
    if (currentActor.current === as) {
      if (data.revision >= acceptedRevision.current) {
        acceptedRevision.current = data.revision;
        setSnapshot(data);
        const at = new Date().toISOString();
        setLastSync(at);
        setAcceptedSnapshotAt(at);
      }
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
    if (!snapshot || defaultEntryApplied.current) return;
    defaultEntryApplied.current = true;
    if (hadSavedLocation.current) return;
    setScope("inbox");
  }, [snapshot]);
  useEffect(() => {
    const timer = window.setInterval(() => setPortfolioNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    saveLocal("scope", scope);
    saveLocal("selected", selected);
  }, [scope, selected]);
  useEffect(() => saveLocal("portfolio", portfolio), [portfolio]);
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
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const send: Send = async (command) => {
    if (!connected)
      throw new Error("Connection lost. Wait for sync, then try again.");
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
    snapshot?.features.filter((f) => workState(snapshot, f).attention).length ||
    0;
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
        (scope !== "blocked" || workState(snapshot, f).attention) &&
        (scope !== "queued" ||
          snapshot.runs.some(
            (r) => r.featureId === f.id && r.status === "queued",
          )) &&
        (!query ||
          `${f.title} ${snapshot.projects.find((p) => p.id === f.projectId)?.name}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    ) || [];
  const navigation = useNavigationHistory(
    {
      scope,
      selected,
      detailRunId,
      detailTab,
      query,
      settingsContext,
      runtimeSection,
      qualityProjectId,
      portfolio,
    },
    (location) => {
      // Settings own their drafts. Re-enter a history location with fresh
      // initial context without resetting forms on ordinary project changes.
      setNavigationRestore((value) => value + 1);
      setScope(location.scope);
      setSelected(location.selected);
      setDetailRunId(location.detailRunId || null);
      setDetailTab(location.detailTab || "design");
      setQuery(location.query);
      setSettingsContext(location.settingsContext);
      setRuntimeSection(location.runtimeSection);
      setQualityProjectId(location.qualityProjectId || "all");
      if (location.portfolio) setPortfolio(location.portfolio);
      if (location.scope === "portfolio" && location.portfolio?.selectionRef)
        portfolioReturnFocus.current = `${location.portfolio.selectionRef.featureId}:${location.portfolio.selectionRef.runId || ""}:${location.portfolio.selectionRef.attempt || ""}:${location.portfolio.selectionRef.agentExecutionId || ""}`;
    },
    (location) => {
      if (!snapshot) return false;
      if (location.selected)
        return snapshot.features.some((f) => f.id === location.selected);
      if (
        location.settingsContext &&
        !snapshot.projects.some(
          (p) => p.id === location.settingsContext?.projectId,
        )
      )
        return false;
      return (
        [
          "inbox",
          "all",
          "blocked",
          "queued",
          "portfolio",
          "quality",
          ...settingsScopes,
        ].includes(location.scope) ||
        snapshot.projects.some((p) => p.id === location.scope)
      );
    },
  );
  useEffect(() => {
    if (scope !== "portfolio" || selected) return;
    const target = portfolioReturnFocus.current;
    if (!target) return;
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `[data-portfolio-focus="${CSS.escape(target)}"]`,
        )
        ?.focus(),
    );
  }, [navigationRestore, scope, selected, portfolio]);
  const navigate = (next: string) => {
    if (settingsScopes.includes(next)) {
      const projectId = feature?.projectId ?? project?.id;
      if (projectId) setSettingsContext({ projectId, featureId: feature?.id });
    } else setSettingsContext(undefined);
    setScope(next);
    setSelected(null);
    setQuery("");
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && ["[", "]"].includes(e.key)) {
        const target = e.target as HTMLElement;
        if (
          modal ||
          search ||
          target.closest(
            'input, textarea, select, [contenteditable="true"], [role="dialog"]',
          )
        )
          return;
        e.preventDefault();
        navigation.move(e.key === "[" ? -1 : 1);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (!modal) setSearch((s) => !s);
      }
      if (e.key === "Escape") {
        setModal(null);
        setSearch(false);
      }
      if ((e.metaKey || e.ctrlKey) && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        if (modal || search) return;
        navigate(
          e.key === "1"
            ? "inbox"
            : e.key === "2"
              ? "all"
              : e.key === "3"
                ? "quality"
                : "queued",
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [modal, search, navigate, navigation]);
  const openSetup = (destination: SetupDestination) => {
    if (destination === "connection" || destination === "profile") {
      setRuntimeSection(destination);
      navigate("runtime");
    } else navigate(destination);
  };
  const returnFeature = snapshot?.features.find(
    (f) => f.id === settingsContext?.featureId,
  );
  return (
    <div className="app">
      <header className="titlebar">
        <span className="window-space" />
        <span className="app-wordmark">{APP_NAME}</span>
        <span className="titlebar-divider" />
        <span className="caption">Agentic Development Environment</span>
        <nav className="workspace-history" aria-label="Navigation history">
          <button
            className="icon-button"
            aria-label="Go back"
            title="Go back (⌘[ / Ctrl+[)"
            disabled={!navigation.canBack || modal !== null || search}
            onClick={() => navigation.move(-1)}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Go forward"
            title="Go forward (⌘] / Ctrl+])"
            disabled={!navigation.canForward || modal !== null || search}
            onClick={() => navigation.move(1)}
          >
            <ArrowRight size={15} />
          </button>
        </nav>
        <div className="titlebar-right">
          <button
            className="icon-button notification-button"
            aria-label="Notifications"
            onClick={() => setNotifications(!notifications)}
          >
            <Bell size={15} />
            {events.length > 0 && <i />}
          </button>
          <span className={`connection ${connected ? "" : "offline"}`}>
            <span className="dot" />
            {connected ? "Synced" : "Connecting"}
          </span>
          <select
            className="theme-select"
            aria-label="Appearance"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <div className="team">
            <img className="team-mark" src={appIcon} alt="Roopre" />
            <div>
              <strong>roopre</strong>
              <small>Development workspace</small>
            </div>
          </div>
          <button
            className="search-button"
            aria-label="Search commands and work"
            onClick={() => setSearch(true)}
          >
            <Search size={15} /> Search <kbd>⌘ K</kbd>
          </button>
          <nav aria-label="Main navigation">
            <Nav
              active={scope === "inbox" && !selected}
              icon={<House size={17} />}
              label="Home"
              count={inboxCount}
              onClick={() => navigate("inbox")}
            />
            <Nav
              active={scope === "all" && !selected}
              icon={<PanelLeft size={17} />}
              label="Work"
              onClick={() => navigate("all")}
            />
            <Nav
              active={scope === "quality" && !selected}
              icon={<ShieldCheck size={17} />}
              label="Quality"
              onClick={() => navigate("quality")}
            />
            <Nav
              active={scope === "queued" && !selected}
              icon={<Bot size={17} />}
              label="Agents"
              count={
                snapshot?.runs.filter((r) => activeStatuses.includes(r.status))
                  .length
              }
              onClick={() => navigate("queued")}
            />
          </nav>
          <div className="nav-section">
            <span>Projects</span>
            {me?.role === "admin" && (
              <button
                className="icon-button"
                aria-label="Add project"
                onClick={() => setModal("project")}
              >
                <Plus size={15} />
              </button>
            )}
          </div>
          <nav aria-label="Projects">
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
                          <i
                            className={`tree-state ${workState(snapshot, f).tone}`}
                          />
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
              active={settingsScopes.includes(scope) && !selected}
              icon={<Settings2 size={17} />}
              label="Settings"
              onClick={() => navigate("harness")}
            />
            {window.roopre?.onboarding && (
              <Nav
                active={false}
                icon={<CircleDot size={17} />}
                label="Getting started"
                onClick={() =>
                  window.dispatchEvent(new Event("roopre:onboarding"))
                }
              />
            )}
            {window.roopre ? (
              <div className="profile">
                <div className="avatar">You</div>
                <span>
                  Project owner
                  <br />
                  <small>Design review and approval</small>
                </span>
              </div>
            ) : (
              <div className="profile">
                <div className="avatar">You</div>
                <span>
                  Local preview
                  <br />
                  <small>Review plans and approval status.</small>
                </span>
              </div>
            )}
          </div>
        </aside>
        <main className="workspace">
          {settingsScopes.includes(scope) && !feature && (
            <nav
              className="settings-navigation"
              aria-label="Settings navigation"
            >
              <span>
                <Settings2 size={14} />
                Settings
              </span>
              {[
                ["harness", "Harness standards"],
                ["agents", "Agents & workflow"],
                ["runtime", "Standards, connections & runtime"],
                ["policies", "Instructions & team"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-current={scope === id ? "page" : undefined}
                  onClick={() => navigate(id)}
                >
                  {label}
                </button>
              ))}
              {returnFeature && (
                <button
                  className="settings-return"
                  title={`Only saved settings take effect. ${returnFeature.title} Back to work`}
                  onClick={() => {
                    setScope(returnFeature.projectId);
                    setSelected(returnFeature.id);
                    setSettingsContext(undefined);
                  }}
                >
                  <ArrowLeft size={13} /> Back to work
                </button>
              )}
            </nav>
          )}
          {!connected && snapshot && (
            <div className="offline-banner">
              <WifiOff size={16} />
              Last synced {lastSync ? ago(lastSync) : "Unknown"} · Read-only;
              drafts remain available.
            </div>
          )}
          {syncError && (
            <div className="error-banner" role="alert">
              Reconnecting · {syncError} · Your workspace is preserved while we
              reconnect.
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!snapshot ? (
            <div className="loading">
              <LoaderCircle size={24} className="spin" />
              <h2>Loading workspace</h2>
              <p>Checking the local API and database connection.</p>
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
              initialTab={detailTab}
              onTabChange={setDetailTab}
              detailRunId={detailRunId}
              onSelectRun={setDetailRunId}
              onBack={() => {
                setSelected(null);
                requestAnimationFrame(() => {
                  const target = portfolioReturnFocus.current;
                  if (!target) return;
                  document
                    .querySelector<HTMLElement>(
                      `[data-portfolio-focus="${CSS.escape(target)}"]`,
                    )
                    ?.focus();
                });
              }}
              onSetup={openSetup}
            />
          ) : scope === "queued" && window.roopre ? (
            <RunOverview
              snapshot={snapshot}
              onSelect={(id, runId) => {
                localStorage.setItem(`ade:run:${id}`, runId);
                saveLocal(`tab:${id}`, "execution");
                setDetailRunId(runId);
                setDetailTab("execution");
                setSelected(id);
              }}
            />
          ) : scope === "portfolio" ? (
            <PortfolioOverview
              snapshot={snapshot}
              acceptedAt={acceptedSnapshotAt}
              fetchError={syncError}
              now={portfolioNow}
              state={portfolio}
              onStateChange={setPortfolio}
              onOpen={(ref, destination) => {
                if (!ref.featureId) return;
                portfolioReturnFocus.current = `${ref.featureId}:${ref.runId || ""}:${ref.attempt || ""}:${ref.agentExecutionId || ""}`;
                if (ref.runId)
                  localStorage.setItem(`ade:run:${ref.featureId}`, ref.runId);
                saveLocal(
                  `tab:${ref.featureId}`,
                  destination === "design" ? "design" : "execution",
                );
                setDetailRunId(ref.runId || null);
                setDetailTab(destination === "design" ? "design" : "execution");
                setSelected(ref.featureId);
              }}
            />
          ) : scope === "quality" ? (
            <QualityIntelligence
              snapshot={snapshot}
              projectId={qualityProjectId}
              onProjectId={setQualityProjectId}
              onOpen={(featureId, runId) => {
                localStorage.setItem(`ade:run:${featureId}`, runId);
                saveLocal(`tab:${featureId}`, "execution");
                setDetailRunId(runId);
                setDetailTab("execution");
                setSelected(featureId);
              }}
            />
          ) : scope === "harness" ? (
            <PackageSettings
              key={navigationRestore}
              snapshot={snapshot}
              send={send}
              refresh={refresh}
              initialProjectId={settingsContext?.projectId}
              onProjectChange={changeSettingsProject}
            />
          ) : scope === "agents" ? (
            <HarnessPanel
              key={navigationRestore}
              snapshot={snapshot}
              send={send}
              onSaved={refresh}
              initialProjectId={settingsContext?.projectId}
              onProjectChange={changeSettingsProject}
            />
          ) : scope === "runtime" ? (
            <RuntimeSettings
              key={navigationRestore}
              snapshot={snapshot}
              onSaved={refresh}
              initialProjectId={settingsContext?.projectId}
              onProjectChange={changeSettingsProject}
              focusSection={runtimeSection}
            />
          ) : scope === "policies" ? (
            <PolicyView
              key={navigationRestore}
              snapshot={snapshot}
              actor={actor}
              send={send}
              act={act}
              connected={connected}
              initialProjectId={settingsContext?.projectId}
              onProjectChange={changeSettingsProject}
            />
          ) : !snapshot.projects.length ? (
            <div className="content-page">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">Get started</div>
                  <h1>Start with your project</h1>
                  <p>
                    Connect a repository and model, then define your first
                    feature.
                  </p>
                  <button
                    className="primary spaced"
                    disabled={!connected}
                    onClick={() => setModal("project")}
                  >
                    <Plus size={16} />
                    Create project
                  </button>
                </div>
              </div>
            </div>
          ) : scope === "inbox" ? (
            <WorkspaceHome
              snapshot={snapshot}
              connected={connected}
              onOpen={(featureId, destination) => {
                // Home rows always describe the current feature state. Clear a
                // prior evidence inspection so this action cannot reopen an
                // older run selected in the detail workspace.
                localStorage.removeItem(`ade:run:${featureId}`);
                saveLocal(
                  `tab:${featureId}`,
                  destination === "design" ? "design" : "execution",
                );
                setDetailRunId(null);
                setDetailTab(destination === "design" ? "design" : "execution");
                setSelected(featureId);
              }}
              onProject={(projectId) => navigate(projectId)}
              onPortfolio={() => navigate("portfolio")}
              onAttention={() => navigate("blocked")}
              onQuality={() => navigate("quality")}
              onRuns={() => navigate("queued")}
              onCreate={() => setModal("feature")}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {project ? "Projects" : "Workspace"}
                  </div>
                  <h1>
                    {project?.name ||
                      (
                        {
                          all: "All work",
                          blocked: "Needs attention",
                          queued: "Queued",
                        } as Record<string, string>
                      )[scope]}
                  </h1>
                  <p>
                    {project?.description ||
                      (scope === "inbox"
                        ? "Review decisions and blockers first."
                        : "Follow features and next steps across projects.")}
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => setModal("feature")}
                  disabled={!connected}
                >
                  <Plus size={16} />
                  New feature
                </button>
              </div>
              <div className="list-toolbar">
                <div className="view-tabs">
                  <button
                    className={view === "list" ? "active" : ""}
                    onClick={() => setView("list")}
                  >
                    <FileText size={15} />
                    List <span>{visible.length}</span>
                  </button>
                  <button
                    className={view === "board" ? "active" : ""}
                    onClick={() => setView("board")}
                  >
                    Board
                  </button>
                </div>
                <label className="inline-search">
                  <Search size={15} />
                  <input
                    aria-label="Search features"
                    placeholder="Search features"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {view === "board" ? (
                <div className="phase-board" aria-label="Development board">
                  {phases.map((label, phase) => (
                    <section key={phase}>
                      <h3>
                        {label}
                        <span>
                          {
                            visible.filter(
                              (f) => workState(snapshot, f).phase === phase,
                            ).length
                          }
                        </span>
                      </h3>
                      {visible
                        .filter((f) => workState(snapshot, f).phase === phase)
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
                              {snapshot.gates[f.id].required} approved
                            </span>
                          </button>
                        ))}
                    </section>
                  ))}
                </div>
              ) : (
                <div className="feature-table" role="region" aria-label="List">
                  <div className="table-head">
                    <span>Feature</span>
                    <span>Stage</span>
                    <span>Next action</span>
                    <span>Updated</span>
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
                              {f.template === "bug" ? "Bug fix" : "New feature"}
                              {g.blockers > 0 && (
                                <span className="blocking-note">
                                  Blocking comments {g.blockers}
                                </span>
                              )}
                            </small>
                          </div>
                        </div>
                        <span
                          className={`work-state ${workState(snapshot, f).tone}`}
                        >
                          <i />
                          {workState(snapshot, f).label}
                        </span>
                        <span
                          className="list-next"
                          title={workState(snapshot, f).next}
                        >
                          <small>{workState(snapshot, f).actor}</small>
                          {workState(snapshot, f).next}
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
                      <h3>Nothing needs attention</h3>
                      <p>Create a feature or select another project.</p>
                    </div>
                  )}
                </div>
              )}
              <div className="workspace-note">
                <ShieldCheck size={17} />
                <div>
                  <strong>Implementation starts after design approval.</strong>
                  <p>
                    All required approvals and blocking comments must be
                    resolved.
                  </p>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      {notifications && (
        <aside className="notification-panel" aria-label="Notification list">
          <header>
            <strong>Notifications</strong>
            <button
              className="icon-button"
              aria-label="Close notifications"
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
                    ?.title || "Team instructions"}
                  <small>
                    {
                      (
                        {
                          publish_design: "Design review requested",
                          review: "Approval updated",
                          add_thread: "New review comment",
                          resolve_thread: "Comment resolved",
                          queue_run: "Run queued",
                          publish_policy: "Instructions updated",
                          update_project_policy: "Project standards updated",
                        } as Record<string, string>
                      )[e.type]
                    }{" "}
                    · {ago(e.at)}
                  </small>
                </span>
              </button>
            ))}
          {!events.length && (
            <p>Review requests and changes appear here while connected.</p>
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
        <CommandPalette
          snapshot={snapshot}
          connected={connected}
          onClose={() => setSearch(false)}
          onSelect={setSelected}
          navigate={navigate}
          create={setModal}
        />
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
    <button
      className={`nav-item ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
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
  onSetup,
  initialTab,
  onTabChange,
  detailRunId,
  onSelectRun,
}: {
  snapshot: Snapshot;
  feature: Feature;
  actor: string;
  connected: boolean;
  send: Send;
  act: (fn: () => Promise<any>, success?: string) => Promise<void>;
  onBack: () => void;
  onSetup: (destination: SetupDestination) => void;
  initialTab: "design" | "requirements" | "execution" | "policy";
  onTabChange: (
    tab: "design" | "requirements" | "execution" | "policy",
  ) => void;
  detailRunId: string | null;
  onSelectRun: (runId: string | null) => void;
}) {
  const [reviewWidth, setReviewWidth] = useState(
    Math.max(280, Math.min(400, readLocal(`review-width:${f.id}`, 320))),
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
  const initialTabValue = useRef(initialTab);
  const [tab, setTab] = useState(() => readLocal(`tab:${f.id}`, initialTab));
  useEffect(() => {
    if (initialTabValue.current === initialTab) return;
    initialTabValue.current = initialTab;
    setTab(initialTab);
  }, [initialTab]);
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
  // The main process creates this from the displayed design and policy
  // snapshot. The renderer never creates or reuses a proof locally.
  const confirmationBinding = snapshot.approvalBindings?.[f.id] || "";
  const simpleLocalApproval = snapshot.mode === "local-owner";
  const [compare, setCompare] = useState(false);
  const [checked, setChecked] = useState<(typeof sections)[number][]>(() =>
    readLocal(`checks:${actor}:${latest?.id}`, []),
  );
  const [section, setSection] = useState<(typeof sections)[number]>(
    sections[0],
  );
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
    setSection(sections[0]);
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
  const state = workState(snapshot, f);
  const threadItems = f.threads.filter(
    (t) => threadFilter === "all" || t.status !== "resolved",
  );
  return (
    <div
      className={`feature-detail ${tab === "execution" ? "is-execution" : ""}`}
    >
      <div className="detail-heading">
        <button
          className="icon-button"
          aria-label="Back to features"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <span>{snapshot.projects.find((p) => p.id === f.projectId)?.name}</span>
        <ChevronRight size={13} />
        <span>{f.template === "bug" ? "Bug fix" : "New feature"}</span>
        <div className="detail-heading-end">
          <span className={`work-state ${state.tone}`}>
            <i />
            {state.label}
          </span>
        </div>
      </div>
      <div className="feature-title">
        <div>
          <h1>{f.title}</h1>
          <p title={f.draft.requirements}>{f.draft.requirements}</p>
        </div>
      </div>
      <div className="work-context">
        <FlowRail state={state} />
        <button
          className={`next-action ${state.tone}`}
          title={state.next}
          onClick={() =>
            setTab(state.phase >= 2 || g.eligible ? "execution" : "design")
          }
        >
          <span className="actor-label">
            {state.actor === "HUMAN"
              ? "Your action"
              : state.actor === "AGENT"
                ? "Agent activity"
                : "System checks"}
          </span>
          <span>{state.next}</span>
          <ArrowRight size={13} />
        </button>
      </div>
      <Tabs
        className="detail-tabs"
        label="Feature details"
        value={tab}
        onChange={(next) => {
          setTab(next as typeof tab);
          onTabChange(next as typeof tab);
        }}
        items={[
          {
            id: "design",
            label: (
              <>
                Plan{" "}
                {g.blockers > 0 && (
                  <span className="tab-counter">{g.blockers}</span>
                )}
              </>
            ),
          },
          { id: "requirements", label: "Edit requirements" },
          { id: "execution", label: "Build & verify" },
          { id: "policy", label: "Rules" },
        ]}
      />
      {tab === "design" ? (
        <div
          className="review-layout"
          style={
            { "--review-width": `${reviewWidth}px` } as React.CSSProperties
          }
        >
          <section className="design-panel" aria-label="Design document">
            <div className="document-toolbar">
              <div>
                <FileText size={16} />
                {edit ? (
                  <strong>Design draft</strong>
                ) : (
                  <select
                    aria-label="Design version"
                    value={d?.id || ""}
                    onChange={(e) => setVersion(e.target.value)}
                  >
                    {f.designs.map((d) => (
                      <option key={d.id} value={d.id}>
                        Design v{d.number}
                        {d.id === latest?.id ? "· Latest" : ""}
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
                    Compare versions
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
                    {edit && latest ? "View published" : "Edit design"}
                  </button>
                )}
              </div>
            </div>
            {!isLatest && !edit && (
              <div className="document-info">
                This is an older version. Add approvals and comments to the
                latest design.
              </div>
            )}
            {edit && draft.revision !== f.draft.revision && (
              <div className="conflict" role="alert">
                A newer draft is available. Your local edits are preserved
                below.
                <details>
                  <summary>View server draft</summary>
                  <pre>{f.draft.body}</pre>
                </details>
                <button
                  onClick={() =>
                    updateDraft({ ...draft, revision: f.draft.revision })
                  }
                >
                  Keep my draft and save again
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
                    Goal and acceptance criteria
                    <textarea
                      aria-label="Requirements draft"
                      value={draft.requirements}
                      onChange={(e) =>
                        updateDraft({ ...draft, requirements: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Design document
                    <textarea
                      className="design-editor"
                      aria-label="Design draft"
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
                <div className="empty">Write a design and request review.</div>
              )}
            </div>
            {edit && editable && (
              <footer className="document-footer">
                <span className="muted">Drafts are saved on this device.</span>
                <button
                  className="secondary"
                  disabled={busy || !connected}
                  onClick={() => operation(save, "Design draft saved.")}
                >
                  Save draft
                </button>
                <button
                  className="primary"
                  disabled={busy || !connected}
                  onClick={() =>
                    operation(publish, "Design published and review requested.")
                  }
                >
                  Request review
                </button>
              </footer>
            )}
          </section>
          <ResizeHandle
            value={reviewWidth}
            onChange={setReviewWidth}
            min={280}
            max={400}
            label="Review panel width"
          />
          <aside className="review-panel" aria-label="Design review">
            <div className="review-panel-title">
              <strong>
                <span className="actor-label">HUMAN</span> Design review
              </strong>
              <span>
                {g.approved}/{g.required} approved
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
                        "Changes requested"
                      ) : (
                        "Pending"
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="review-scroll">
              {reviewer && isLatest && d && !edit && simpleLocalApproval && (
                <DesignReviewReport design={d} />
              )}
              <div className="thread-heading">
                <strong>
                  Review comments{" "}
                  <span>
                    {f.threads.filter((t) => t.status !== "resolved").length}
                  </span>
                </strong>
                <select
                  aria-label="Filter review comments"
                  value={threadFilter}
                  onChange={(e) => setThreadFilter(e.target.value)}
                >
                  <option value="open">Open</option>
                  <option value="all">All</option>
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
                    ? "No open comments."
                    : "No review comments yet."}
                </p>
              )}
              {isLatest && d && !edit && (
                <div className="comment-form">
                  <label>
                    Review section
                    <select
                      aria-label="Review section"
                      value={section}
                      onChange={(e) =>
                        setSection(e.target.value as (typeof sections)[number])
                      }
                    >
                      {sections.map((s) => (
                        <option key={s} value={s}>
                          {sectionLabels[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {quote && (
                    <blockquote>
                      {quote}
                      <button
                        className="icon-button"
                        aria-label="Clear quote"
                        onClick={() => setQuote("")}
                      >
                        <X size={12} />
                      </button>
                    </blockquote>
                  )}
                  <textarea
                    id="review-comment"
                    aria-label="Review comments"
                    placeholder="Leave a question or suggest a change."
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
                        }, "Review comment added.");
                    }}
                  />
                  <div>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={blocking}
                        onChange={(e) => setBlocking(e.target.checked)}
                      />
                      Block implementation until resolved
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
                        }, "Review comment added.")
                      }
                    >
                      Add comment
                    </button>
                  </div>
                </div>
              )}
              {reviewer && isLatest && d && !edit && !simpleLocalApproval && (
                <div className="review-checklist">
                  <h4>
                    Design review checklist <span>{checked.length}/7</span>
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
                      {sectionLabels[s]}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <footer className="review-footer">
              {g.blockers > 0 && (
                <p>
                  <AlertCircle size={14} />
                  {g.blockers} blocking comments need resolution
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
                            checked: simpleLocalApproval ? [] : checked,
                          }),
                        "Changes requested.",
                      )
                    }
                  >
                    Request changes
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
                              checked: simpleLocalApproval ? [] : checked,
                            }),
                          "Approval withdrawn.",
                        )
                      }
                    >
                      Withdraw approval
                    </button>
                  ) : (
                    <button
                      className="primary"
                      disabled={
                        !connected ||
                        busy ||
                        (!simpleLocalApproval && checked.length !== 7) ||
                        (simpleLocalApproval && !confirmationBinding) ||
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
                              checked: simpleLocalApproval ? [] : checked,
                              ...(simpleLocalApproval
                                ? { confirmationBinding }
                                : {}),
                            }),
                          `Design v${d.number} approved.`,
                        )
                      }
                    >
                      <ShieldCheck size={15} />
                      Approve design v{d.number}
                    </button>
                  )}
                </div>
              ) : (
                <p className="muted">
                  {editable
                    ? "Waiting for required design approvals."
                    : "Review the latest published version."}
                </p>
              )}
            </footer>
          </aside>
        </div>
      ) : tab === "requirements" ? (
        <div className="content-page">
          <h2>Goal and acceptance criteria</h2>
          <p className="preserve">{d?.requirements || f.draft.requirements}</p>
          <h3>Dependencies</h3>
          <p className="muted">
            Implementation waits until dependencies are integrated.
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
                      "Dependencies saved.",
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
          <h2>Effective instructions</h2>
          <p className="muted">
            {run
              ? "Instructions captured for the latest run."
              : "Preview before execution: published design and team instructions."}
          </p>
          {run ? (
            <pre className="policy-text">{run.effectivePolicy}</pre>
          ) : (
            <>
              <InstructionContext snapshot={snapshot} feature={f} />
              {[
                ["Global instructions", snapshot.policies.at(-1)!.global],
                [
                  "Projects",
                  snapshot.projects
                    .find((p) => p.id === f.projectId)!
                    .requiredChecks.join(" · "),
                ],
                [
                  "Project instructions",
                  snapshot.projects.find((p) => p.id === f.projectId)!
                    .instructions || "No additional instructions",
                ],
                ["Planning stage", snapshot.policies.at(-1)!.design],
                [
                  "Implementation stage",
                  snapshot.policies.at(-1)!.implementation,
                ],
                ["Reviewer role", snapshot.policies.at(-1)!.reviewer],
                ["This feature", d?.requirements || f.draft.requirements],
              ].map(([title, body]) => (
                <section className="policy-section" key={title}>
                  <h3>
                    {designSectionLabel(title)}
                    <small>Team v{snapshot.policies.at(-1)!.version}</small>
                  </h3>
                  <p>{body}</p>
                </section>
              ))}
            </>
          )}
        </div>
      ) : snapshot.mode === "local-owner" ? (
        <RunPanel
          snapshot={snapshot}
          feature={f}
          selectedRunId={detailRunId}
          onSelectRun={onSelectRun}
          send={send}
          connected={connected}
          onDesign={() => setTab("design")}
          onSetup={onSetup}
        />
      ) : (
        <div className="content-page">
          <div className="execution-heading">
            <div>
              <h2>Execution and verification</h2>
              <p className="muted">
                This workspace records run requests and approvals. Connect a
                runner to execute agents and tests.
              </p>
            </div>
            <Terminal size={28} />
          </div>
          <div className="execution-status">
            <Clock3 size={20} />
            <div>
              <strong>
                {run?.status === "blocked"
                  ? "Run blocked"
                  : run?.status === "queued"
                    ? "Run queued"
                    : "Runner disconnected"}
              </strong>
              <p>{run?.reason || "Queue a run after design approval."}</p>
            </div>
          </div>
          <h3>Implementation gate</h3>
          <ul className="gate-list">
            {g.eligible ? (
              <li className="ok">
                <Check size={16} />
                All required approvals are complete for the latest design.
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
                      "Queued run cancelled.",
                    )
                  }
                >
                  Cancel queued run
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
                      "Run queued. Connect the runner to execute it.",
                    )
                  }
                >
                  <Play size={15} />
                  Queue implementation
                </button>
              )}
            </div>
          )}
          <div className="result-placeholder">
            <FileText size={24} />
            <h3>No verification results yet</h3>
            <p>Only checks that actually ran appear here.</p>
          </div>
          <button className="soft" onClick={() => setLog(!log)}>
            {log ? "Hide run history" : "Show run history"}
            <ChevronDown size={14} />
          </button>
          {log && (
            <pre className="policy-text">
              {snapshot.runs
                .filter((r) => r.featureId === f.id)
                .map((r) => `${r.at}\n${r.id} · ${r.status}\n${r.reason}`)
                .join("\n\n") || "No runs"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function designSection(body: string, title: (typeof sections)[number]) {
  const block = body
    .split(/^## /m)
    .find((candidate) => designSectionKey(candidate.split("\n")[0]) === title);
  return block?.split("\n").slice(1).join("\n").trim() || "";
}

function DesignReviewReport({ design }: { design: Design }) {
  const report = [
    ["Requirements", design.requirements],
    ["Failure cases", designSection(design.body, sections[3])],
    ["Change impact", designSection(design.body, sections[4])],
    ["Verification plan", designSection(design.body, sections[5])],
  ] as const;
  return (
    <section className="design-review-report" aria-label="Design review brief">
      <h4>Design review brief</h4>
      <p className="muted">Review these points in the published design.</p>
      {report.map(([title, body]) =>
        body ? (
          <section key={title}>
            <strong>{title}</strong>
            <ReportMarkdown body={body} />
          </section>
        ) : null,
      )}
    </section>
  );
}

function ReportMarkdown({ body }: { body: string }) {
  const inline = (text: string) => {
    const parts = text.split("**");
    return parts.map((part, index) =>
      index % 2 ? <strong key={index}>{part}</strong> : part,
    );
  };
  return (
    <div className="report-markdown">
      {body.split(/\n{2,}/).map((block, index) => {
        const lines = block.split("\n").filter(Boolean);
        const list = lines.every((line) => /^[-*]\s+/.test(line));
        return list ? (
          <ul key={index}>
            {lines.map((line, lineIndex) => (
              <li key={`${index}-${lineIndex}`}>
                {inline(line.replace(/^[-*]\s+/, ""))}
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            {lines.map((line, lineIndex) => (
              <React.Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {inline(line)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
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
          <span>Added or changed</span>
          <span>Previous</span>
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
                {designSectionLabel(title)}
              </h2>
              <button
                className="icon-button"
                aria-label={`Add a comment on ${designSectionLabel(title)}`}
                onClick={() =>
                  onComment(
                    designSectionKey(title) ?? sections[0],
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
            ? "Confirm resolution"
            : t.status === "addressed"
              ? "Resolution requested"
              : t.blocking
                ? "Blocking"
                : "Note"}
        </small>
      </div>
      <div className="thread-anchor">
        <MessageSquare size={12} />
        {designSectionLabel(t.section)} · v
        {f.designs.find((d) => d.id === t.designId)?.number}
        {t.designId !== latestDesign(f)?.id && "· Previous version"}
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
          replies {t.replies.length || ""}
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
                  "Comment resolved.",
                )
              }
            >
              <Check size={13} />
              Confirm resolution
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
                  "Resolution requested from the reviewer.",
                )
              }
            >
              Mark addressed
            </button>
          ) : null)}
      </div>
      {showReply && (
        <div className="reply-form">
          <textarea
            aria-label="Review reply"
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
              }, "Reply saved.")
            }
          >
            Post reply
          </button>
        </div>
      )}
    </div>
  );
}

function PolicyView({
  snapshot,
  initialProjectId,
  onProjectChange,
  actor,
  send,
  act,
  connected,
}: {
  snapshot: Snapshot;
  initialProjectId?: string;
  onProjectChange?: (id: string) => void;
  actor: string;
  send: Send;
  act: (fn: () => Promise<any>, success?: string) => Promise<void>;
  connected: boolean;
}) {
  const p = snapshot.policies.at(-1)!;
  const [draft, setDraft] = useState(p);
  const [busy, setBusy] = useState(false);
  const admin = snapshot.people.find((p) => p.id === actor)?.role === "admin";
  const [projectId, setProjectId] = useState(
    initialProjectId && snapshot.projects.some((p) => p.id === initialProjectId)
      ? initialProjectId
      : (snapshot.projects[0]?.id ?? ""),
  );
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
          <div className="eyebrow">Shared team standards</div>
          <h1>Instructions & team</h1>
          <p>Keep required checks consistent and record each revision.</p>
        </div>
        <span className="version-badge">Current v{p.version}</span>
      </div>
      <div className="policy-content">
        <section>
          <h2>Team, stage & role instructions</h2>
          <p className="muted">
            Publishing a version requires existing designs to be reviewed again.
            Required checks cannot be removed.
          </p>
          {(["global", "design", "implementation", "reviewer"] as const).map(
            (field, i) => (
              <label className="field" key={field}>
                {
                  [
                    "Global instructions",
                    "Planning instructions",
                    "Implementation instructions",
                    "Reviewer instructions",
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
            Team required checks
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
                  "New instruction version published.",
                )
              }
            >
              Publish instructions
            </button>
          ) : (
            <p className="document-info">
              Only administrators can update team instructions.
            </p>
          )}
        </section>
        <section>
          <h2>Project standards</h2>
          {!project && (
            <p className="muted">
              Create a project to set its instructions. Global instructions are
              available now.
            </p>
          )}
          <select
            aria-label="Project to configure"
            disabled={!project}
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
          <label className="field">
            Required checks
            <input
              value={checks}
              readOnly={!admin || !project}
              onChange={(e) => setChecks(e.target.value)}
            />
          </label>
          <label className="field">
            Project instructions
            <textarea
              readOnly={!admin || !project}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Repository structure, commands, environment and domain rules"
            />
          </label>
          <h4>Required design reviewers</h4>
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
                  "Project standards saved. Existing designs require another review.",
                )
              }
            >
              Save project standards
            </button>
          )}
          <h3 className="spaced">Version history</h3>
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
                <summary>View details</summary>
                <p>{v.global}</p>
                <p>Required checks: {v.requiredChecks.join(", ")}</p>
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
    <Dialog
      label={kind === "feature" ? "New feature" : "New project"}
      onClose={onClose}
      className="create-dialog-container"
    >
      <form
        className="create-dialog"
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
          <h2>{kind === "feature" ? "Start a feature" : "New project"}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <p className="muted">
          {kind === "feature"
            ? "Define the goal, then plan using your team's standards."
            : "Manage features and review criteria by project."}
        </p>
        {kind === "feature" && (
          <div className="form-pair">
            <label className="field">
              Projects
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
              Development workspace
              <select
                value={template}
                onChange={(e) =>
                  setTemplate(e.target.value as "feature" | "bug")
                }
              >
                <option value="feature">New feature</option>
                <option value="bug">Bug fix</option>
              </select>
            </label>
          </div>
        )}
        <label className="field">
          {kind === "feature" ? "Feature name" : "Project name"}
          <input
            autoFocus
            required
            maxLength={kind === "feature" ? 160 : 80}
            placeholder={
              kind === "feature"
                ? "e.g. Refund cancelled orders"
                : "e.g. Commerce API"
            }
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          {kind === "feature" ? "Goal and acceptance criteria" : "Description"}
          <textarea
            required
            value={description}
            placeholder="What problem does this solve, and how will you verify completion?"
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
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || !title.trim() || !description.trim()}
          >
            {busy
              ? "Saving…"
              : kind === "feature"
                ? "Create feature"
                : "Create project"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
