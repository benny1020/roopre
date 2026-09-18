import {
  harnessPackageSchema,
  type HarnessPackage,
} from "./harness-package.ts";
import { stages } from "./harness-stages.ts";
export function defaultPackage(): HarnessPackage {
  const roles = [
    [
      "requirements",
      "요구사항 정리자",
      "requirements",
      "목표·범위·완료 기준 AC를 정리하고 불확실한 질문을 명시한다.",
    ],
    [
      "designer",
      "설계자",
      "design",
      "구조·데이터·예외·영향·검증·복구를 구체적으로 설계한다.",
    ],
    [
      "design-reviewer",
      "설계 검토자",
      "design",
      "기존 설계의 누락과 영향·불필요한 복잡성을 검토하고 개선한 초안을 작성한다. 본인 승인을 대신하지 않는다.",
    ],
    [
      "developer",
      "개발자",
      "implementation",
      "승인한 설계 범위에서 구현하고 실패 근거를 반영해 수정한다. 기존 테스트와 정책을 약화하지 않는다.",
    ],
    [
      "acceptance-reviewer",
      "요구사항 검증자",
      "verification",
      "각 AC를 구현·테스트 근거와 대조한다. 근거 없는 완료는 실패로 보고한다.",
    ],
    [
      "convention-reviewer",
      "컨벤션 검증자",
      "verification",
      "전역·프로젝트 지침과 명명·구조·오류 처리 규칙을 확인한다.",
    ],
    [
      "code-reviewer",
      "코드 리뷰어",
      "review",
      "실제 diff를 읽고 결함·회귀·유지보수 문제를 근거와 함께 검토한다.",
    ],
  ];
  return harnessPackageSchema.parse({
    schema: "roopre.harness/v1",
    id: "roopre.standard",
    version: "1.0.0",
    name: "루프리 기본 개발 표준",
    instructions:
      "사람이 설계를 승인한 후 구현한다. 필수 검사와 리뷰의 근거를 남기고 실패한 작업을 완료로 표시하지 않는다.",
    agents: roles.map(([id, name, stage, instructions]) => ({
      id,
      name,
      description: "기본 역할",
      capability: stage === "implementation" ? "implementation" : "read-only",
      instructions,
      connection: "project",
    })),
    profiles: [
      {
        id: "standard",
        name: "기본 개발 흐름",
        instructions: "",
        stageInstructions: Object.fromEntries(stages.map((s) => [s, ""])),
        assignments: roles.map(([id, , stage]) => ({
          id,
          agentId: id,
          stage,
          required: true,
        })),
        requiredChecks: ["typecheck", "test", "review"],
        checks: [],
        scopes: [],
      },
    ],
  });
}
