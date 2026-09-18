# 루프리 · Orca 코드 벤치마킹과 온보딩 보완안

> 최신 상태: 2026-09-18 [v0.3 구현 승인](V03-APPROVAL.md)을 받고 구현했습니다. 아래 제안 당시 상태는 설계 이력이며, 실제 구현·검증 범위와 남은 조건은 [검증 기록](../VERIFICATION.md)을 따릅니다.

확인일: 2026-09-18. **공개 소스 분석과 루프리 설계 제안이며 구현·실행 검증 결과가 아니다.** 기존 [v0.3 설계](HARNESS-V03.md)와 [설치 설계](EXTERNAL-BETA-DESIGN.md)의 UX를 구체화한다. 사용자의 “최대한 오르카 코드나 방식 벤치마킹, 오르카처럼 온보딩” 요청을 반영했다. 기존 본인 설계 승인 대기는 유지하며 이 요청을 신규 실행 구조 전체의 승인으로 기록하지 않는다.

## 결론

Orca의 **단계형 첫 설정 + 지속되는 시작 체크리스트 + 환경 자동 감지 + 설정/상태/IPC 책임 분리 + 새 프로필 E2E**를 우선 참고한다. 루프리에서는 사용자가 자기 저장소와 실제 연결로 첫 설계를 만드는 데까지 이어지는 온보딩을 만든다. 첫 화면에 가상 작업이나 가짜 성공 기록을 만들지 않는다.

외형뿐 아니라 실패·재시작·업그레이드 동작까지 벤치마킹한다. 짧은 설정 마법사 하나를 붙이는 작업으로는 다운로드형 앱의 설치 문제를 해결할 수 없다. DB가 없어도 앱을 열 수 있는 bootstrap과 준비 상태 검사가 먼저 필요하다.

## 조사 기준과 확인 범위

- 기준 저장소: [stablyai/orca](https://github.com/stablyai/orca).
- 이번 분석 고정 commit: `f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857`, package version `1.4.197`.
- 기존 루프리 구조 문서의 참고 commit `0d23ea6e...`와 다르므로 두 버전의 관찰을 섞지 않는다.
- 별도 임시 폴더에 공개 소스를 받아 읽었다. Orca 의존성 설치·빌드·앱 실행·로그인·사용자 프로필 접근은 하지 않았다. 아래 E2E는 코드가 존재하고 무엇을 검사하는지 확인한 것이며 직접 통과시킨 결과가 아니다.
- 기존 프로젝트 문서에서 사용하던 Orca 식별을 이어받았다. 사용자가 설치한 앱의 정확한 제품·버전은 확인하지 않았다.

## 실제 코드에서 확인한 패턴

| 영역            | Orca 소스에서 확인한 동작                                                                     | 루프리 적용                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 첫 설정         | 에이전트 → 외관 → 연동 → Windows 터미널 → 알림 단계 정의. 플랫폼과 환경에 따라 일부 단계 생략 | macOS에서 필요한 연결·환경·프로젝트·개발 기준을 중심으로 짧게 구성. 테마는 작은 선택 항목으로 제공 |
| 에이전트 선택   | 설치 감지된 항목 우선, 나머지 접기. 미설치도 기본 선택 가능하되 설치 안내 표시                | 현재 지원 adapter만 선택 가능. 연결을 저장한 상태와 실제 연결 검사 성공을 구분                     |
| 진행 저장       | flowVersion, closedAt, outcome, lastCompletedStep, 별도 checklist                             | flowVersion, 안정된 stepId, 입력 revision, 저장 여부. 닫기와 준비 완료를 분리                      |
| 종료 충돌       | 완료/닫기 동시 입력에 latch를 사용. 저장 실패 시 latch 해제 후 재시도                         | 다음·취소·닫기 중복 입력을 한 요청으로 처리. main에서도 준비 작업 중복 방지                        |
| 단계 생략       | 조건별 앞/뒤 단계 탐색. 재개할 때 옛 단계 번호를 새 흐름으로 변환                             | 단계 ID 기반 저장으로 변경에 강하게 설계. 이전 버전 매핑과 업그레이드 시나리오 검증                |
| 설정 검사       | renderer 입력을 main에서 허용 필드·타입으로 정제. checklist 부분 수정은 다른 항목 보존        | shared Zod 계약 + 제한된 preload + 신뢰된 main 상태 판정. renderer가 ready를 쓰는 API를 두지 않음  |
| 시작 체크리스트 | 저장소 추가, 첫 에이전트, diff 확인 등 실제 사용 이력을 별도 기록                             | 프로젝트 등록 → 지침 적용 → 첫 설계 게시 → 본인 승인 → 검사·리뷰 결과 확인                         |
| 현재 준비 상태  | 환경/연동 결과의 context key와 최신 여부를 검사하고 필요한 시점에 다시 확인                   | Docker 중단·연결 변경·저장소 이동 시 과거 완료 체크와 별개로 현재 준비 실패 표시                   |
| 오래된 응답     | 감지 요청 병합과 generation/epoch로 오래된 결과가 최신 상태를 덮지 않게 처리                  | 프로젝트/연결 revision에 묶인 probe 결과만 반영. 재검사·취소·앱 복귀 시 갱신                       |
| 테스트          | 격리 userData로 첫 실행, 단계 이동, 테마, 건너뛰기, 프로젝트 모달, 키보드 흐름 검사           | DB 없는 첫 시작과 정상/실패/재시작까지 실제 Electron E2E로 검증                                    |

근거 파일은 문서 하단의 고정 commit 링크를 따른다. 여기서 관찰한 온보딩은 Orca의 전체 기능이나 모든 버전의 동작을 대표하지 않는다.

## 추천하는 루프리 온보딩

### 1. 환영과 연결

화면 제목: **“루프리에서 첫 프로젝트를 시작하세요”**

- 설명은 한 문장: 요구사항과 설계를 정리하고, 본인 승인 후 에이전트가 구현·검증을 진행한다.
- 라이트 / 다크 / 시스템 테마를 작은 선택 영역으로 제공한다.
- AI 연결: 이름, 지원 provider, endpoint, model, API key. 저장과 연결 검사를 구분한다.
- key는 main vault에 저장하고 화면에는 저장 여부만 반환한다. 연결 검사는 소량의 비용이 들 수 있음을 실행 버튼 옆에 표시한다.
- 연결을 나중에 설정할 수 있지만 실행 준비 완료로 표시하지 않는다. 기존 정상 연결이 있으면 다시 입력하지 않는다.

### 2. 로컬 환경 준비

- Git·Docker·전용 DB·실행 이미지의 상태를 보여준다. 이미 준비된 항목은 확인 결과만 표시한다.
- **“환경 준비”**를 누르면 필요한 다운로드와 전용 자원 생성을 수행한다. 앱 바깥 터미널에 명령을 복사하는 절차를 기본 경로로 삼지 않는다.
- 상태: 확인 중 / 준비 필요 / 준비 중 / 완료 / 문제 발생. 진행률을 모르면 퍼센트를 만들지 않는다.
- 오류에는 실패 단계·원인·다음 행동을 보여주고 상세 로그는 접는다. 성공한 단계는 유지하고 실패 지점부터 재검사한다.
- Docker 미설치 상태에서도 온보딩과 설정을 볼 수 있다. 자동 설치나 OS 권한 동의 대신 설치 안내와 다시 확인을 제공한다.
- DB 없이 열리는 bootstrap UI와 준비 상태 저장은 기존 설치 제안의 구현 선행 조건이다.

### 3. 내 프로젝트 등록

- **“저장소 폴더 선택”**으로 실제 기존 Git 저장소를 연결한다. 첫 버전의 Git/패키지 지원 범위를 확인하고 미지원 구조는 정확히 알려준다.
- 이름·기준 브랜치·읽어낼 수 있는 패키지 명령을 제안한다. 가져오기를 위해 clone/push/install을 자동 실행하지 않는다.
- CLAUDE.md / AGENTS.md / convention 문서는 후보로 표시한다. 사용자가 선택한 원문을 프로젝트 지침 초안으로 가져온다. 파일 안의 명령을 이 단계에서 실행하지 않는다.
- 전역 적용 여부는 사용자가 명시적으로 고른다. 한 저장소의 관례를 모든 프로젝트에 자동 확산하지 않는다.
- 기존 사용자 환경은 유지/이전 선택과 검증을 거친다. 온보딩을 다시 열어도 프로젝트를 중복 생성하지 않는다.

### 4. 개발 기준과 에이전트 구성

- **“기본 흐름 사용”**과 **“직접 구성”**을 제공한다. 기본 흐름은 사용자가 적용하는 실제 설정 템플릿이며 샘플 작업이 아니다.
- 전역 지침과 프로젝트 지침의 출처를 나란히 보여준다. Markdown 원문·미리보기·실제 적용 내용 보기를 제공한다.
- 단계마다 에이전트를 추가한다. 예: 구현 1명 → 고정 검사 → 컨벤션 검증 + 보안 리뷰. 초기 단계 내부 실행은 순차다.
- 각 행은 이름·역할·필수 여부·모델 연결·지침 버전·권한을 표시한다.
- “Claude Code 연결”은 실행 도구/모델 연결이며 “컨벤션 검증자”는 그 연결을 사용하는 역할 정의다. 두 개를 같은 설정으로 섞지 않는다.
- 온보딩 화면에서 모든 고급 옵션을 펼치지 않는다. 기본 흐름을 적용하고 이후 라이브러리·프로젝트 설정에서 세부 편집한다.

### 5. 첫 요구사항으로 연결

- 마지막 화면은 현재 준비 상태와 미완료 항목을 보여주고 **“첫 요구사항 작성”**으로 이동한다.
- 사용자가 직접 입력한 요구로 시작한다. 자동 모델 호출·자동 본인 승인·자동 PR 생성은 하지 않는다.
- 마지막 버튼을 눌렀다고 개발 성공으로 표시하지 않는다.
- 사이드바의 **“시작 가이드”**에서 미완료 항목을 다시 열 수 있게 한다. 알림은 실제로 필요한 시점에 설정하도록 안내한다.

```mermaid
flowchart LR
  A[연결 · 테마] --> B[환경 확인 · 준비]
  B --> C[내 저장소 등록]
  C --> D[지침 · 단계별 에이전트]
  D --> E[첫 요구사항 작성]
  E --> F[설계 검토 · 본인 승인]
  F --> G[구현 · 고정 검사 · 리뷰]
  G --> H[결과 확인 · 머지 승인]
```

화면 구조: 상단 루프리 로고와 현재 단계, 중앙은 한 가지 목적의 입력·상태 카드, 하단은 뒤로/다음과 나중에 하기. 작은 창에서도 하단 버튼을 고정하고 내용만 스크롤한다. 1024×700, 한국어 긴 문구, 키보드 포커스, 라이트/다크에서 확인한다. 설명을 읽는 것보다 실제 설정이 남는 흐름을 우선한다.

## 상태와 구현 경계

세 가지를 구분한다.

1. **온보딩 진행:** 마지막 화면, 입력 초안, 닫기/완료. main의 로컬 저장으로 DB가 없어도 재개 가능.
2. **현재 실행 준비:** 환경·연결·프로젝트 검사 결과와 검사 시점, 입력 revision. 실제 검사로 계산하며 stale 결과를 폐기.
3. **첫 사용 이력:** 첫 설계·승인·실행·검토를 수행한 기록. DB의 실제 사건으로만 완료 처리.

환경이 중단되면 첫 사용 이력은 유지하면서 현재 준비 상태만 실패로 바뀐다. 설치 마법사를 생략해도 설계 승인과 실행 gate를 생략할 수 없다. 기존 설정 화면과 온보딩은 동일한 명령/API를 호출하여 두 곳에서 다른 규칙으로 저장되지 않게 한다.

예상 코드 경계(아직 미구현):

- `src/shared/onboarding.ts`: 저장 진행 계약과 UI 표시 상태.
- `src/main/bootstrap/`: DB 이전의 상태 저장·환경 검사·준비 작업 및 복구.
- `src/preload/`: 허용된 상태 조회/준비/취소/설정 명령.
- `src/renderer/src/onboarding/`: shell, 단계별 view, 전환/저장 controller.
- 기존 연결·프로젝트·harness 도메인: 실질 검증과 저장을 소유. 온보딩은 이를 연결하는 UI.
- `tests/desktop-onboarding.integration.ts`: 임시 프로필·전용 자원 기반 시나리오. 실제 provider/서명 테스트는 별도 근거.

## 코드 벤치마킹 기준

먼저 작고 독립적인 패턴을 루프리 계약에 맞춰 구현한다. 특히 step 탐색, 중복 저장 방지, 입력 정제, 최신 감지 결과만 반영, 체크리스트 집계, 실패 E2E를 우선한다. Orca의 전역 store·runtime·telemetry·provider catalog 전체를 끌어오는 변경은 첫 설치 개선에 필요한 범위를 넘으므로 모듈별 의존성을 확인한 뒤 결정한다.

고정 commit의 LICENSE는 MIT다. 실제 소스를 가져오는 경우 원문 저작권/허가 고지, upstream commit과 파일 경로, 변경 내용을 `THIRD_PARTY_NOTICES` 및 출처 기록에 포함하고 배포 패키지에 유지한다. 이번 조사에서는 제품 코드나 아이콘·브랜딩을 복사하지 않았다. 라이선스 파일 확인은 전체 의존성/자산 권리 검토를 대신하지 않는다.

Orca의 permission 모드는 여러 CLI의 승인 생략 플래그를 구성한다. 이 UI를 그대로 가져와 사용자의 필수 승인까지 해제하는 옵션으로 만들지 않는다. 루프리의 자동 실행 권한은 승인된 설계·격리 실행·고정 검사 범위 안에서 main/runner가 제어한다. Orca의 telemetry/star 요청도 이번 온보딩의 필수 구성으로 가져오지 않는다.

## 구현 순서와 인수 기준

순서: **DB 없는 시작 shell → 저장·재개와 환경 준비 → 연결/프로젝트 공통 폼 → 지침/에이전트 구성 연결 → 첫 요구사항 handoff → Electron E2E → 서명된 다른 Mac 설치 검증**.

필수 시나리오:

- 새 프로필, DB 없음, Docker 없음에서도 UI가 열림.
- 다음/뒤로/나중에/다시 열기/강제 종료·재시작 후 입력 보존.
- 저장 실패 때 다음 단계로 넘어가지 않고 재시도 가능.
- 중복 클릭·동시 창 요청·재실행에도 프로젝트/컨테이너 중복 없음.
- 설정 변경 중 오래된 연결/환경 검사 응답이 새 상태를 덮지 않음.
- 필수 미완료 상태로 마법사를 닫아도 실행은 차단되고 이유가 표시됨.
- 지침 파일 가져오기에 실행 부작용·자격 증명 자동 전송 없음.
- 샘플 기록 없이 실제 첫 요구사항으로 이동. 본인 승인 없이 구현 안 됨.
- 기존 사용자에게 새 설치를 강요하거나 기존 DB를 초기화하지 않음.
- 설정 파일 손상·버전 변경 시 원본 보존, 재개/복구 안내.
- 작은 창·한국어·키보드·다크모드에서 입력과 버튼 접근 가능.

이 문서의 화면/구조는 제안이다. 제품에 온보딩이 추가되었다거나 Orca 테스트를 직접 통과했다고 주장하지 않는다.

## 고정 소스 링크

- [단계 정의](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/src/renderer/src/components/onboarding/use-onboarding-flow-types.ts)
- [온보딩 화면/입력](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/src/renderer/src/components/onboarding/OnboardingFlow.tsx)
- [설치 감지 기반 에이전트 선택](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/src/renderer/src/components/onboarding/AgentStep.tsx)
- [진행 저장/종료 중복 처리](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/src/renderer/src/components/onboarding/use-onboarding-flow-persistence.ts)
- [단계 생략/버전 매핑](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/src/renderer/src/components/onboarding/onboarding-flow-state.ts)
- [상태 계약](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/src/shared/onboarding-state-types.ts)
- [IPC 입력 정제](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/src/main/ipc/onboarding.ts)
- [저장 상태 정규화/업그레이드](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/src/main/persistence/applying-settings/onboarding-normalization.ts)
- [시작 가이드 준비 상태](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/src/renderer/src/components/setup-guide/use-setup-guide-progress.ts)
- [환경 감지 동시 요청/오래된 응답 처리](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/src/main/preflight/agent-detection.ts)
- [실제 프로젝트 추가 체크리스트](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/src/renderer/src/lib/onboarding-project-checklist.ts)
- [첫 실행 E2E](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/tests/e2e/onboarding.spec.ts)
- [CLI 권한 모드](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/src/shared/tui-agent-permissions.ts)
- [라이선스](https://github.com/stablyai/orca/blob/f2ca3cbfb7bdff0b7bf82a35a83fc49f13d1c857/LICENSE)
