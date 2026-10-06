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
          <h1>Standards, connections & runtime</h1>
          <p>Follow consistent steps and review evidence before continuing.</p>
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
          Applied team standard v{snapshot.policies.at(-1)!.version}
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
          Required checks:{" "}
          {snapshot.policies.at(-1)!.requiredChecks.join(" · ")}. Project
          settings cannot remove these checks.
        </p>
      </details>
      {!desktop ? (
        <section className="runtime-card">
          <h2>Connect in the desktop app</h2>
          <p>
            API keys, repository selection and design approvals are available in
            the desktop app. This browser is a local development preview.
          </p>
        </section>
      ) : (
        <>
          <section className="runtime-card execution-capacity-card">
            <div className="runtime-section-heading">
              <div>
                <h2>Execution capacity</h2>
                <p>
                  Each feature uses an isolated worktree, including concurrent
                  features in the same project.
                </p>
              </div>
              <span className="host-state">
                Up to {capacity.maxConcurrentRuns} runs · Per project{" "}
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
                    "Capacity saved. Active runs continue; new limits apply to subsequent runs.",
                  );
                });
              }}
            >
              <div className="runtime-grid">
                <label className="field">
                  Workspace run limit
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
                  Runs per project
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
                  Parallel agents per stage
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
                Save execution capacity
              </button>
              <p className="muted">
                Defaults: 3 workspace runs, 2 per project and 3 agents per
                stage. Lowering limits does not stop active work. Adjust for
                available memory and Docker resources.
              </p>
            </form>
          </section>
          <section
            className="runtime-card"
            ref={connectionSection}
            tabIndex={-1}
            aria-label="AI connections"
          >
            <h2>AI connections</h2>
            <p>
              Claude Code · Anthropic Messages-compatible. Keys stay in this
              Mac's encrypted store.
            </p>
            {connections.map((c) => (
              <div className="connection-row" key={c.id}>
                <div>
                  <strong>{c.name}</strong>
                  <small>
                    {c.model} · v{c.version} · {c.endpoint}
                  </small>
                  <small>{c.diagnostic ?? "Not tested"}</small>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      setConnections(await desktop.testConnection(c.id));
                    })
                  }
                >
                  Test connection
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
                  Edit
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      setConnections(await desktop.removeConnection(c.id));
                      setMessage(
                        "Connection deleted. Runs using it are interrupted.",
                      );
                    })
                  }
                >
                  Delete
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
                    "Connection saved. Test it, then assign it to an execution profile.",
                  );
                });
              }}
            >
              <div className="runtime-grid">
                <label className="field">
                  Connection name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  Model ID
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
                  Authentication
                  <select
                    value={auth}
                    onChange={(e) => setAuth(e.target.value as typeof auth)}
                  >
                    <option value="api-key">API key · x-api-key</option>
                    <option value="bearer">Bearer token</option>
                  </select>
                </label>
                <label className="field">
                  {editing
                    ? "New key (leave blank to keep existing)"
                    : "API key"}
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
                {editing ? "Save connection changes" : "Add connection"}
              </button>
              <p className="muted">
                Testing sends a small model request and may incur charges.
                Repository code is not sent.
              </p>
            </form>
          </section>
          <section
            className="runtime-card git-host-card"
            aria-label="Git host connections"
          >
            <div className="runtime-section-heading">
              <div>
                <h2>Git host</h2>
                <p>
                  Connect to your repository provider's API. Access tokens stay
                  in this Mac's encrypted store.
                </p>
              </div>
              {remote && (
                <span className="host-state">
                  {remote.kind === "github"
                    ? "GitHub"
                    : remote.kind === "gitlab"
                      ? "GitLab"
                      : "Generic Git"}{" "}
                  · {remote.host}
                </span>
              )}
            </div>
            {remote ? (
              <p className="git-remote-line">
                <code>
                  {remote.namespace}/{remote.repository}
                </code>{" "}
                · Execution is isolated in worktrees. Publish a branch or create
                a draft PR/MR after a successful run.
              </p>
            ) : (
              <p className="muted">
                Choosing a folder detects its origin safely. Unrecognized hosts
                still support local Git execution.
              </p>
            )}
            {!gitHostSupported && (
              <p className="muted">
                Git host connections are unavailable in this preview. Add them
                in the macOS app.
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
                  <small>{connection.diagnostic ?? "Not tested"}</small>
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
                  Test connection
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
                  Delete
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
                    "Git host connection saved. Test it before assigning it to a project.",
                  );
                });
              }}
            >
              <div className="runtime-grid">
                <label className="field">
                  Connection name
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
                    <option value="gitlab">GitLab / Self-managed GitLab</option>
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
                Add Git host connection
              </button>
              <p className="muted">
                For GitHub, enter the API endpoint; for GitLab, the instance
                URL. HTTP, certificate bypasses and tokens embedded in remote
                URLs are not supported.
              </p>
            </form>
          </section>
          <section
            className="runtime-card"
            ref={profileSection}
            tabIndex={-1}
            aria-label="Project execution profiles"
          >
            <h2>Project execution profile</h2>
            {!project && (
              <p className="muted">
                Create a project, then connect its repository and execution
                profile.
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
                    "Execution profile saved. Publish and approve a design using these settings.",
                  );
                });
              }}
            >
              <div className="runtime-grid">
                <label className="field">
                  Projects
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
                  Model connection
                  <select
                    value={connectionId}
                    onChange={(e) => setConnectionId(e.target.value)}
                    required
                  >
                    <option value="">Choose connection</option>
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.model}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Repository folder
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
                    Choose folder
                  </button>
                </label>
                <label className="field">
                  Base branch
                  <input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  Project runtime
                  <select
                    value={runtime}
                    onChange={(e) =>
                      setRuntime(e.target.value as ProjectRuntime)
                    }
                  >
                    <option value="node">Node.js / Web</option>
                    <option value="java-gradle">
                      Java · Gradle / Spring Boot
                    </option>
                  </select>
                </label>
                {remote && (
                  <label className="field">
                    Git host connection
                    <select
                      value={gitConnectionId}
                      onChange={(e) => setGitConnectionId(e.target.value)}
                    >
                      <option value="">Generic Git only</option>
                      {gitConnections
                        .filter(
                          (c) =>
                            c.host === remote.host &&
                            (!remote.kind || c.kind === remote.kind),
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ·{" "}
                            {c.testStatus === "passed"
                              ? "Verified"
                              : "Needs verification"}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label className="field">
                  Estimated budget per run (USD)
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
                  Time limit (minutes)
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
                Web changes · Require e2e checks
              </label>
              <label className="field">
                Fixed check commands (argv arrays · no shell expansion)
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
                  ? "Use Gradle checks"
                  : "Use Node checks"}
              </button>
              <p className="muted">
                {runtime === "java-gradle"
                  ? "Java 21 and Gradle 8 run classes and test as fixed checks. Include Spring Boot integration checks in the project's test task."
                  : "Required typecheck, test and selected e2e commands must pass."}{" "}
                Independent AI review is included. Gateway billing may differ
                from the estimated budget.
              </p>
              <button
                className="primary"
                disabled={busy || !project || !path || !connectionId}
              >
                Save execution profile
              </button>
            </form>
          </section>
          <section className="runtime-card">
            <h2>Local environment</h2>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const d = await desktop.diagnostics();
                  setDiagnostic(
                    `Docker ${d.docker ? "Ready" : "Needs attention"} · Runner image ${d.image ? "Ready" : "Run pnpm runner:image"}\n${d.message}`,
                  );
                })
              }
            >
              Check environment
            </button>
            <p className="preserve">{diagnostic}</p>
          </section>
        </>
      )}
    </div>
  );
}
