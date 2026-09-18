import { emptyWorkspace } from "../../src/database/initial.ts";
import { createHash } from "node:crypto";
import type { Workspace, Feature } from "../../src/shared/contracts.ts";

export function seed(): Workspace {
  const at = new Date().toISOString();
  const specs = [
    [
      "feature-checkout",
      "commerce",
      "결제 실패 안내 개선",
      "카드 승인 실패 시 원인을 설명하고 안전하게 재시도할 수 있다.",
      "bug",
    ],
    [
      "feature-receipt",
      "commerce",
      "영수증 다운로드",
      "사용자가 완료된 결제의 영수증을 다운로드할 수 있다.",
      "feature",
    ],
    [
      "feature-webhook",
      "platform",
      "웹훅 중복 수신 처리",
      "동일한 이벤트를 여러 번 받아도 업무 처리는 한 번만 수행한다.",
      "feature",
    ],
    [
      "feature-audit",
      "platform",
      "변경 이력 조회",
      "관리자가 변경 주체와 시간을 조회할 수 있다.",
      "feature",
    ],
    [
      "feature-login",
      "portal",
      "로그인 세션 복구",
      "만료된 로그인 세션에서 입력 중인 내용을 보존한다.",
      "bug",
    ],
  ];
  const features: Feature[] = specs.map(
    ([id, projectId, title, goal, template], index) => {
      const body = `## 요구사항\n${goal}\n\n수용 기준 AC-01: 정상 흐름에서 요청한 결과를 확인한다.\nAC-02: 실패하거나 중복 요청해도 기존 데이터를 훼손하지 않는다.\n\n## 구조\n화면의 상태 표시와 서비스의 처리 결과를 분리한다. 기존 서비스 계층에서 오류를 정규화하고 UI는 정규화된 상태를 표시한다.\n\n## API·데이터\n기존 응답 계약을 유지한다. 오류 응답에는 code와 message를 사용하고 개인 정보는 포함하지 않는다. 데이터 변경이 없는 기능은 기존 조회 경로를 재사용한다.\n\n## 예외 상황\n네트워크 단절·중복 클릭·권한 없는 요청을 검증한다. 재시도 가능한 오류만 재시도 버튼을 제공한다.\n\n## 변경 영향\n관련 화면과 서비스의 회귀 검사를 실행한다. 기존 사용자 동작은 유지하며 변경 범위를 이번 기능으로 제한한다.\n\n## 검증 계획\nAC-01은 서비스 테스트와 브라우저 정상 시나리오로 검증한다. AC-02는 중복 요청과 연결 실패 시나리오로 검증하고 실패 시 trace를 보관한다.\n\n## 적용·복구\n테스트 환경에서 확인한 뒤 기존 배포 절차를 따른다. 문제가 있으면 이전 배포 버전으로 복구한다. 데이터 마이그레이션은 없다.`;
      return {
        id,
        projectId,
        title,
        template: template as "feature" | "bug",
        authorId: "jun",
        createdAt: at,
        updatedAt: at,
        draft: { revision: 1, body, requirements: goal },
        designs:
          index === 3
            ? []
            : [
                {
                  id: `design-${id}-1`,
                  number: 1,
                  body,
                  requirements: goal,
                  hash: createHash("sha256")
                    .update(body + "\n" + goal)
                    .digest("hex"),
                  at,
                  policyVersion: 1,
                  reviewers: ["mina", "sora"],
                  decisions: [],
                },
              ],
        threads: [],
        dependencies: [],
      };
    },
  );
  features[0].threads.push({
    id: "thread-retry",
    designId: "design-feature-checkout-1",
    section: "예외 상황",
    quote: "재시도 가능한 오류만 재시도 버튼을 제공한다.",
    authorId: "mina",
    body: "승인은 완료됐지만 응답만 유실된 경우도 있습니다. 중복 결제가 발생하지 않도록 재시도 기준과 멱등성 확인 방법을 설계에 명시해 주세요.",
    blocking: true,
    status: "open",
    replies: [],
    at,
  });
  return {
    teamId: "team-local",
    revision: 0,
    people: [
      { id: "jun", name: "준 · 작성자", role: "admin", teamId: "team-local" },
      {
        id: "mina",
        name: "민아 · 검토자",
        role: "developer",
        teamId: "team-local",
      },
      {
        id: "sora",
        name: "소라 · 검토자",
        role: "developer",
        teamId: "team-local",
      },
      { id: "agent", name: "AI 검토", role: "agent", teamId: "team-local" },
    ],
    projects: [
      {
        id: "commerce",
        name: "Commerce",
        description: "결제와 주문 경험",
        color: "#477CC9",
        reviewerIds: ["mina", "sora"],
        requiredChecks: ["typecheck", "test", "review"],
      },
      {
        id: "platform",
        name: "Platform",
        description: "API와 공통 서비스",
        color: "#788F6B",
        reviewerIds: ["mina", "sora"],
        requiredChecks: ["typecheck", "test", "review"],
      },
      {
        id: "portal",
        name: "Customer Portal",
        description: "고객 계정과 셀프 서비스",
        color: "#A57863",
        reviewerIds: ["mina", "sora"],
        requiredChecks: ["typecheck", "test", "review"],
      },
    ],
    features,
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
        at,
        authorId: "jun",
      },
    ],
  };
}

export function ownerFixture(key: string): Workspace {
  const w = emptyWorkspace(key, "local-owner");
  w.projects.push({
    id: "first-project",
    name: "첫 프로젝트",
    description: "명시적 테스트 프로젝트",
    color: "#477CC9",
    ownerId: "owner",
    reviewerIds: ["owner"],
    requiredChecks: ["typecheck", "test", "review"],
  });
  return w;
}
