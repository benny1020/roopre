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
