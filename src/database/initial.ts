import type { Workspace } from "../shared/contracts.ts";

// Product initialization contains only the real local owner and mandatory
// defaults. Projects, features, approvals and executions come from the user.
export function emptyWorkspace(
  key: string,
  mode: NonNullable<Workspace["mode"]>,
): Workspace {
  return {
    teamId: key,
    mode,
    revision: 0,
    people: [
      { id: "owner", name: "나 · 프로젝트 소유자", role: "admin", teamId: key },
    ],
    projects: [],
    features: [],
    runs: [],
    policies: [
      {
        version: 1,
        global:
          "승인된 요구사항과 설계를 기준으로 개발한다. 검증 근거가 없는 결과는 완료로 보고하지 않는다.",
        design:
          "요구사항·구조·API·예외·변경 영향·검증·복구를 명시한다. 필수 개발자 리뷰를 받은 후 구현한다.",
        implementation:
          "승인 범위에서 구현하고 테스트한다. 실패하면 원인을 분석해 수정한다. 중요한 설계 변경은 재승인을 요청한다.",
        reviewer:
          "구현자의 설명만으로 판단하지 않는다. 실제 설계·코드·검증 결과를 대조하고 재현 가능한 지적을 남긴다.",
        requiredChecks: ["typecheck", "test", "review"],
        at: new Date().toISOString(),
        authorId: "owner",
      },
    ],
  };
}
