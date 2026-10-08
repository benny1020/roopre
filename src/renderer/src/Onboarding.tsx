import { useEffect, useRef, useState } from "react";
import App from "./App";
import HarnessPanel from "./HarnessPanel";
import type { BootstrapStatus } from "../../shared/onboarding";
import { onboardingSteps } from "../../shared/onboarding";
import { workflowIssues } from "../../shared/harness";
import type { Snapshot } from "../../shared/contracts";
import {
  defaultChecksForRuntime,
  runnerImageForRuntime,
  type ConnectionInfo,
  type ProjectRuntime,
} from "../../shared/runtime";
import icon from "../../../resources/icon.png";
import "./style.css";
const titles = [
  "AI connections",
  "Environment setup",
  "Your project",
  "Development standards",
  "First requirement",
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
        <h1>Starting Roopre</h1>
        <p role="status">{error || "Checking saved settings."}</p>
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
  const [endpoint, setEndpoint] = useState(
    initial?.endpoint ?? "https://api.anthropic.com",
  );
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
  const [runtime, setRuntime] = useState<ProjectRuntime>(
    initial?.runtime ?? "node",
  );
  const [budget, setBudget] = useState(initial?.budget ?? "1");
  const [projectInstructions, setProjectInstructions] = useState(
    initial?.projectInstructions ?? "",
  );
  const [checks, setChecks] = useState(
    initial?.checks ?? JSON.stringify(defaultChecksForRuntime("node"), null, 2),
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [requirements, setRequirements] = useState(initial?.requirements ?? "");
  const autosaveTimer = useRef<number | undefined>(undefined);
  const autosaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const navigating = useRef(false);
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
    // Persist only valid, credential-free endpoints; never persist API keys.
    endpoint: (() => {
      try {
        const u = new URL(endpoint);
        return u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
          ? endpoint
          : undefined;
      } catch {
        return undefined;
      }
    })(),
    model,
    auth,
    projectId,
    name,
    path,
    branch,
    runtime,
    budget,
    checks,
    projectInstructions,
    title,
    requirements,
  };
  const draftJson = JSON.stringify(draft);
  const progressRef = useRef(status.progress);
  const draftRef = useRef(draft);
  progressRef.current = status.progress;
  draftRef.current = draft;
  const enqueueAutosave = () => {
    const progress = progressRef.current;
    const currentDraft = draftRef.current;
    const save = autosaveQueue.current
      .catch(() => undefined)
      .then(() => api.onboarding({ ...progress, draft: currentDraft }));
    autosaveQueue.current = save;
    void save.catch((e) => setError(e.message));
  };
  const cancelAutosave = async () => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = undefined;
    }
    // A debounce callback may already have started when the user changes
    // steps. Finish that write before storing the newer navigation state.
    await autosaveQueue.current.catch(() => undefined);
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      if (autosaveTimer.current === timer) autosaveTimer.current = undefined;
      if (!navigating.current) enqueueAutosave();
    }, 500);
    autosaveTimer.current = timer;
    return () => {
      clearTimeout(timer);
      if (autosaveTimer.current === timer) autosaveTimer.current = undefined;
    };
  }, [draftJson, status.progress.step, status.progress.dismissed]);
  const advance = async (i: number) => {
    navigating.current = true;
    await cancelAutosave();
    const progress = {
      version: 1 as const,
      step: onboardingSteps[i],
      draft,
      dismissed: false,
    };
    progressRef.current = progress;
    let saved = false;
    try {
      update(await api.onboarding(progress));
      saved = true;
    } finally {
      navigating.current = false;
      if (!saved) progressRef.current = status.progress;
    }
  };
  const finish = async () => {
    navigating.current = true;
    await cancelAutosave();
    const progress = {
      version: 1 as const,
      step: "requirements" as const,
      draft,
      dismissed: true,
    };
    progressRef.current = progress;
    let saved = false;
    try {
      update(await api.onboarding(progress));
      saved = true;
    } finally {
      navigating.current = false;
      if (!saved) progressRef.current = status.progress;
    }
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
          <strong>Roopre</strong>
        </div>
        <h1>
          Your team's standards.
          <br />
          Your development workspace.
        </h1>
        <p>
          Define requirements and a design,
          <br />
          then approve the plan before agents implement and verify it.
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
          You can change these settings later. API keys are stored encrypted.
        </small>
      </aside>
      <main className="onboarding-main">
        <header>
          <span>Setup · {index + 1} / 5</span>
          <select
            aria-label="Setup appearance"
            defaultValue={JSON.parse(
              localStorage.getItem("theme") || '"system"',
            )}
            onChange={(e) => theme(e.target.value)}
          >
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
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
                Add a model and API connection. Anthropic Messages-compatible
                endpoints are supported.
              </p>
              <div className="onboarding-form">
                <label className="field">
                  Connection name
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
                    Model
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Authentication
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
                        "Connection saved. Run a connection test before using it.",
                      );
                    })
                  }
                >
                  Save connection
                </button>
              </div>
              {connections.map((c) => (
                <div className="onboarding-check" key={c.id}>
                  <div>
                    <strong>{c.name}</strong>
                    <p>
                      {c.model} ·{" "}
                      {c.testStatus === "passed"
                        ? "Connection verified"
                        : c.testStatus === "failed"
                          ? "Connection test failed"
                          : "Not tested"}
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
                    Test connection
                  </button>
                </div>
              ))}
              <p className="muted">
                Testing sends a small model request and may incur charges.
                Saving does not send a request.
              </p>
            </>
          )}
          {step === "environment" && (
            <>
              <p>
                Check Git and Docker, then prepare Roopre's database and
                isolated runner image.
              </p>
              <div className="onboarding-check">
                <div>
                  <strong>{status.stage}</strong>
                  <p>
                    {status.connected
                      ? "Database connected"
                      : "Database setup required"}{" "}
                    ·{" "}
                    {status.managed
                      ? "Dedicated Roopre environment"
                      : "Existing environment available"}
                  </p>
                </div>
                {status.busy && <span role="status">Preparing…</span>}
              </div>
              {status.error && (
                <p className="error-banner" role="alert">
                  {status.error}
                </p>
              )}
              <p>
                Initial setup downloads container images and may take a few
                minutes. Existing repositories and database volumes are
                preserved.
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
                  Environment setup
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
                    Back up and migrate database
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
                    Stop setup
                  </button>
                )}
              </div>
              <p className="muted">
                Install and start Docker Desktop and Git. Complete any system
                permission prompts, then continue after setup finishes.
              </p>
            </>
          )}
          {step === "project" && (
            <>
              <p>
                Connect your repository. This step does not change code or
                install packages.
              </p>
              {!status.connected ? (
                <p>Complete environment setup first.</p>
              ) : (
                <>
                  <label className="field">
                    Saved project
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
                          setRuntime(p.executionProfile.runtime ?? "node");
                          setChecks(
                            JSON.stringify(p.executionProfile.checks, null, 2),
                          );
                        }
                      }}
                    >
                      <option value="">New project</option>
                      {snapshot?.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Project name
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
                            setRuntime(repo.runtime);
                            setChecks(
                              JSON.stringify(
                                defaultChecksForRuntime(repo.runtime),
                                null,
                                2,
                              ),
                            );
                            if (!name)
                              setName(repo.path.split("/").at(-1) ?? "");
                          }
                        })
                      }
                    >
                      Choose repository folder
                    </button>
                    <span>{path || "No repository selected"}</span>
                  </div>
                  <div className="runtime-grid">
                    <label className="field">
                      Base branch
                      <input
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      Project AI connection
                      <select
                        value={connectionId}
                        onChange={(e) => setConnectionId(e.target.value)}
                      >
                        <option value="">Choose connection</option>
                        {connections.map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name} · {c.model}
                          </option>
                        ))}
                      </select>
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
                    <label className="field">
                      Estimated budget per run (USD)
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
                    Required check commands (JSON)
                    <textarea
                      value={checks}
                      onChange={(e) => setChecks(e.target.value)}
                    />
                  </label>
                  <p className="muted">
                    {runtime === "java-gradle"
                      ? "Suggested commands use Java 21 and Gradle 8: classes and test. Include Spring Boot integration checks in the test task."
                      : "Match these to your repository's commands. Approved checks, including e2e, run as configured."}
                  </p>
                  <label className="field">
                    Project Markdown instructions
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
                    Import instructions
                  </button>
                  <p className="muted">
                    Imported instructions apply only to this project. Commands
                    and hooks in the file are not run automatically.
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
                        const existingProject = snapshot?.projects.find(
                          (p) => p.id === id,
                        );
                        const existingProfile =
                          existingProject?.executionProfile;
                        await api.configureProject(id, {
                          ...existingProfile,
                          repositoryPath: path,
                          baseBranch: branch,
                          baseCommit: "0".repeat(40),
                          connectionId,
                          connectionVersion: 1,
                          image: runnerImageForRuntime(runtime),
                          checks: parsed,
                          webRequired:
                            existingProfile?.webRequired ?? runtime === "node",
                          budgetUsd: Number(budget),
                          timeoutMinutes: existingProfile?.timeoutMinutes ?? 60,
                          repairLimit: existingProfile?.repairLimit ?? 1,
                          runtime,
                        });
                        await api.command({
                          type: "update_project_policy",
                          projectId: id,
                          instructions: projectInstructions,
                          requiredChecks: existingProject?.requiredChecks ?? [
                            "typecheck",
                            "test",
                            "review",
                          ],
                          reviewerIds: ["owner"],
                        });
                        setNotice("Project and execution settings saved.");
                      })
                    }
                  >
                    Save project connection
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
                  initialProjectId={projectId}
                  onProjectChange={setProjectId}
                />
              ) : (
                <p>
                  Complete environment setup and project registration first.
                </p>
              )}
            </>
          )}
          {step === "requirements" && (
            <>
              <section className="settings-card" aria-label="Setup checklist">
                <h3>Recorded progress</h3>
                <p className="muted">
                  Progress comes from saved settings and actual runs. Earlier
                  results do not authorize a new run.
                </p>
                <ul>
                  {[
                    [
                      "Model connection test",
                      connections.some((c) => c.testStatus === "passed"),
                    ],
                    [
                      "Project execution settings",
                      snapshot?.projects.some((p) => !!p.executionProfile),
                    ],
                    [
                      "Stage standards",
                      snapshot?.projects.some(
                        (p) =>
                          p.workflow &&
                          workflowIssues(snapshot, p).length === 0,
                      ),
                    ],
                    [
                      "First design published",
                      snapshot?.features.some((f) => f.designs.length > 0),
                    ],
                    [
                      "Your design approval",
                      snapshot?.features.some((f) =>
                        f.designs.some((d) =>
                          d.decisions.some((r) => r.decision === "approve"),
                        ),
                      ),
                    ],
                    [
                      "Checks and review complete",
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
                Define your first feature's goal and acceptance criteria. Model
                execution and design approval happen in the workspace.
              </p>
              <label className="field">
                First feature project
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">Choose project</option>
                  {snapshot?.projects.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Feature name
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="field">
                Requirements and acceptance criteria
                <textarea
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder="Describe the problem and measurable criteria such as AC01 and AC02."
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
                Create first requirement
              </button>
              <p className="muted">
                No sample projects or fabricated results are created. Finish any
                remaining setup from Getting started.
              </p>
            </>
          )}
        </div>
        <footer>
          <button
            disabled={busy || status.busy || index === 0}
            onClick={() => void act(() => advance(index - 1))}
          >
            Back
          </button>
          <div className="button-row">
            <button
              disabled={busy || status.busy || !status.connected}
              onClick={() => void act(finish)}
            >
              Skip for now · Open app
            </button>
            {index < 4 ? (
              <button
                className="primary"
                disabled={busy || status.busy}
                onClick={() => void act(() => advance(index + 1))}
              >
                Next
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || !status.connected}
                onClick={() => void act(finish)}
              >
                Open app
              </button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
