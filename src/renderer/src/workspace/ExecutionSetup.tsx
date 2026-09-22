import { useEffect, useState } from "react";
import { Check, Circle, RefreshCw } from "lucide-react";
import type { Feature, Snapshot } from "../../../shared/contracts";
import { workflowIssues } from "../../../shared/harness";
import {
  executionProfileIssues,
  type ConnectionInfo,
} from "../../../shared/runtime";
export type SetupDestination = "connection" | "profile" | "agents" | "harness";
export default function ExecutionSetup({
  snapshot,
  feature,
  onSetup,
  onDesign,
}: {
  snapshot: Snapshot;
  feature: Feature;
  onSetup: (destination: SetupDestination) => void;
  onDesign: () => void;
}) {
  const [connections, setConnections] = useState<ConnectionInfo[]>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    setConnections(undefined);
    setError("");
    void window.roopre
      ?.connections()
      .then((value) => {
        if (live) setConnections(value);
      })
      .catch(() => {
        if (live)
          setError(
            "연결 목록을 확인하지 못했습니다. 다시 확인하거나 연결 설정을 여세요.",
          );
      });
    return () => {
      live = false;
    };
  }, [refresh]);
  const project = snapshot.projects.find((p) => p.id === feature.projectId)!;
  const profile = project.executionProfile;
  const connection = connections?.find((c) => c.id === profile?.connectionId);
  const connectionCurrent =
    !!connection && connection.version === profile?.connectionVersion;
  const profileProblems = executionProfileIssues(profile, [
    ...snapshot.policies.at(-1)!.requiredChecks,
    ...project.requiredChecks,
  ]);
  const flowProblems = workflowIssues(snapshot, project);
  const gate = snapshot.gates[feature.id];
  const rows = [
    {
      name: "프로젝트 AI 연결",
      done: connectionCurrent && connection?.testStatus === "passed",
      detail:
        error ||
        (connections === undefined
          ? "저장된 연결 확인 중…"
          : !connections.length
            ? "API key와 endpoint를 앱에 등록하세요."
            : !profile
              ? `연결 ${connections.length}개 등록됨 · 실행 프로필에서 사용할 연결을 선택하세요.`
              : !connection
                ? "프로젝트에 지정된 연결이 없습니다. 연결을 등록하고 실행 프로필을 다시 저장하세요."
                : !connectionCurrent
                  ? "연결 버전이 바뀌었습니다. 실행 프로필을 다시 저장하세요."
                  : `${connection.name} · ${connection.model} · ${connection.testStatus === "passed" ? "마지막 연결 검사 통과" : connection.testStatus === "failed" ? "마지막 연결 검사 실패 · 설정에서 재확인하세요" : "연결 검사 전"}`),
      action:
        connection && !connectionCurrent
          ? "연결 버전 갱신"
          : connection && connection.testStatus !== "passed"
            ? "AI 연결 검사"
            : "AI 연결 설정",
      run: () =>
        onSetup(connection && !connectionCurrent ? "profile" : "connection"),
    },
    {
      name: "저장소와 고정 검사",
      done: profileProblems.length === 0,
      detail:
        profileProblems.join(" ") ||
        `${profile!.baseBranch} · 검사 ${profile!.checks.length}개 · ${profile!.repositoryPath}`,
      action: "실행 프로필 설정",
      run: () => onSetup("profile"),
    },
    {
      name: "에이전트 흐름",
      done: !!project.workflow && !flowProblems.length,
      detail:
        flowProblems.join(" ") ||
        (project.workflow
          ? `저장된 흐름 v${project.workflow.revision} · 역할 ${project.workflow.assignments.length}개`
          : "흐름을 설정하면 요구사항·설계부터 에이전트로 준비할 수 있습니다. 미설정 시 기존 기본 구현·리뷰 흐름을 사용합니다."),
      action: project.harness ? "공유 표준 설정" : "개발 흐름 설정",
      run: () => onSetup(project.harness ? "harness" : "agents"),
    },
    {
      name: "설계 검토와 본인 승인",
      done: gate.eligible,
      detail: gate.eligible
        ? "현재 설계 승인 조건을 충족했습니다. 실행 시작 시 다시 검사합니다."
        : gate.reasons.join(" "),
      action: "설계 작성·검토로 이동",
      run: onDesign,
    },
  ];
  return (
    <section className="execution-setup" aria-label="실행 준비">
      <header>
        <div>
          <h2>첫 실행을 준비하세요</h2>
          <p>{project.name}의 설정을 확인하고 설계 검토를 진행하세요.</p>
        </div>
        <button
          className="icon-button"
          aria-label="AI 연결 상태 다시 확인"
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </header>
      <ol>
        {rows.map((row) => (
          <li key={row.name}>
            <span
              role="img"
              className={`setup-indicator ${row.done ? "is-configured" : ""}`}
              aria-label={row.done ? "설정됨" : "확인 필요"}
            >
              {row.done ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Circle size={15} aria-hidden="true" />
              )}
            </span>
            <div>
              <h3>{row.name}</h3>
              <p>{row.detail}</p>
            </div>
            <button onClick={row.run}>{row.action}</button>
          </li>
        ))}
      </ol>
      <p className="setup-footnote">
        저장된 설정을 안내합니다. 실제 모델 응답·Docker 환경·승인 유효성은 실행
        시 다시 확인하며, 이 화면에서 자동으로 승인하거나 실행하지 않습니다.
      </p>
    </section>
  );
}
