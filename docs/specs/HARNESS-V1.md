# Roopre Harness v1

상태: v0.4 로컬 베타의 교환 계약. 회사별 Git 저장소에서 검토할 수 있는 선언적 JSON + Markdown 형식이다. Claude Code 자체 설정 파일과 동일한 형식은 아니다.

## 앱에서 사용하는 순서

1. **하네스 표준**에서 대상 프로젝트를 고른다. **기본 표준으로 시작**은 요구사항 작성자·설계자·설계 검토자·구현자·인수 검증자·컨벤션 검증자·코드 리뷰어 7개를 제공한다. 설계 검토 에이전트는 사용자 본인 승인을 대신하지 않는다.
2. **표준 스펙 편집**에서 package ID/버전, 프로젝트 프로필, 단계 배치·검사 명령·기능 디렉토리를 편집한다. **디렉토리·Markdown**에서 공통/프로젝트/단계/에이전트/기능 지침을 편집한다. 저장되지 않은 편집은 화면을 나가면 사라지므로 검증 후 폴더로 내보낸다.
3. **편집 내용 검증** 후 **구성·변경 비교**에서 대상 프로필, 검사 명령과 지침, 영향을 받는 설계를 확인한다. `project` 외 연결 별칭은 이 Mac에 등록된 연결에 매핑한다.
4. **프로젝트에 적용**한다. 전체 패키지 스냅샷과 선택 프로필·digest·출처를 DB에 저장한다. 실제 프로젝트 경로/기준 커밋/API 연결은 별도 설정한다. 적용은 모델이나 검사 명령을 실행하지 않는다.
5. **기능별 디렉토리·지침**에서 실제 기능에 범위 템플릿을 연결한다. 실행 전에 설계를 재게시·본인 승인한다.
6. **폴더로 내보내기**는 선택한 상위 폴더 안에 새 폴더를 만든다. 기존 폴더에 덮어쓰거나 자동 Git push하지 않는다. 파일을 팀 저장소에 넣고 PR로 검토한다. 다른 개발자는 **폴더 가져오기** 또는 HTTPS Git 주소/ref로 같은 표준을 가져온다.

적용된 원본 패키지와 현재 로컬 설정 내보내기는 다르다. **현재 설정 불러오기**는 선택한 프로젝트의 실제 에이전트/배치/검사와 보완 지침을 하나의 프로필로 변환한다. 원본의 다른 프로필은 포함하지 않는다. 기존 공유 버전과 다른 내용이라면 버전을 올린다. 회사 기준과 로컬 필수 검사의 합집합을 유지하므로 표준을 바꿔도 기존 필수 검사 이름이 사라지지 않는다.

## 폴더 계약

```text
company-harness/
├── harness.json                       # files-v1 manifest
├── harness.lock.json                  # ID/version/content SHA-256
├── policies/company.md                # 회사 공통 지침
├── agents/
│   ├── developer.md
│   └── code-reviewer.md
└── projects/commerce/
    ├── instructions.md
    ├── steps/
    │   ├── requirements.md
    │   ├── design.md
    │   ├── implementation.md
    │   ├── verification.md
    │   └── review.md
    └── features/checkout/instructions.md
```

`harness.json`은 `{"schema":"roopre.harness/files-v1","definition":{...}}`다. definition은 아래 inline 계약과 같되 지침 문자열을 `{"file":"policies/company.md"}` 같은 참조로 바꾼다. 파일 경로는 위 레이아웃과 ID에서 정해지며 임의 경로·외부 파일 참조는 허용하지 않는다. 단계 배치·검사·기능 paths는 manifest에 있고 설명 지침만 Markdown에 둔다.

앱 JSON 편집기와 [JSON Schema](roopre.harness-v1.schema.json)는 **inline 계약**을 사용한다. JSON Schema만으로 모든 참조/권한 검증을 대신하지 못한다. 폴더는 아래 CLI로 검사한다. 미지원 필드/버전은 묵인하지 않고 거절한다.

| 필드                | 의미                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| schema              | `roopre.harness/v1` 고정                                                                            |
| id / version / name | 회사 표준의 안정적인 ID, `1.0.0` 또는 `1.0.0-beta.1` 형태 버전, 표시 이름                           |
| instructions        | 회사 공통 Markdown                                                                                  |
| agents[]            | id, name, description, capability, instructions, connection                                         |
| profiles[]          | id, name, instructions, stageInstructions, assignments, checks, requiredChecks, scopes, 선택 limits |
| capability          | `read-only` 또는 `implementation`; 구현 단계만 implementation 허용                                  |
| connection          | `project`는 프로젝트 연결 상속, 그 외는 로컬 연결을 지정할 논리 별칭                                |
| assignments[]       | id, agentId, stage, required; 각 단계에서 배열 순서로 실행                                          |
| stageInstructions   | requirements/design/implementation/verification/review 5개 Markdown                                 |
| checks[]            | name, argv 문자열 배열, timeoutSeconds; 빈 배열은 로컬 검사 명령 사용                               |
| requiredChecks[]    | 필수 검사 이름. `review`는 프로그램의 리뷰 결과이며 shell 검사 명령이 아님                          |
| scopes[]            | id, name, paths[], instructions; 실제 기능이 선택할 디렉토리 템플릿                                 |
| limits              | budgetUsd, timeoutMinutes, repairLimit; 적용값이자 이후 로컬 설정 상한                              |

ID는 중복할 수 없으며 모든 assignment는 패키지 안의 에이전트를 참조해야 한다. 필수 구현자와 필수 리뷰어는 각각 적어도 하나 필요하다. 여러 에이전트는 같은 단계에 배치할 수 있다. 조직 프로필 여러 개를 한 패키지에 넣고 각 앱 프로젝트가 하나를 선택한다. 프로필 ID는 로컬 DB 프로젝트 UUID가 아니다.

기능 범위 예:

```json
{
  "id": "checkout",
  "name": "결제",
  "paths": ["src/checkout/", "src/api/payments/", "tests/e2e/checkout/"],
  "instructions": "결제 실패·중복 요청·재시도 시나리오를 확인한다."
}
```

paths는 **저장소 기준 상대 디렉토리 접두사**이며 `/`로 끝난다. glob, 절대 경로, `..`, `.git`, 특수 파일은 허용하지 않는다. 한국어와 공백은 지원한다. 선택한 범위 지침은 실행 스냅샷에 들어간다. 실행기는 고정 검사 전과 최종 커밋 전에 staged diff 전체 경로를 검사해 범위 밖 변경 결과를 거절한다. 컨테이너의 파일별 OS 쓰기 권한을 paths로 분리하는 기능은 아니다. 범위를 해제/변경하면 재승인이 필요하다.

## 버전·잠금·정책

- content digest는 검증된 inline 객체의 키를 정렬한 canonical JSON의 SHA-256이다. 원문 Markdown의 공백/줄바꿈은 보존된다. 같은 내용의 폴더 왕복은 digest가 같다. 개인 경로·연결 UUID·승인 기록은 digest 대상 패키지에 없다. 실행 승인 binding은 로컬 실행 환경까지 포함하므로 개발자마다 같을 필요가 없다.
- lock은 schema=`roopre.harness-lock/v1`, packageId, version, digest 네 필드다. 내보내기 때 생성한다. 외부 폴더는 lock 없이도 검증/가져올 수 있지만 lock이 있으면 반드시 내용과 일치해야 한다. 팀 저장소에서는 lock 커밋을 권장한다.
- 같은 워크스페이스에 설치된 동일 ID+version의 다른 내용은 거절한다. 새 버전으로 명시적으로 적용한다. 이전 버전도 새 적용 요청으로 돌아갈 수 있지만 예전 승인 증빙은 복원하지 않는다. 전사 영구 버전 registry나 폐기 목록은 없다.
- 패키지는 프로젝트별로 고정한다. 다른 프로젝트가 쓰는 버전을 자동으로 바꾸지 않는다. 같은 패키지를 재적용해 동일하면 에이전트 버전/설계를 건드리지 않는다. 일반 설정에서 imported 에이전트와 단계 배치를 바꿀 수 없으며 패키지를 편집해 새 버전으로 적용한다.
- 회사·프로젝트·기능 지침과 기존 로컬 전역/단계/역할 지침이 실행에 함께 들어간다. Markdown 의미 충돌을 자동 해결하지 않는다. 로컬 프로젝트 지침 보완·검사 명령 변경은 화면에 표시한다. 필수 검사 합집합, 권한, 본인 승인, 예산/시간/수정 상한은 코드로 검사한다.
- 진행 중이거나 종료가 확인되지 않은 프로젝트에는 적용하지 않는다. 미리보기 후 워크스페이스 revision이 바뀌면 **비교 새로고침**이 필요하다. 현재는 다른 프로젝트의 변경에도 보수적으로 다시 비교한다.
- 변경 적용은 하나의 DB 트랜잭션이다. 현재 프로젝트의 설계 승인만 무효화하고 다른 프로젝트/전역 정책은 유지한다. 실행은 저장된 스냅샷을 사용하므로 원본 Git 변경이 자동 유입되지 않는다.

## 팀 저장소와 CLI

루프리 저장소의 설치된 도구로 팀 표준 폴더를 검증한다.

```bash
pnpm harness:validate /path/to/team-harness
# Markdown/manifest를 검토해 수정하고 version을 올린 뒤 lock 재생성
pnpm harness:lock /path/to/team-harness
pnpm harness:validate /path/to/team-harness
```

명령은 패키지의 검사 argv를 실행하지 않는다. lock 명령은 스키마/참조 검증 후 digest를 갱신하며 정책 변경의 승인 대신 사용하지 않는다. Git PR의 담당자 리뷰에서 이전 버전과 변경 내용을 함께 확인한다. `pnpm harness:schema`는 inline 스키마를 재생성한다.

Git 가져오기는 HTTPS 주소와 branch/tag/commit을 입력받아 실제 commit을 고정해서 읽는다. URL의 사용자/비밀번호/query/hash를 거절한다. 별도 bare 저장소에서 checkout 없이 읽고 hooks/submodule/LFS/임의 Git helper를 실행하지 않는다. macOS 기본 osxkeychain 자격 증명만 사용하므로 다른 로그인 방식은 직접 clone한 뒤 폴더 가져오기를 사용한다. Git 출처 URL+commit은 로컬 설치에 저장하고, portable lock은 내용 hash를 기록한다. Git 자동 갱신/업데이트 알림/push/PR 생성은 없다. 가져온 뒤 네트워크 없이도 저장된 표준을 사용할 수 있지만 조직의 최신 정책 여부를 보증하지 않는다.

교환 한도: 전체 4 MB/1,000파일, manifest 180 KB, Markdown 파일 80 KB 및 지침 20,000자, 에이전트 100개, 프로필 30개, 프로필별 배치 30개/범위 30개/검사 20개. 심볼릭 링크·특수 파일·경로 탈출을 거절한다. 미리보기 토큰은 30분/최근 10개까지만 유효하며 만료되면 재검증한다.

## 공유하지 않는 것과 후속 범위

내보내기는 선언된 설정만 만든다. 연결 endpoint/API key·로컬 저장소 경로·DB 인증 정보·실행 로그·대화·작업 설계/승인 증빙을 수집하지 않는다. 사용자가 지침/검사 argv에 직접 붙여넣은 비밀까지 자동 제거하지는 않으므로 공유 파일을 검토한다. 실제 기능 작업의 requirements/design Git 내보내기, 부분 단계만 내보내기, 경로별 별도 에이전트 배치, YAML, `.roopre` 자동 동기화는 이번 v1에 없다.

팀원이 같은 검증 기준/흐름을 가져오게 하는 도구다. 회사 차원의 강제는 별도 인증·CI·저장소 보호가 필요하며 로컬 앱만으로 조직 관리자 통제를 제공하지 않는다. 모델 결과가 동일 품질로 수렴한다는 보장도 아니다. 현재 실행 지원은 기존 Node 단일 패키지에 한정된다.
