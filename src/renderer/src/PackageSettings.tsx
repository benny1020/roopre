import { useEffect, useRef, useState } from "react";
import type { Snapshot, Command } from "../../shared/contracts";
import {
  harnessPackageSchema,
  packageFiles,
  profileOf,
  projectPackageChanges,
  type PackageCandidate,
  type HarnessPackage,
} from "../../shared/harness-package";
import { stages, stageNames } from "../../shared/harness";
import type { ConnectionInfo } from "../../shared/runtime";
import MarkdownPreview from "./MarkdownPreview";
export default function PackageSettings({
  snapshot,
  initialProjectId,
  onProjectChange,
  send,
  refresh,
}: {
  snapshot: Snapshot;
  initialProjectId?: string;
  onProjectChange?: (id: string) => void;
  send: (c: Command) => Promise<unknown>;
  refresh: () => Promise<unknown>;
}) {
  const api = window.roopre;
  const [projectId, setProjectId] = useState(
    initialProjectId && snapshot.projects.some((p) => p.id === initialProjectId)
      ? initialProjectId
      : (snapshot.projects[0]?.id ?? ""),
  );
  const project = snapshot.projects.find((p) => p.id === projectId);
  const [candidate, setCandidate] = useState<PackageCandidate>();
  const [draft, setDraft] = useState("");
  const [profileId, setProfileId] = useState("");
  const [file, setFile] = useState("harness.json");
  const [tab, setTab] = useState<"overview" | "files" | "edit">("overview");
  const [baseline, setBaseline] = useState(snapshot.revision);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const latch = useRef(false);
  useEffect(() => {
    void api
      ?.connections()
      .then(setConnections)
      .catch((e) => setError(e.message));
  }, []);
  const act = async (fn: () => Promise<void>) => {
    if (latch.current) return;
    latch.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      latch.current = false;
      setBusy(false);
    }
  };
  const load = async (value: PackageCandidate | null) => {
    if (!value) return;
    setCandidate(value);
    setDraft(JSON.stringify(value.package, null, 2));
    setProfileId(value.package.profiles[0].id);
    setBindings({});
    setFile("harness.json");
    setTab("overview");
    const current = await api!.snapshot();
    setBaseline(current.revision);
    await refresh();
  };
  const changed =
    !!candidate && draft !== JSON.stringify(candidate.package, null, 2);
  const profile = candidate?.package.profiles.find((p) => p.id === profileId);
  const files = candidate ? packageFiles(candidate.package) : {};
  const aliases =
    candidate && profile
      ? [
          ...new Set(
            profile.assignments.map(
              (a) =>
                candidate.package.agents.find((x) => x.id === a.agentId)!
                  .connection,
            ),
          ),
        ].filter((a) => a !== "project")
      : [];
  const featureCount = snapshot.features.filter(
    (f) => f.projectId === projectId && f.designs.length,
  ).length;
  const installed = project?.harness;
  const editMarkdown = (path: string, value: string) => {
    try {
      const next: HarnessPackage = JSON.parse(draft);
      if (path === "policies/company.md") next.instructions = value;
      else if (path.startsWith("agents/"))
        next.agents.find((a) => path === `agents/${a.id}.md`)!.instructions =
          value;
      else
        for (const p of next.profiles) {
          if (path === `projects/${p.id}/instructions.md`)
            p.instructions = value;
          for (const stage of stages)
            if (path === `projects/${p.id}/steps/${stage}.md`)
              p.stageInstructions[stage] = value;
          for (const s of p.scopes)
            if (path === `projects/${p.id}/features/${s.id}/instructions.md`)
              s.instructions = value;
        }
      setDraft(JSON.stringify(next, null, 2));
    } catch {
      setError("Edit and validate the definition JSON first.");
    }
  };
  let editedFiles: Record<string, string> = files;
  try {
    editedFiles = packageFiles(harnessPackageSchema.parse(JSON.parse(draft)));
  } catch {
    /* retain the last validated file tree */
  }
  return (
    <div className="content-page package-settings">
      <div className="page-heading">
        <div>
          <h1>Harness standards</h1>
          <p>Manage team standards as files and apply them to projects.</p>
        </div>
        <span className="version-badge">roopre.harness/v1</span>
      </div>
      {!api?.harnessCandidate ? (
        <p>Folder and Git imports are available in the macOS app.</p>
      ) : (
        <>
          {error && (
            <p role="alert" className="error-banner">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="success-banner">
              {notice}
            </p>
          )}
          <section className="package-toolbar">
            <label className="field">
              Target project
              <select
                aria-label="Standards project"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  onProjectChange?.(e.target.value);
                  setBaseline(snapshot.revision);
                }}
              >
                <option value="">Select</option>
                {snapshot.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () =>
                    load(await api.harnessCandidate({ kind: "folder" })),
                  )
                }
              >
                Import folder
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () =>
                    load(await api.harnessCandidate({ kind: "default" })),
                  )
                }
              >
                Start from defaults
              </button>
              <button
                disabled={busy || !project?.workflow}
                onClick={() =>
                  void act(async () =>
                    load(
                      await api.harnessCandidate({
                        kind: "project",
                        projectId,
                      }),
                    ),
                  )
                }
              >
                Load current settings
              </button>
            </div>
          </section>
          {installed && (
            <section className="package-installed">
              <strong>Applied standard · {installed.package.name}</strong>
              <span>
                {projectPackageChanges(project!).join(" · ") ||
                  "Matches standard"}
              </span>
              <span>
                {installed.package.id}@{installed.package.version} · Applied{" "}
                {installed.revision} times
              </span>
              <code>{installed.digest}</code>
              <span>
                {installed.source.kind === "git"
                  ? `${installed.source.url} · ${installed.source.commit}`
                  : "Local folder or edited standard"}
              </span>
              <p>
                Runs use a saved snapshot, together with local connections,
                repository paths and current global checks.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () =>
                    load(
                      await api.harnessCandidate({
                        kind: "json",
                        text: JSON.stringify(installed.package),
                      }),
                    ),
                  )
                }
              >
                View imported source
              </button>
            </section>
          )}
          <details className="package-git">
            <summary>Import or check updates from Git</summary>
            <div className="runtime-grid">
              <label className="field">
                HTTPS Git URL
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/company/harness.git"
                />
              </label>
              <label className="field">
                Branch, tag or commit
                <input value={ref} onChange={(e) => setRef(e.target.value)} />
              </label>
            </div>
            <p>
              Reads harness.json from the repository root and pins its commit.
              No code or hooks run and nothing is pushed. Private repositories
              require local Git credentials.
            </p>
            <button
              disabled={busy || !url || !ref}
              onClick={() =>
                void act(async () =>
                  load(await api.harnessCandidate({ kind: "git", url, ref })),
                )
              }
            >
              Read Git standard
            </button>
          </details>
          {!candidate ? (
            <section className="package-empty">
              <h2>Choose standards to share</h2>
              <p>
                Start with seven default agents or export your project's current
                settings. User data, API keys and approvals are excluded.
              </p>
            </section>
          ) : (
            <>
              <div className="package-candidate">
                <h2>
                  {candidate.package.name}{" "}
                  <small>v{candidate.package.version}</small>
                </h2>
                <p>
                  {candidate.source.kind === "git"
                    ? `Git commit ${candidate.source.commit}`
                    : "Preview changes"}{" "}
                  · {candidate.package.agents.length} agents ·{" "}
                  {candidate.package.profiles.length} profiles
                </p>
                <code>SHA-256 {candidate.digest}</code>
              </div>
              <nav className="package-tabs" aria-label="Harness">
                <button
                  aria-pressed={tab === "overview"}
                  onClick={() => setTab("overview")}
                >
                  Changes
                </button>
                <button
                  aria-pressed={tab === "files"}
                  onClick={() => setTab("files")}
                >
                  Files & Markdown
                </button>
                <button
                  aria-pressed={tab === "edit"}
                  onClick={() => setTab("edit")}
                >
                  Edit specification
                </button>
              </nav>
              {tab === "edit" && (
                <label className="field">
                  Standard definition JSON
                  <textarea
                    className="package-code"
                    aria-label="Standard definition JSON"
                    spellCheck={false}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <small>
                    Edit name, version, stage assignments, checks and feature
                    directories. Increment the version when shared content
                    changes.
                  </small>
                </label>
              )}
              {tab === "files" && (
                <div className="package-browser">
                  <nav aria-label="Harness files">
                    {Object.keys(editedFiles)
                      .sort()
                      .map((p) => (
                        <button
                          key={p}
                          className={p === file ? "selected" : ""}
                          onClick={() => setFile(p)}
                        >
                          {p}
                        </button>
                      ))}
                  </nav>
                  <div>
                    <strong>{file}</strong>
                    {file.endsWith(".md") ? (
                      <>
                        <textarea
                          aria-label="Harness Markdown"
                          value={editedFiles[file] ?? ""}
                          onChange={(e) => editMarkdown(file, e.target.value)}
                        />
                        <MarkdownPreview text={editedFiles[file] ?? ""} />
                      </>
                    ) : (
                      <pre>{editedFiles[file]}</pre>
                    )}
                  </div>
                </div>
              )}
              {tab === "overview" && (
                <section className="package-overview">
                  <label className="field">
                    Profile to apply
                    <select
                      aria-label="Standard profile"
                      value={profileId}
                      onChange={(e) => setProfileId(e.target.value)}
                    >
                      {candidate.package.profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="package-stages">
                    {stages.map((stage) => (
                      <section key={stage}>
                        <h3>{stageNames[stage]}</h3>
                        {profile?.assignments
                          .filter((a) => a.stage === stage)
                          .map((a) => (
                            <p key={a.id}>
                              {
                                candidate.package.agents.find(
                                  (d) => d.id === a.agentId,
                                )?.name
                              }
                              <small>
                                {a.required ? "Required" : "Optional"}
                              </small>
                            </p>
                          ))}
                      </section>
                    ))}
                  </div>
                  <h3>Before and after</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Setting</th>
                        <th>Current</th>
                        <th>Proposed</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Standard version</td>
                        <td>
                          {installed
                            ? `${installed.package.id}@${installed.package.version}`
                            : "Custom settings"}
                        </td>
                        <td>
                          {candidate.package.id}@{candidate.package.version}
                        </td>
                      </tr>
                      <tr>
                        <td>Assignment</td>
                        <td>{project?.workflow?.assignments.length ?? 0}</td>
                        <td>{profile?.assignments.length}</td>
                      </tr>
                      <tr>
                        <td>Required checks</td>
                        <td>{project?.requiredChecks.join(", ")}</td>
                        <td>
                          {[
                            ...new Set([
                              ...(project?.requiredChecks ?? []),
                              ...(profile?.requiredChecks ?? []),
                            ]),
                          ].join(", ")}{" "}
                          (existing required checks preserved)
                        </td>
                      </tr>
                      <tr>
                        <td>Design</td>
                        <td>{featureCount} features with published designs</td>
                        <td>
                          Republish and approve your design after applying
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <details>
                    <summary>Project instruction changes</summary>
                    <div className="runtime-grid">
                      <pre>
                        {project?.instructions ||
                          "No current additional instructions"}
                      </pre>
                      <pre>
                        {profile?.instructions ||
                          "No new additional instructions"}
                      </pre>
                    </div>
                  </details>
                  <details>
                    <summary>Compare commands and stage instructions</summary>
                    <div className="runtime-grid">
                      <pre>
                        {JSON.stringify(
                          {
                            checks: project?.executionProfile?.checks,
                            limits: project?.executionProfile && {
                              budgetUsd: project.executionProfile.budgetUsd,
                              timeoutMinutes:
                                project.executionProfile.timeoutMinutes,
                              repairLimit: project.executionProfile.repairLimit,
                            },
                            instructions: project?.workflow?.instructions,
                            assignments: project?.workflow?.assignments,
                          },
                          null,
                          2,
                        )}
                      </pre>
                      <pre>{JSON.stringify(profile, null, 2)}</pre>
                    </div>
                  </details>
                  <details>
                    <summary>
                      Compare company, agent and standard instructions
                    </summary>
                    <div className="runtime-grid">
                      <pre>
                        {JSON.stringify(
                          installed?.package ?? {
                            instructions: snapshot.policies.at(-1),
                            agents: snapshot.agents?.filter((a) =>
                              project?.workflow?.assignments.some(
                                (x) => x.agentId === a.id,
                              ),
                            ),
                          },
                          null,
                          2,
                        )}
                      </pre>
                      <pre>{JSON.stringify(candidate.package, null, 2)}</pre>
                    </div>
                  </details>
                  {aliases.map((alias) => (
                    <label key={alias} className="field">
                      Connection mapping · {alias}
                      <select
                        aria-label={`Connection ${alias}`}
                        value={
                          Object.hasOwn(bindings, alias) ? bindings[alias] : ""
                        }
                        onChange={(e) =>
                          setBindings({ ...bindings, [alias]: e.target.value })
                        }
                      >
                        <option value="">Choose a local connection</option>
                        {connections.map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name} · {c.model}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <p className="muted">
                    A project connection inherits the target project's settings.
                    Importing does not test models or incur model charges.
                  </p>
                </section>
              )}
              {changed && (
                <p role="status" className="package-warning">
                  Changes have not been validated. Validate before applying or
                  exporting.
                </p>
              )}
              <div className="package-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await load(
                        await api.harnessCandidate({
                          kind: "json",
                          text: draft,
                        }),
                      );
                      setNotice(
                        "Specification validated. Review changes before applying.",
                      );
                    })
                  }
                >
                  Validate changes
                </button>
                <button
                  disabled={busy || changed}
                  onClick={() =>
                    void act(async () => {
                      const path = await api.harnessExport(candidate.token);
                      if (path) setNotice(`Harness folder exported: ${path}`);
                    })
                  }
                >
                  Export folder
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const current = await api.snapshot();
                      setBaseline(current.revision);
                      await refresh();
                      setNotice(
                        "Comparison refreshed with the latest project state.",
                      );
                    })
                  }
                >
                  Refresh comparison
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    changed ||
                    !project ||
                    !profile ||
                    aliases.some(
                      (a) => !Object.hasOwn(bindings, a) || !bindings[a],
                    )
                  }
                  onClick={() =>
                    void act(async () => {
                      await api.harnessApply({
                        token: candidate.token,
                        projectId,
                        profileId,
                        expectedRevision: baseline,
                        bindings,
                      });
                      await refresh();
                      setNotice(
                        "Standard applied. Check settings and approve your design again before running.",
                      );
                    })
                  }
                >
                  Apply to project
                </button>
              </div>
            </>
          )}
          {installed && (
            <section className="package-scopes">
              <h2>Feature directories & instructions</h2>
              <p>
                Instructions apply within the chosen scope. Changes outside it
                are blocked. Changing scope requires a new design approval.
              </p>
              {snapshot.features
                .filter((f) => f.projectId === projectId)
                .map((f) => (
                  <label key={f.id} className="field">
                    {f.title}
                    <select
                      aria-label={`${f.title} Feature scope`}
                      disabled={busy}
                      value={f.harnessScope ?? ""}
                      onChange={(e) =>
                        void act(async () => {
                          await send({
                            type: "set_feature_scope",
                            featureId: f.id,
                            expectedRevision: snapshot.revision,
                            scopeId: e.target.value || undefined,
                          });
                          await refresh();
                        })
                      }
                    >
                      <option value="">Entire project</option>
                      {profileOf(installed).scopes.map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.name} · {s.paths.join(", ")}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
