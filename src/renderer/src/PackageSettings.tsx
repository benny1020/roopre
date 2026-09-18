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
  send,
  refresh,
}: {
  snapshot: Snapshot;
  send: (c: Command) => Promise<unknown>;
  refresh: () => Promise<unknown>;
}) {
  const api = window.roopre;
  const [projectId, setProjectId] = useState(snapshot.projects[0]?.id ?? "");
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
      setError("정의 JSON을 먼저 수정·검증하세요.");
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
          <h1>하네스 표준</h1>
          <p>팀의 개발 기준을 파일로 관리하고 프로젝트에 적용합니다.</p>
        </div>
        <span className="version-badge">roopre.harness/v1</span>
      </div>
      {!api?.harnessCandidate ? (
        <p>폴더·Git 가져오기와 적용은 macOS 앱에서 사용할 수 있습니다.</p>
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
              대상 프로젝트
              <select
                aria-label="표준 대상 프로젝트"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setBaseline(snapshot.revision);
                }}
              >
                <option value="">선택하세요</option>
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
                폴더 가져오기
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () =>
                    load(await api.harnessCandidate({ kind: "default" })),
                  )
                }
              >
                기본 표준으로 시작
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
                현재 설정 불러오기
              </button>
            </div>
          </section>
          {installed && (
            <section className="package-installed">
              <strong>적용된 표준 · {installed.package.name}</strong>
              <span>
                {projectPackageChanges(project!).join(" · ") || "표준과 일치"}
              </span>
              <span>
                {installed.package.id}@{installed.package.version} · 적용{" "}
                {installed.revision}회
              </span>
              <code>{installed.digest}</code>
              <span>
                {installed.source.kind === "git"
                  ? `${installed.source.url} · ${installed.source.commit}`
                  : "로컬 폴더 또는 편집한 표준"}
              </span>
              <p>
                실행은 저장된 스냅샷을 사용합니다. 개인 연결·저장소 경로와 현재
                전역 필수 기준이 함께 적용됩니다.
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
                적용한 원본 보기
              </button>
            </section>
          )}
          <details className="package-git">
            <summary>Git 저장소에서 표준 가져오기·업데이트 확인</summary>
            <div className="runtime-grid">
              <label className="field">
                HTTPS Git 주소
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/company/harness.git"
                />
              </label>
              <label className="field">
                브랜치·태그·커밋
                <input value={ref} onChange={(e) => setRef(e.target.value)} />
              </label>
            </div>
            <p>
              저장소 루트의 harness.json을 읽고 정확한 commit으로 고정합니다.
              코드·hook 실행이나 자동 push는 하지 않습니다. 비공개 저장소는
              macOS Git 자격 증명이 필요합니다.
            </p>
            <button
              disabled={busy || !url || !ref}
              onClick={() =>
                void act(async () =>
                  load(await api.harnessCandidate({ kind: "git", url, ref })),
                )
              }
            >
              Git 표준 읽기
            </button>
          </details>
          {!candidate ? (
            <section className="package-empty">
              <h2>공유할 개발 기준을 선택하세요</h2>
              <p>
                기본 7개 에이전트로 시작하거나 현재 프로젝트 설정을 불러와
                파일로 내보낼 수 있습니다. 사용자 데이터·API key·승인은 내보내지
                않습니다.
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
                    : "적용 전 미리보기"}{" "}
                  · {candidate.package.agents.length}개 에이전트 ·{" "}
                  {candidate.package.profiles.length}개 프로필
                </p>
                <code>SHA-256 {candidate.digest}</code>
              </div>
              <nav className="package-tabs" aria-label="하네스 보기">
                <button
                  aria-pressed={tab === "overview"}
                  onClick={() => setTab("overview")}
                >
                  구성·변경 비교
                </button>
                <button
                  aria-pressed={tab === "files"}
                  onClick={() => setTab("files")}
                >
                  디렉토리·Markdown
                </button>
                <button
                  aria-pressed={tab === "edit"}
                  onClick={() => setTab("edit")}
                >
                  표준 스펙 편집
                </button>
              </nav>
              {tab === "edit" && (
                <label className="field">
                  표준 정의 JSON
                  <textarea
                    className="package-code"
                    aria-label="표준 정의 JSON"
                    spellCheck={false}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <small>
                    이름·버전·단계 배치·검사·기능 디렉토리를 편집합니다. 공유
                    버전의 내용이 달라지면 version을 올려 주세요.
                  </small>
                </label>
              )}
              {tab === "files" && (
                <div className="package-browser">
                  <nav aria-label="하네스 파일">
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
                          aria-label="하네스 Markdown"
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
                    적용할 표준 프로필
                    <select
                      aria-label="표준 프로필"
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
                              <small>{a.required ? "필수" : "선택"}</small>
                            </p>
                          ))}
                      </section>
                    ))}
                  </div>
                  <h3>프로젝트 적용 전후</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>항목</th>
                        <th>현재</th>
                        <th>적용할 내용</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>표준 버전</td>
                        <td>
                          {installed
                            ? `${installed.package.id}@${installed.package.version}`
                            : "개별 설정"}
                        </td>
                        <td>
                          {candidate.package.id}@{candidate.package.version}
                        </td>
                      </tr>
                      <tr>
                        <td>배치</td>
                        <td>{project?.workflow?.assignments.length ?? 0}개</td>
                        <td>{profile?.assignments.length}개</td>
                      </tr>
                      <tr>
                        <td>필수 검사</td>
                        <td>{project?.requiredChecks.join(", ")}</td>
                        <td>
                          {[
                            ...new Set([
                              ...(project?.requiredChecks ?? []),
                              ...(profile?.requiredChecks ?? []),
                            ]),
                          ].join(", ")}{" "}
                          (기존 필수 유지)
                        </td>
                      </tr>
                      <tr>
                        <td>설계</td>
                        <td>{featureCount}개 기능에 게시된 설계</td>
                        <td>적용 시 재게시·본인 재승인 필요</td>
                      </tr>
                    </tbody>
                  </table>
                  <details>
                    <summary>프로젝트 지침 변경 원문</summary>
                    <div className="runtime-grid">
                      <pre>
                        {project?.instructions || "현재 추가 지침 없음"}
                      </pre>
                      <pre>{profile?.instructions || "새 추가 지침 없음"}</pre>
                    </div>
                  </details>
                  <details>
                    <summary>검사 명령·단계 지침 전체 비교</summary>
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
                    <summary>회사·에이전트 지침과 전체 표준 비교</summary>
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
                      연결 매핑 · {alias}
                      <select
                        aria-label={`연결 ${alias}`}
                        value={bindings[alias] ?? ""}
                        onChange={(e) =>
                          setBindings({ ...bindings, [alias]: e.target.value })
                        }
                      >
                        <option value="">이 Mac의 연결 선택</option>
                        {connections.map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name} · {c.model}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <p className="muted">
                    project 연결은 대상 프로젝트 설정을 상속합니다. 모델 연결
                    검사는 별도이며 가져오기로 과금 호출하지 않습니다.
                  </p>
                </section>
              )}
              {changed && (
                <p role="status" className="package-warning">
                  편집한 내용이 아직 검증되지 않았습니다. 검증 후
                  적용·내보내기할 수 있습니다.
                </p>
              )}
              <div className="package-actions">
                <button
                  disabled={busy || !changed}
                  onClick={() =>
                    void act(async () => {
                      await load(
                        await api.harnessCandidate({
                          kind: "json",
                          text: draft,
                        }),
                      );
                      setNotice("스펙 검증 완료. 구성을 비교하고 적용하세요.");
                    })
                  }
                >
                  편집 내용 검증
                </button>
                <button
                  disabled={busy || changed}
                  onClick={() =>
                    void act(async () => {
                      const path = await api.harnessExport(candidate.token);
                      if (path)
                        setNotice(`하네스 폴더를 내보냈습니다: ${path}`);
                    })
                  }
                >
                  폴더로 내보내기
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const current = await api.snapshot();
                      setBaseline(current.revision);
                      await refresh();
                      setNotice("최신 프로젝트 상태로 비교를 갱신했습니다.");
                    })
                  }
                >
                  비교 새로고침
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    changed ||
                    !project ||
                    !profile ||
                    aliases.some((a) => !bindings[a])
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
                        "표준을 적용했습니다. 실행 전 설정을 확인하고 설계를 다시 승인하세요.",
                      );
                    })
                  }
                >
                  프로젝트에 적용
                </button>
              </div>
            </>
          )}
          {installed && (
            <section className="package-scopes">
              <h2>기능별 디렉토리·지침</h2>
              <p>
                선택한 범위의 지침을 적용하고 범위 밖 코드 변경은 차단합니다.
                범위 변경 시 해당 기능 설계의 재승인이 필요합니다.
              </p>
              {snapshot.features
                .filter((f) => f.projectId === projectId)
                .map((f) => (
                  <label key={f.id} className="field">
                    {f.title}
                    <select
                      aria-label={`${f.title} 기능 범위`}
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
                      <option value="">프로젝트 전체</option>
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
