# v0.2 구현 검증 — 2026-09-18

사용자의 [v0.2 구현 승인](design/V02-APPROVAL.md)에 따라 로컬 owner 파일럿을 구현했다. 아래 M1/설계 준비 기록은 과거 결과이며 현재 상태는 이 절을 우선한다.

## 수행한 검사

| 검사                                                                           | 결과와 범위                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 포맷·현재 문서 링크·승인 문서 3개 SHA-256                                      | 통과                                                                                                                                                                            |
| Node/renderer 타입·Swift helper·Electron build                                 | 통과                                                                                                                                                                            |
| 도메인·실제 PostgreSQL·연결 저장·broker 스트림/오류 비밀 제거·산출물·중단 회귀 | 32개 통과; M1 21개 포함                                                                                                                                                         |
| 실제 Docker 통합 시나리오                                                      | 통과. 중복 claim, 고정 이미지 ID와 lockfile 준비, 독립 clone, Git metadata 쓰기 차단, broker 접근 제한, 고정 검사, 읽기 전용 리뷰, commit, 컨테이너 정리, 중단·변경 복구·재검증 |
| Chromium 사용자 흐름                                                           | 3개 통과. 테마/재시작 유지/시스템 추종, 프로젝트·기능 DB 저장과 승인 전 실행 차단, 입력 중 polling·실행 현황                                                                    |
| macOS 인증 helper                                                              | 컴파일과 `--check`의 available 확인. 실제 사용자 인증 성공은 미검증                                                                                                             |
| Apple Silicon 개발 앱                                                          | v0.2 패키지 생성. 서명·공증 없음                                                                                                                                                |

Docker 통합 검사에서 **Claude Code는 테스트용 프로그램으로 대체했다. 실제 모델 요청과 유료 사용은 하지 않았다.** 브라우저 시나리오는 실제 renderer와 임시 PostgreSQL/domain을 사용하지만 IPC는 테스트용 transport다. Electron IPC·macOS 인증·Keychain 검사를 대신하지 않는다. 테스트가 임시 workspace에서 넣는 승인 proof는 계약 검사용이며 사용자의 실제 기능에 승인을 기록하지 않는다.

검사 중 macOS의 `/var` 경로가 `/private/var`로 정규화되는 차이와 UI의 탭 역할 선택 오류를 발견해 테스트를 수정했다. 구현에서는 폴링이 실행 프로필 입력을 덮어쓰는 문제, 원본 Git metadata 노출, 테스트 산출물 덮어쓰기, 종료 확인 전 재실행 문제를 보완했다. headless 캡처로 1280×800 다크와 1024×700 라이트 설정 화면을 확인했다.

재현 명령은 `pnpm check`, `pnpm test:runner`, `pnpm test:web`, `pnpm build:mac`다. Docker 검사는 `pnpm runner:image`, 브라우저 검사는 `pnpm exec playwright install chromium`, DB 검사는 `pnpm db:start`가 선행 조건이다. 기본 CI에는 `pnpm check`와 브라우저 검사를 연결했다. Docker 검사는 별도 명령이며 기본 CI에서 실행하지 않는다.

로컬 증거는 git에서 제외한 `artifacts/check-v02.log`, `artifacts/runner-integration.log`, `artifacts/web-tests.log`, `artifacts/web-report`, `artifacts/package-v02.log`, `artifacts/runtime-dark.png`, `artifacts/runtime-light-minimum.png`다. 패키지는 `release/루프리-darwin-arm64/루프리.app`이다.

## 실무 투입 전에 남은 조건

1. Mac 잠금 때문에 이번 턴의 네이티브 화면 직접 조작은 수행하지 못했다. 사용자가 앱에서 본인 승인 성공/취소, 재시작 후 암호화 key 복원, native 폴더 선택을 확인해야 한다.
2. 실제 API key/endpoint가 등록되지 않아 Messages 스트리밍·Claude 도구 호출·provider 비용 보고는 미검증이다. 연결 검사는 단일 소량 응답 검사이며 이것만으로 모든 gateway 호환성을 인정하지 않는다. 최초에는 폐기 가능한 작은 저장소와 명시적인 예산으로 실행한다.
3. 루프리 자체 전체 개발은 아직 이 앱으로 완료하지 않았다. 현재 루프리 테스트는 PostgreSQL/native 환경이 필요한데 runner는 Node 단일 패키지와 lockfile만 준비한다. 서비스 컨테이너·macOS 작업 지원 후 실제 자체 개발을 검증한다. 이번 Docker fixture 결과를 자체 개발 성공으로 표시하지 않는다.
4. 역할별 별도 모델 연결, feature 의존성 자동 통합, 서비스 DB/사설 registry/monorepo 준비, 독립 runner daemon, 장기 무진행 watchdog, 보관 기간 자동 정리는 후속이다. 기존 테스트/설정/manifest 수정은 현재 보호 정책상 자동 진행하지 않는다.
5. 팀 계정·SSO·원격 runner·CI 승인 강제·백업 운영·서명·공증은 M3다. 로컬 OS/DB/Docker 관리자는 신뢰 경계에 포함한다. 현재 빌드를 여러 개발자의 팀 운영 완료본으로 설명하지 않는다.

실행 예산은 CLI 보고값에 기반한 추정 한도다. gateway의 실제 청구액이나 agent가 만든 추가 요청에 대한 절대 비용 상한은 보장하지 않는다. 시간·수정 횟수·요청 수 제한과 별도로 provider의 지출 한도를 설정한다.

---

# 저장소 이전 검증

2026-09-18. 이전 대상은 M1 구현이다. 이번 변경은 저장소·빌드·개발 환경 구성으로, 실제 에이전트 실행 기능을 추가하지 않는다.

| 검사                                      | 결과                                                          |
| ----------------------------------------- | ------------------------------------------------------------- |
| pnpm frozen lockfile 설치                 | 통과                                                          |
| 포맷·현재 문서 링크·승인 설계 해시        | 통과                                                          |
| Node/renderer 분리 타입 검사              | 통과                                                          |
| electron-vite main/preload/renderer build | 통과                                                          |
| 도메인 + 실제 PostgreSQL API 테스트       | **21 통과 / 0 실패 / 0 skip**                                 |
| macOS Apple Silicon 패키지                | 생성 성공, 약 276 MB                                          |
| pnpm audit                                | 알려진 취약점 없음                                            |
| pnpm dev 시작                             | 새 폴더의 API·renderer·Electron 프로세스 시작 확인            |
| 브라우저에서 새 renderer 읽기             | Roopre 제목, 동기화 상태, 기존 영수증 설계 v2와 승인 0/2 확인 |

21은 상위 API 테스트와 하위 테스트를 포함한 테스트 러너의 집계다. 전체 제품 인수 시나리오 21개를 완료했다는 뜻이 아니다. 최초 원격 CI도 [성공](https://github.com/benny1020/roopre/actions/runs/35238923899)했다. 이후 실행 상태와 자동 검사는 [CI](https://github.com/benny1020/roopre/actions/workflows/ci.yml)에서 각 커밋에 대해 재현한다. 로컬 상세 로그는 git에서 제외된 `artifacts/check.log`, `artifacts/package.log`, `artifacts/audit.log`에 있다.

패키징 중 pnpm의 의존성 링크 탐색 실패를 확인해, 전체 소스/의존성 대신 빌드된 데스크톱 런타임만 임시 디렉터리에 준비하도록 수정했다. API는 별도 서버이므로 앱에 포함하지 않는다. Electron 바이너리가 설치 스크립트 생략으로 없을 때의 dev 시작 실패도 확인해 앱 시작 시 명시적인 바이너리 설치 단계를 추가했다.

승인 규칙/API/DB를 원본과 비교했으며 해당 모듈의 변경은 import 경로와 로그의 앱 이름이다. 승인 문서 원본 SHA-256은 `31a7f8c0c2bf171f6432dc70973f5056e5d33f791c9030bb8b6d19055c228832`로 동일하다. DB compose 프로젝트/볼륨은 유지했다.

[최초 M1 검증](design/M1-ORIGINAL-VERIFICATION.md)은 이전 폴더 기준의 역사 기록이다. 그 문서의 로컬 로그/앱 경로는 보존본 기준이며 현재 저장소의 실행 근거로 사용하지 않는다.

현재도 실제 CLI·worktree 병렬 실행·팀 인증·자동 웹 테스트는 연결하지 않았다. 네이티브 창 조작과 최소 창 크기 검증의 기존 제한도 유지된다. 서명·공증·공개 Release는 수행하지 않았다.

## 루프리 브랜딩 적용

- 표시 이름 `루프리`, 영문/저장 식별자 `roopre`. 기존 userData 경로를 명시해 설정과 초안을 유지한다.
- 내장 imagegen으로 제작한 아이콘의 PNG 1024px/alpha와 ICNS 내보내기를 확인했다.
- 브라우저에서 이름과 38px 아이콘의 정상 로딩·화면 표시를 확인했다.
- `pnpm check` 통과, 테스트 21개 통과. macOS 패키지 생성 및 프로세스 시작 확인.
- 패키지 Info.plist의 CFBundleDisplayName은 `루프리`, CFBundleIconFile은 `roopre.icns`다. 포함된 ICNS와 원본 ICNS의 SHA-1이 일치함을 확인했다.
- 패키지 경로는 `release/루프리-darwin-arm64/루프리.app`이다. macOS Dock 자체의 시각 조작 검증은 별도로 수행하지 않았다.

## v0.2 설계 준비와 직접 사용 — 2026-09-18

[v0.2 통합 검토 문서](design/PRODUCT-DESIGN-v0.2.md)는 기업 사례 비교, 본인 승인·API 연결·runner 설계, 웹 테스트 시나리오와 단계별 완료 기준을 포함한다. **문서 작업이며 제품 구현 완료가 아니다.** 이번 작업에서 애플리케이션 소스는 변경하지 않았다.

직접 사용 대상은 `8a5a97e6fda86d321adb1879bcda2846eeba9120`의 renderer와 실제 로컬 API/PostgreSQL이다. 브라우저 UI로 프로젝트·기능 생성, 7개 설계 절 작성, 초안 저장, 리뷰 요청을 수행했다. 새 브라우저 탭에서도 게시한 설계가 유지되는 것을 확인했다. 승인이나 실행은 생성하지 않았다.

| 항목                   | 기록                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| 프로젝트               | `Roopre · 자체 개발` / `project-093b4036-728`                            |
| 기능                   | `M2 · 본인 설계 승인과 API 연결 기반 자체 개발` / `feature-457ead74-178` |
| 앱의 요약 설계         | v1 / `design-212576fe-e05`                                               |
| 요약 설계 hash         | `a895c5988b963cf1a801ea8a9b90c5acbedd7d918568410fbad4fe1a75c4050a`       |
| 전체 v0.2 문서 SHA-256 | `f848a6f15fb6c987f16d5c581858545cd770c3459061d3f6a2e300911878254b`       |
| 승인/실행              | API에서 `decisions: []`, 해당 기능 `runs: []` 확인                       |
| 구현 시작 조건         | 초안 상태에서 실행 등록 버튼 비활성 확인                                 |
| 실행기                 | `/health`가 `development-fixture`, `runnerConnected:false` 반환          |
| CLI                    | `claude --version`, `--help`만 확인; 모델 호출 미수행                    |

위 DB 식별자는 이 로컬 워크스페이스의 기록이며 새 설치에 자동 배포되는 데이터가 아니다. 앱의 요약 문서 v1과 제품 설계 v0.2는 별도 버전 체계다.

1280×720 브라우저 화면에서 설계/리뷰 패널 표시를 확인했다. 506px 폭의 앱 내 브라우저 패널에서는 일부 내용이 잘렸으며, 이는 현재 Electron 최소 폭 1024px보다 좁은 환경이다. Electron 최소 폭과 네이티브 승인/Keychain/실제 CLI·웹 테스트 runner는 검증하지 않았다.

이번 문서 변경에는 포맷·로컬 링크·원본 v0.1 해시·diff 검사를 수행했다. 제품 소스 변경이 없어 기존 제품 테스트/패키징을 다시 수행하지 않았으며, 위 M1의 테스트 결과와 이번 문서 검토 결과를 구분한다.

## PR 전담 리뷰 프로세스와 발견 결함 수정 — 2026-09-18

사용자 요청으로 `pr_reviewer` 전담 역할과 리뷰 → 수정/재리뷰 → 최신 CI → 사용자 본인 승인 → 커밋 일치 머지 절차를 추가했다. [프로세스](PR-REVIEW-PROCESS.md)에 실행 명령, macOS 본인 승인, GitHub 보호 기능의 요금제 제한을 명시했다. 서버에서 직접 웹 머지까지 차단된 상태는 아니다.

전담 에이전트가 최초 head `a139a20ed286a106e9e6996c61253cbe83841991`을 검토해 P1 두 건을 격리 재현했고 [PR에 수정 요청 보고서](https://github.com/benny1020/roopre/pull/1#issuecomment-5723457427)를 게시했다.

- 필수 검사 추가 후 기존 실행 프로필로 재게시/승인/실행되는 누락을 수정했다. 현재 팀·프로젝트 검사 매핑을 게시·승인·gate/runner에서 공통 검사한다.
- 구현 에이전트가 node_modules의 검사 도구를 바꿀 수 있는 경계를 수정했다. 신뢰된 준비 단계만 별도 의존성 볼륨에 쓰며 구현/검증/리뷰는 읽기 전용이다.
- 원본 리뷰 보고서는 보존한다. 새 head의 별도 재리뷰와 CI가 통과해야 머지 승인을 요청한다. 보고서 head/base·CI·차단 지적·본인 인증 취소·승인 대기 중 커밋 변경에 대한 회귀 검사를 추가했다. 전체 `pnpm check` 37개와 브라우저 3개, Docker 통합 시나리오가 통과했다.

검사 로그는 `artifacts/review-process-tests.log`, `artifacts/review-process-runner.log`, `artifacts/review-process-check.log`에 기록한다. 실제 사용자 머지 승인과 GitHub merge는 수행하지 않았으며, 취소/변경 시 머지 차단은 외부 부작용 없는 모의 동작으로 검증한다. native 인증 성공과 실제 API 미검증 조건은 그대로 유지한다.

전담 재리뷰에서 Vite 7.3.6의 기본 `.vite-temp` 생성이 읽기 전용 의존성에 막히는 P2 회귀도 재현했다. `.vite`/`.vite-temp`만 컨테이너별 tmpfs로 분리하고 구현→검사→리뷰 사이 캐시가 보존되지 않는 회귀 검사를 추가했다. 의존성 실행 도구는 계속 읽기 전용이다.

검증 전에는 격리 체크아웃의 후보 Git tree를 고정하고 에이전트가 만든 ignored 파일을 제거한다. `.gitignore` 변경도 보호한다. Docker fixture에서 agent가 남긴 ignored 산출물이 검사 단계에 존재하지 않는 것을 확인한다. 원본 저장소와 이미 보존된 시도별 근거는 유지한다.

## 외부 배포 준비 보강 — 2026-09-18

`0.2.1-beta.1`의 구현 범위와 남은 결정은 [배포 안내](DISTRIBUTION.md)에 정리했다. 기존 승인 문서의 hash는 유지한다. 이전 head `673253c`의 리뷰 pass는 이번 변경의 승인이 아니며 새 head로 전담 PR 리뷰를 수행한다.

직접 수행한 검사:

- `pnpm check`: 포맷·문서·타입·Swift/Electron 빌드, 실제 DB 포함 46개 검사 통과. 새 IPC 경로·DB 오류·손상 vault·FIFO/크기/심볼릭 링크·종료 미확인 claim·잘린 Git 결과·한국어 청크 경계 회귀를 포함한다.
- `pnpm test:runner`: 실제 Docker 통합 시나리오 통과. 검사 timeout 시 컨테이너 안의 지연 쓰기와 다음 검사가 실행되지 않고 종료 확인되는 것을 검증했다. fixture CLI이며 실제 모델 호출이 아니다.
- `pnpm test:web`: 4개 Chromium 시나리오 통과. DB 오류를 모의한 IPC 응답 뒤 화면 보존·재연결 메시지 해제를 추가했다. 라이트/다크 스크린샷을 확인했다.
- `pnpm test:desktop`: 실제 Electron 프로세스와 빌드된 main으로 연결 실패→재연결→종료 검사 1개 통과. appData/HOME을 임시 폴더로 격리하고 도달 불가능한 fixture DB를 사용했다. 대화상자 선택만 fixture이며 실제 사용자 승인·Keychain 검사가 아니다.
- 패키지 생성 후 `pnpm verify:mac`: 포함 파일·pg/zod 버전·개발/비밀 파일 제외·fuse·codesign 무결성 통과. ZIP·SHA-256·commit/dirty/lockfile 정보를 생성했다. Developer ID 서명·공증·Gatekeeper 배포 판정은 미수행이다.
- `pnpm audit --prod`: 조회 당시 알려진 production 취약점 0건. 취약점 미발견은 전체 보안의 보증이 아니다.

로그는 `artifacts/release-check.log`, `release-runner.log`, `release-web.log`, `release-desktop.log`, `release-package.log` 및 `release-audit-dependencies.json`이다. 로컬 검증 산출물은 커밋하지 않는다. CI에는 Docker 시나리오와 macOS 패키징/시작 검사를 추가했으며 실제 원격 결과를 PR에서 확인해야 한다.

기존 실제 모델/API·네이티브 본인 인증 성공/취소·Keychain의 서명 변경 후 복원·별도 Mac 설치·DB 백업 복원·팀 운영 미검증 범위는 그대로다. 공개 배포나 머지를 수행하지 않았다.

`c36756e`의 Linux CI 2건과 macOS 패키지 1건은 원격에서도 통과했다. 전담 재리뷰는 스케줄러의 다른 프로젝트 대기와 한글 테스트 경로 누락을 P2로 재현했다. 프로젝트 점유 계산을 scheduler/claim에서 공통 적용하고 Git 파일 목록을 NUL 구분으로 읽도록 수정했다. 종료 미확인 A 프로젝트 뒤의 B 프로젝트가 선택되는 검사와 한글·줄바꿈·공백 경로 보존 검사를 추가했다. 새 커밋의 리뷰·CI 결과가 다시 필요하다.

## 샘플 데이터 분리와 빈 첫 실행 — 2026-09-18

제품 초기값을 실제 로컬 소유자와 필수 기본 지침만 포함하는 `emptyWorkspace`로 분리했다. 프로젝트·기능·실행은 빈 배열로 시작한다. 가상의 팀원/프로젝트/리뷰 결과는 `tests/fixtures`로 이동하고 필요한 검사에서만 명시적으로 주입한다. 기존 DB의 사용자 기록은 초기화하지 않는다. 개발 브라우저 미리보기는 새 전용 workspace를 사용하며 이전 기록은 보존한다.

프로젝트가 없는 상태에서 지침·연결 화면과 생성 대화상자가 열리도록 보완했다. 프로젝트별 저장은 첫 프로젝트를 만들기 전 비활성화하며 전역 지침은 바로 작성할 수 있다. 새 설치 → 설정 화면 → 첫 프로젝트 생성 → 재로딩 보존 시나리오를 실제 renderer/PostgreSQL로 검증했다.

- `pnpm check`: 포맷·문서·타입·빌드 및 47개 검사 통과. 기존 데이터 재초기화 방지 회귀 포함.
- `pnpm test:web`: 5개 시나리오 통과. 빈 첫 화면 스크린샷을 확인했다.
- `pnpm test:runner`: 실제 Docker 시나리오 1개 통과. 명시적인 fixture CLI이며 실제 모델 호출은 아니다.
- `pnpm test:desktop`: 격리된 실제 Electron 연결 실패·재연결·종료 시나리오 1개 통과. 실제 본인 인증 성공 검사는 아니다.

`pnpm build:mac`도 통과했으며 샘플 식별자가 main bundle에 없는 것을 포함해 패키지 파일·의존성·fuse·코드 서명 무결성을 검증했다. Developer ID 서명/공증은 아니다. 로그는 `artifacts/clean-start-*.log`다. 새로운 [v0.3 커스텀 에이전트/설치 설계](design/HARNESS-V03.md)는 검토용이며 구현됐다고 표시하지 않는다. 자동 환경 준비, 실제 모델 통합, 서명·공증, 별도 Mac 설치의 미검증 조건은 유지한다.

## v0.3 온보딩·커스텀 에이전트 — 2026-09-18

[V03-APPROVAL](design/V03-APPROVAL.md)의 최신 사용자 지시에 따라 구현했다. 제안 문서의 “미구현/승인 대기”는 제안 당시 이력이다. DB 없는 시작 가이드, 비밀을 제외한 입력 초안 저장·재개, 프로필별 DB/실행 이미지 준비, 기존 워크스페이스 백업·검증 이전, 버전별 에이전트 라이브러리와 Markdown 가져오기/내보내기, 단계별 복수 실행과 근거 표시가 현재 구현이다. 요구사항·설계 에이전트는 소스를 읽어 새 초안만 저장하며 본인 승인 없이 구현하지 않는다.

직접 수행한 검사:

- `pnpm check`: 포맷·문서/승인 원본 hash·타입·Swift/Electron 빌드와 56개 검사 통과. 에이전트 버전·권한·필수 단계·정책 변경 무효화, bootstrap 실패·취소·손상 파일 보존을 포함한다.
- `pnpm test:web`: 실제 renderer/PostgreSQL의 6개 시나리오 통과. 커스텀 Markdown 에이전트 → 기본 흐름 → 추가 검증자 → 저장·새로고침과 지침 출처 표시를 포함한다. 다크 화면을 직접 확인했다.
- `pnpm test:runner`: 실제 Docker 통합 2개 통과. 읽기 전용 초안 작성 → 미승인 보존 → fixture 승인 → 복수 구현/검증/리뷰 → 필수 검증 실패 시 차단. 전용 loopback DB 생성·저장 자격 증명으로 재연결, 기존 워크스페이스/이벤트/명령 백업·복원 해시 일치와 원본 보존도 검증했다.
- `pnpm test:desktop`: 격리된 새 프로필의 실제 Electron에서 DB 없이 시작 → 입력·단계·테마 저장 → 종료·재시작 복원 1개 통과.

근거는 `artifacts/v03-check.log`, `v03-web.log`, `v03-runner.log`, `v03-desktop.log`와 화면 캡처다. Docker의 Claude CLI와 승인 문맥은 명시적인 fixture다. 실제 provider 과금 요청·사용자 본인 인증 성공/취소·Keychain의 서명 변경 후 복원·별도 Mac 설치·Developer ID 서명/공증은 미검증이다. 로컬 베타이며 팀 서버/SSO·공개 배포·자동 업데이트를 완료한 버전이 아니다.

구현의 실용적 한계: Markdown 미리보기는 안전한 텍스트/제목/코드 중심의 제한된 렌더링이며 전체 CommonMark 편집기가 아니다. 선택 에이전트의 구조화된 검토 실패는 참고 결과로 남기지만 CLI/네트워크/시간 초과는 실행 전체를 중단한다. 자동 DB 이전은 단일 워크스페이스 50 MB, 이벤트/명령 각 10,000개 이내다. 첫 사용 체크리스트는 저장된 작업으로 집계하며 결과를 사람이 읽었다는 별도 감사 이벤트는 아직 수집하지 않는다. Endpoint 초안과 API key는 온보딩 진행 파일에 저장하지 않고, 등록한 연결은 암호화 vault에서 관리한다.

전담 리뷰 `722d759`에서 최초 DB identity 저장 실패 뒤 재시도하면 메모리의 identity만 남아 설정 파일 재저장을 건너뛰는 P2를 재현했다. 매 준비 시도마다 Docker 자원 접근 전에 identity 저장을 완료하도록 수정했다. 저장 경로 장애 → 장애 제거 → 재시도 → 재시작 복원 회귀를 추가했고 `pnpm check`는 57개로 늘었다. 선택 계획 에이전트가 모두 잘못된 결과를 반환하는 경우 원래 초안/revision을 보존하고 실패로 끝나는 Docker 회귀도 추가했다. 새 head의 전담 재리뷰와 원격 CI를 다시 확인한다.

## v0.4 하네스 표준 패키지 — 2026-09-18

[V04-APPROVAL](design/V04-APPROVAL.md)에 따라 [Harness v1](specs/HARNESS-V1.md)을 구현했다. 회사/프로젝트/단계/에이전트/기능 디렉토리의 JSON+Markdown 폴더, 버전/content digest/lock, 7개 기본 역할, 폴더와 HTTPS Git import, 변경 비교·연결 별칭 매핑·프로젝트 적용·export, CLI 스펙 검증을 포함한다. 원본 제안의 YAML, 자동 업데이트, 부분 export, 기능 설계 문서 Git 동기화, 전역 비서/조직 서버 강제는 구현 완료가 아니다.

직접 수행한 검사:

- `pnpm check`: 타입·문서 링크/승인 원본 hash·빌드와 68개 검사 통과. 새 검사는 엄격한 참조/권한/경로, Markdown 왕복과 lock 불일치, 실제 Git 객체의 고정 commit/symlink 거절, 후보 위변조 방지, 반복 적용의 안정적인 ID/버전, 원자적 실패·다른 프로젝트 보존·연결 별칭·요청 중복 충돌을 포함한다.
- `pnpm test:web`: 7개 Chromium 시나리오 통과. JSON 편집 → 검증 → 미리보기 → 동일 후보의 두 프로젝트 적용 → 재적용 → 기능 디렉토리 연결 → 새로고침 보존. 다크 Markdown 편집 화면 확인.
- `pnpm test:runner`: 실제 Docker/DB 통합 2개 통과. 추가 회귀는 표준과 기능 범위를 적용한 후 fixture 구현자가 범위 밖 파일을 만들면 고정 검사/최종 commit 전에 실패하며 성공 head가 생기지 않는 것을 확인한다.
- `pnpm test:desktop`: 실제 빌드된 Electron의 DB 없는 시작·재시작 시나리오 1개 통과. 기본 표준의 main/preload API → 폴더 export → lock → 동일 폴더 import/digest 일치를 추가했다. 파일 선택 결과만 격리된 임시 폴더 fixture이며 사용자 네이티브 인증 성공 검사는 아니다.
- `pnpm check:mac`: 임시 macOS 앱의 포함 파일·의존성·fuse·코드 서명 무결성 통과. ZIP 생성/공개 배포/Developer ID 서명·공증은 수행하지 않았다.

근거: git에서 제외된 `artifacts/package-check.log`, `package-tests.log`, `package-web.log`, `package-runner.log`, `package-desktop.log`, `package-mac-check.log`, `harness-package-dark.png`. Git의 실제 객체/고정 commit 읽기는 로컬 저장소로 검증했다. 원격 HTTPS 서버와 private Git 자격 증명 성공 경로는 별도 실환경 검증이 필요하다. 실제 provider 호출·본인 인증 성공/취소·서명 변경 후 Keychain·별도 Mac 설치 미검증은 유지한다. 브라우저의 native 파일/연결 API는 fixture이며 실제 파일 왕복은 Electron 검사에서 검증했다.

표준은 프로젝트별 DB 스냅샷으로 실행하며 팀 공유 파일에는 인증·경로·실행/승인 이력을 담지 않는다. 임의 Markdown/검사 argv에 사람이 넣은 비밀의 자동 제거는 보장하지 않는다. 경로 제한은 후보 diff 검증이며 컨테이너 파일별 쓰기 권한 분리는 아니다. UI 초안은 화면 이동 전에 검증·내보내기해야 한다. 다른 프로젝트 상태 변경도 현재 workspace revision 비교를 보수적으로 실패시킬 수 있다. 전담 리뷰와 원격 CI 결과는 해당 PR의 정확한 head를 기준으로 별도 확인한다.

전담 리뷰는 `0a50cb4`에서 `constructor` 연결 별칭이 객체의 상속 속성 때문에 누락 검사를 통과해 프로젝트 연결로 대체되는 P2를 독립 재현했다. domain과 UI에서 실제 등록된 키만 인정하도록 수정하고 회귀를 추가했다. 후보의 30분 만료 뒤 편집 없이도 재검증할 수 있도록 버튼을 보완하고 만료/재검증 검사도 추가했다. 새 head의 전담 재리뷰와 CI를 다시 확인한다.

## ADE workspace redesign (2026-09-21)

Implementation and audit: [ADE workspace](design/ADE-WORKSPACE.md). Renderer-only presentation/navigation changes preserve Electron IPC, authenticated design approval, execution contracts and package import/export. New shared renderer primitives cover keyboard tabs/dialogs/separators, run-specific diff, evidence and contextual instructions.

Local verification: `pnpm check` (format, approved-doc integrity, typecheck, Electron build and 72 unit/database tests); `pnpm test:web` (13 browser scenarios, including 7 WCAG A/AA axe scans across dark/light, compact design/execution, review, overview and command dialog); `pnpm test:runner` (2 Docker integration scenarios); `pnpm test:desktop` (1 Electron installation/restart/theme/native-file scenario); `pnpm check:mac` (temporary app integrity, no ZIP). Logs: `artifacts/ade-{check,web-check,runner,desktop,mac-check}.log`.

Visual inspection included 1440×940 and 1024×700, both themes, diff, design review, settings/package editor and command palette. The command input width and focus behavior have explicit regression assertions. Browser fixtures exercise rendering and IPC dispatch, not paid provider calls or OS authentication success. Actual Electron automated launch passed, but manually operating the user's already-open app through CUA was blocked by the locked Mac. Developer ID signing/notarization and a separate Mac install remain outside this verification. There is no new live code editor, interactive terminal, automatic merge or fabricated execution feed.

## 단계 내부 기본 병렬 실행 (2026-09-21)

- [승인된 변경 범위](design/PARALLEL-STAGES.md): 같은 단계는 기본 병렬, 단계별 순차 선택, 단계 간 대기, 실행 방식 스냅샷과 승인 binding, 하네스 import/export 왕복.
- `pnpm check`: 형식·문서·타입·빌드·단위/DB 검사 80개. 스케줄러의 동시 시작·묶음 대기·실패/취소, 동일 입력 clone, 독립 패치 통합과 충돌 시 원본 보존 포함.
- `pnpm test:web`: 13개 시나리오. 기본 병렬, 설계 단계 순차 선택과 저장/복원, 기존 ADE 접근성·키보드·결과 근거 회귀. 실제 렌더링 스크린샷 `artifacts/parallel-stage-settings.png` 확인.
- `pnpm test:runner`: 기존 Docker 검사 2개와 병렬 Docker 검사 1개. 서로 다른 모델 연결과 동시 작업 구간, 단계 barrier, 예산 분할, 요구사항/설계 병렬 결과 통합, 코드 충돌·작업 공간 보존, 복수 실행 중 취소와 컨테이너 정리.
- `pnpm check:mac`: 임시 앱 무결성 확인. ZIP 생성 없음. Developer ID 서명·공증과 구분한다.
- Docker 검사는 Claude fixture를 사용한다. 실제 유료 모델의 코드 품질·초안 통합 정확도·청구 금액은 검증하지 않았다. 같은 경로의 병렬 구현 변경은 자동 충돌 해결하지 않는다. 기존 설계는 실행 의미 변경 후 새로 게시·본인 승인해야 한다.

## 2026-09-22 그래프 워크스페이스

사용자 승인: 그래프 UX 제안 뒤 “개발진행하고 앱스토어 출시할만큼 퀄리티 올려”. 기존 설계 승인과 실행/병합 경계를 유지한다. 구현 범위는 [그래프 설계](design/GRAPH-WORKSPACE.md), 외부 배포의 남은 조건은 [Mac 배포 준비 현황](APP-STORE-READINESS.md)에 구분했다.

- 단계 그래프와 에이전트 배치: 호환 단계 드래그/키보드 이동, 되돌리기, 검색해서 추가, 단계에서 새 역할 생성, 개인 초안 복원, 필수 역할 검증, 실행 중 편집 잠금. 공유 표준은 기존 패키지 편집 경로를 유지한다.
- 실행 그래프: 선택한 실행/시도의 실제 에이전트 기록과 고정 하네스 기준. 선택과 실행 상태 분리, 과거 시도 배제, 종료 미확인/연결 끊김 표시, 지침·tree·결과 탐색. 그래프에서도 최신 실행 취소/재시도를 제공하며 하단 출력을 필요할 때 펼친다.
- AI 역할 구체화: 저장된 사용자 연결로 명시적 bounded Messages 요청. 초안 검토 후 이름·설명·Markdown만 편집기에 적용한다. 자동 저장/승인/도구 실행은 없다. 오류 본문을 노출하지 않으며 응답 크기·형식·시간을 제한한다.
- `pnpm check`: 문서·형식·타입·Electron 빌드 및 단위/DB 검사 **85개 통과**.
- `pnpm test:web`: **19개 통과**. 실제 드래그, 키보드 선택·이동, 복원, AI 실패/제안 적용, active-run 잠금, 기존 설계·검사·표준 import/export 회귀 포함. axe WCAG A/AA 검사와 light/dark/1024px 화면 확인. 전체 접근성 인증을 뜻하지 않는다.
- `pnpm test:runner`: **3개 통과**, 실제 Docker 격리·병렬 합류·충돌·취소·bootstrap 검사. 모델은 명시적 fake Claude이고 유료 API 호출은 하지 않았다.
- `pnpm test:desktop`: **1개 통과**, 격리된 Electron 앱 시작 확인.
- `pnpm check:mac`: 임시 Apple Silicon 앱 패키지 무결성 검사 통과. ZIP 생성 없음. Developer ID 서명·공증이나 MAS 검사와 다르다.
- `pnpm audit --prod`: 조회 당시 알려진 취약점 0건. 보안 보증을 뜻하지 않는다.
- Playwright MCP로 별도 fixture 화면을 직접 열어 설계를 선택한 상태에서도 병렬 실행 2개가 유지되는 것과 출력 패널 조작을 확인했다. 실제 사용자 데이터·모델 키는 변경하지 않았다.

시각 검토에서 발견한 글자 축소, 그래프 세로 영역 압축, 승인 라벨 겹침을 수정했다. 로컬 근거는 `artifacts/graph-*`에 있으며 제품 데이터나 배포물에 넣지 않는다. 실제 모델 품질/사용자 본인 인증/깨끗한 다른 Mac/스토어 서명·심사는 미검증이다.

전담 리뷰에서 생성 취소 후 단계 문맥이 복제에 남는 문제를 확인했다. 닫기 버튼·Escape·외부 클릭 및 라이브러리 진입에서 문맥을 초기화하고 세 취소 경로 회귀 검사를 추가했다. 에이전트 기록 없이 시스템 검사만 실행되는 동안에도 해당 단계를 강조한다. 실제 사용자 Mac 창 확인은 잠금 상태로 수행하지 못했으며, 격리 Electron 검사를 이 확인으로 대신 보고하지 않는다.

## 실제 앱 사용 동선 개선 — 2026-09-22

[개선 설계와 범위](design/DOGFOOD-UX.md). 실행 화면의 중복 단계/상태 줄을 줄이고 그래프와 실행 근거를 나란히 배치했다. 단계별 직접 추가 버튼, 검색 없음 안내, 저장 동선, 검증/설계로 이동, 좁은 창의 세로 배치를 보완했다. 그래프의 초기 전체 맞춤을 없애 많은 에이전트도 원래 크기로 읽고 스크롤하도록 했다. 레이아웃 변경 시 노드 측정값이 초기화돼 키보드 포커스가 흔들리는 현상을 수정했다.

- `pnpm check`: 형식·문서·타입·빌드 및 단위/DB 85개 통과.
- `pnpm test:web`: 20개 통과. 단계 추가 Enter/Space, 검색 없음/취소/포커스 복귀, 이동/되돌리기/초안 복원, 실행 잠금, 12개 역할의 실제 크기/스크롤, 과거 시도 분리, 고정 검사 결과 탐색, 기존 DB/UI 회귀와 axe 검사 포함. 키보드 실행 선택을 5회 추가 반복해 통과했다.
- `pnpm check:mac`: 임시 Apple Silicon 앱 무결성 통과, ZIP 생성 없음. `pnpm test:desktop`: 기존 시작·재시작 검사 1개 통과.
- `pnpm test:dogfood`: **실제 빌드된 Electron/main/preload/domain/PostgreSQL**로 격리된 프로젝트·요구사항 생성 → 설계 이동 → 기본 흐름 적용 → 그래프에서 새 검증 역할 생성 → 흐름 저장 → 앱 종료/재시작 → DB 결과 동일을 확인했다. bridge/provider/승인 proof를 대체하지 않았다. 별도 프로필과 임시 DB schema만 사용·정리했고 사용자 데이터는 변경하지 않았다. 새 명령은 로컬 Mac/개발 DB용 명시적 통합 검사이며 macOS 패키지 CI에 DB를 새로 요구하지 않는다.
- 실제 실행 화면과 편집 화면을 1440×940/1024×700, 다크/라이트에서 확인했다. 핵심 스크린샷은 `artifacts/graph-*` 및 `artifacts/dogfood-native-workflow.png`, 로그는 `artifacts/dogfood-*`다.

**실제 AI를 통한 자기 개발 완료와는 구분한다.** 사용자 Mac은 잠겨 있고 저장된 AI 연결이 0개여서 사용자 창의 직접 조작·과금 모델 구현은 수행하지 못했다. 연결 등록과 잠금 해제를 요청했다. 격리 앱에서도 승인 없는 구현 버튼 비활성, 실행 0건을 확인했으며 본인 인증이나 승인을 합성하지 않았다. 실제 모델·본인 승인·새 Mac 설치·Developer ID/공증·App Store 제출은 여전히 미검증이다.

전담 리뷰는 첫 head에서 React Flow가 실제 wheel 입력을 가로채 긴 그래프가 스크롤되지 않는 P2를 재현했다. `preventScrolling=false`로 그래프 바깥 스크롤 컨테이너에 입력을 전달하고, 프로그램식 `scrollIntoView`에 의존하던 검사를 실제 마우스 wheel로 바꿨다. 실제 wheel 회귀를 포함한 전체 브라우저 20개 재검사가 통과했다. 최종 head의 독립 재리뷰와 CI는 별도로 확인한다.

## 첫 실행 준비 · 프로젝트 문맥 — 2026-09-22

[개선 설계](design/EXECUTION-SETUP.md). 현재 기능의 프로젝트를 연결/실행 프로필/개발 흐름/하네스/지침 설정으로 전달한다. 설정 탭 사이에 선택을 유지하고 원래 기능으로 돌아간다. 첫 실행 화면에 설정 준비 목록, 연결 조회 재시도, 연결 버전 변경 안내와 직접 이동 경로를 추가했다.

- `pnpm check`: 형식·문서·타입·빌드 및 단위/DB **85개 통과**.
- `pnpm test:web`: **22개 통과**. 다중 프로젝트 설정/명시적 프로젝트 변경/새로고침/기능 복귀, 섹션 포커스, 연결 조회 실패·복구와 버전 불일치, 기존 그래프·승인·표준 회귀 포함. 새 준비 화면의 다크/라이트·좁은 창에 axe 검사와 가로 넘침 검사를 수행했다.
- `pnpm test:dogfood`: 실제 Electron/IPC/PostgreSQL에서 두 프로젝트 생성 → 두 번째 기능의 실행 프로필 선택 → 기능 복귀 → 에이전트 추가·저장 → 재시작 후 유지 **통과**. 첫 번째 프로젝트의 흐름은 변경되지 않았고 승인 없는 구현/모델 호출은 실행하지 않았다.
- `pnpm test:desktop`: 기존 Electron 첫 시작·재시작 검사 **1개 통과**.
- `pnpm check:mac`: 임시 Apple Silicon 앱 패키지 무결성 **통과**. ZIP은 생성하지 않았다. Developer ID/공증과 구분한다.
- 시각 확인: `artifacts/setup-dark.png`, `artifacts/setup-light-compact.png`, `artifacts/dogfood-native-workflow.png`. 실행 준비 목록의 버튼 배치, 문맥 유지, 1024px 세로 스크롤과 그래프 편집 화면을 확인했다. 로그는 `artifacts/setup-*.log`.

실제 사용자 Mac 창의 수동 사용과 유료 모델 자기 개발은 잠금/등록 연결 없음으로 미검증이다. 설정 안내는 마지막 저장 상태를 보여주며 실시간 제공자 정상 여부나 본인 승인을 대체하지 않는다. App Store 제출·서명/공증·다른 Mac 설치를 완료했다고 주장하지 않는다.

독립 PR 리뷰에서 ⌘3/Ctrl+3 단축키가 프로젝트 문맥 전달을 우회하는 P2를 재현했다. 버튼과 같은 내비게이션 함수를 사용하고 최신 기능 선택을 참조하도록 수정했다. 양쪽 단축키의 두 번째 프로젝트 선택과 원래 기능 복귀 회귀를 추가해 전체 22개 브라우저 검사를 다시 수행했다. 최종 head의 전담 재리뷰와 CI는 별도로 확인한다.

## 배포 외 실사용·복구 검증 — 2026-09-22

[통합 결과 보고서](QUALITY-AUDIT.md), [변경 설계](design/RUNTIME-RESILIENCE.md). 종료 중 실행 시작 경쟁, DB 단절 후 남은 상태, Docker 불가 시 작업 화면 접근, 취소 상태 보존을 보완했다. 종료 확인 전 재시도를 막고 실제 연결 검사 전 완료 표시를 없앴으며 온보딩의 프로젝트 문맥을 유지한다.

`pnpm check` 단위/DB 91개, `pnpm test:web` 23개, 기존 `pnpm test:runner` Docker 통합 3개 통과. 새 `pnpm test:resilience`는 실제 프로세스 SIGKILL/DB TCP 연결 단절·재접속/3개 프로젝트 용량·취소/체크포인트 재시도를 검증한다. 개발 중 10회 반복이 모두 통과했으며 최종 소스에서 다시 확인했다. 약 209초 반복을 수시간 운영이라고 보고하지 않는다.

새 전용 DB와 빈 앱 프로필로 실제 온보딩을 수행하고 기존 Electron 시작/self-use 검사와 함께 3개 통과했다. 모델은 호출하지 않았다. 실제 유료 모델 개발·사용자 본인 인증·장시간 sleep/wake는 미검증이며 사용자 연결과 인증이 필요하다. 배포 검증은 사용자 요청에 따라 이번 작업에서 제외했다.

## Orca 소스 비교 후 작업 문맥 개선 (2026-09-22)

[고정 커밋·파일·라인별 비교와 적용 기록](research/ORCA-CODE-AUDIT.md)에 상세 범위를 남겼다. 최신 Orca 전체 22,677개 src 파일의 목록화와 관련 25개 경로의 집중 검토를 구분한다.

- 작업 이동 이력, 검색어/설정 프로젝트 복원, IME 안전 명령 검색.
- diff 파일 ID와 헤더 파싱 보완, 한글 경로, 파일 검색/변경 구간 이동/줄 바꿈. 변경 탭의 로그는 기본 접힘.
- 로그 자동 스크롤 일시정지와 새 기록 안내, 보존 범위 변경 시 위치 유지.
- 창 위치/정상 크기/최대화 저장과 화면 밖 복원 보정. 실제 Electron 종료·재시작에서 정상 경계 복원 확인.
- `pnpm check`: 단위/DB 97개. `pnpm test:web`: 27개. 실제 Electron 시작/온보딩/self-use: 3개. 기존 승인·격리·검사 계약을 변경하지 않았다.

Orca 앱 자체, 실제 유료 모델·사람 승인, 장시간 운영·배포를 이번 검증으로 통과 처리하지 않는다.
