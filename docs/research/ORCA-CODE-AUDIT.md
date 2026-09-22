# Orca 소스 비교와 루프리 적용 기록

확인일: 2026-09-22. 사용자 요청: “orca github 보고 코드 한줄한줄보면서 참고할 내용 / 기능 / 구조 / 디테일 없는지보고 적용해”.

대상은 기존에 참고한 **stablyai/orca**다. 비교 도중 upstream이 바뀌어도 근거가 이동하지 않도록 [b76bc79d73d1](https://github.com/stablyai/orca/tree/b76bc79d73d12a3489bb30e5d438952ec5d0582c)에 고정했다. 루프리 기준은 PR #8 반영 main `34725aa4544f5edfc1d0a389192fb2f9ed5a1434`다.

## 검토 범위와 해석

Orca의 추적된 `src` 파일 **22,677개**를 목록화했다. 파일명 기준 테스트는 **8,995개**다. 이는 테스트 수행 개수나 소스 정독 개수가 아니다. 전체 저장소를 한 줄도 빠짐없이 감사했다고 주장하지 않는다. 아래 25개 소스·테스트 경로의 관련 구현을 읽고 호출 경계·복원 조건·실패 검사를 루프리 코드와 대조했다. 긴 파일은 표의 라인 범위가 집중 검토한 구간이다. 모바일/클라우드/SSH 전체, 모든 provider, 모든 테스트 본문은 이번 상세 검토 범위 밖이다.

| 영역 | 추적 파일 | 파일명 기준 테스트 |
| --- | ---: | ---: |
| main | 9,296 | 3,948 |
| renderer | 10,268 | 3,930 |
| shared | 2,274 | 791 |
| CLI | 295 | 128 |
| preload | 170 | 15 |
| relay | 373 | 183 |
| types | 1 | 0 |

전체 파일 목록·크기·커밋은 로컬 `artifacts/orca-source-inventory.json`에 보존했다. 업스트림 소스는 `artifacts/upstream/orca`에 별도 checkout했다. Orca 의존성을 설치하거나 해당 앱/테스트를 실행하지 않았다. 아래는 **소스 분석 + 루프리 구현·검증** 결과다.

## 결론

가장 유용한 부분은 거대한 화면 구성보다 **사용자의 작업 문맥을 잃지 않는 작은 계약**이다. 현재 위치와 검색어, 선택 파일, 읽던 로그, 창 위치를 분리해서 기억하고, 늦은 비동기 응답과 새로운 실행이 그 문맥을 덮어쓰지 않게 한다.

이번에는 탐색·diff·로그·창 복원·명령 검색을 적용했다. 루프리의 승인된 설계 → 격리 구현 → 고정 검사 → 독립 리뷰 계약은 유지한다. Orca의 전체 Zustand store, remote runtime, PTY manager, provider catalog를 루프리에 이식하지 않는다. 지금 규모에는 기존 React/IPC/domain 경계 안에서 작게 나누는 편이 확인·운영하기 쉽다.

## 파일·라인별 비교

| Orca 근거 | 읽은 구현의 핵심 | 루프리 결정 |
| --- | --- | --- |
| [작업 이력](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/store/slices/worktree-nav-history.ts#L145-L212) | 동일 현재 항목만 중복 제거, 앞으로 이력 절단, 용량 제한, 사라진 대상 건너뛰기 | 적용: 기능·프로젝트·설정 위치를 60개 세션 이력으로 관리. 설정 프로젝트와 목록 검색어도 복원 |
| [상단 이동 버튼](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/app-shell/TitlebarLeftControls.tsx#L99-L153) | 탐색 가능 여부와 버튼 상태 연결 | 적용: 뒤로/앞으로 버튼과 ⌘[/⌘], Ctrl[/Ctrl]. 입력 중·대화상자는 제외 |
| [키보드 소유권](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/app-shell/use-global-keybindings.ts#L44-L110) | 전역 단축키와 자식 컨트롤 처리 경계 | 적용: 이미 처리된 키·IME 조합 중 키를 존중. 검색창 한글 확정 Enter가 명령을 실행하지 않도록 추가 회귀 |
| [빠른 검색](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/shared/quick-open-path-search.ts#L1-L80) | 정규화, 관련도 순위, 입력/결과 경계 | 적용: 공백 정리, 제목 정확 일치/접두어 우선, 프로젝트+기능의 여러 단어 검색. 파일 검색용 heap 전체는 도입하지 않음 |
| [diff 식별](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/components/editor/combined-diff/resolve-changes/combined-diff-section-identity.ts#L1-L26) | 화면 모드와 경로로 섹션 식별. 배열 순번에 기대지 않음 | 적용: 실제 Git 파일 헤더로 안정된 ID. 갱신 시각으로 viewer를 재생성하던 key 제거 |
| [diff 검색](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/components/editor/combined-diff/browse-files/combined-diff-file-tree-filter.ts#L15-L84) | 변경 경로 검색과 표시 상태를 분리 | 적용: 경로 필터와 결과 수, 빈 결과 안내. 현재 검색 결과에서 선택한 파일 유지 |
| [diff 이동](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/components/editor/combined-diff/browse-files/combined-diff-file-tree-navigation.ts#L1-L47) | 파일 식별자로 실제 섹션을 찾아 이동 | 적용: 파일별 스크롤 위치와 이전/다음 변경 구간. 앱 전체가 아니라 diff 패널만 스크롤 |
| [diff 보기 기억](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/components/editor/combined-diff/remember-view/combined-diff-view-memory.ts#L1-L65) | 선호·위치와 실제 코드 snapshot의 수명 분리 | 일부 적용: 열린 viewer 안의 위치/줄 바꿈 유지. 실제 diff를 새 조회 없이 과거 캐시로 재사용하지 않음 |
| [diff 복원 조건](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/components/editor/combined-diff/remember-view/use-combined-diff-view-restore.ts#L72-L177) | 변경 식별/상태가 맞을 때만 내용 복원 | 유지: 루프리의 run별 요청 generation 차단. 새 run의 화면에 늦은 이전 응답을 표시하지 않음 |
| [첫 변경 위치](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/components/editor/useDiffViewerFirstChangeAutoScroll.ts#L18-L86) | 파일별 한 번 이동, 사용자/댓글 위치와 우선순위 충돌 방지 | 참고: 루프리는 명시적 변경 구간 이동. 매 갱신마다 첫 변경으로 강제 이동하지 않음 |
| [스크롤 보존](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/components/editor/combined-diff/scroll-viewport/use-combined-diff-scroll-persistence.ts#L62-L130) | 사용자 스크롤과 프로그램 복원 구분 | 일부 적용: 로그 읽는 위치 유지, 보존 범위에서 제거되면 알림. 가상화용 캐시·RAF 체계 전체는 미도입 |
| [터미널 읽기 계약](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/lib/pane-manager/xterm-user-scrolling-contract.test.ts#L1-L186) | 이전 출력 읽는 중 위치 유지, 최신 출력 추적과 구분 | 적용: 로그 따라가기/일시정지/새 기록 안내. 상단 기록이 잘려도 남은 문맥 유지. xterm 자체는 도입하지 않음 |
| [창 경계](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/main/window/window-bounds-validation.ts#L1-L35) | 분리된 모니터에 저장된 창이 화면 밖에서 열리지 않도록 확인 | 적용: 현재 모니터 workArea에 위치·크기를 보정하고 제목 표시줄 접근 보장 |
| [창 생명주기](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/main/window/main-window-state-lifecycle.ts#L76-L157) | 이동/리사이즈 저장 debounce, 종료 시 덮어쓰기 방지, 최대화 별도 저장 | 적용: 250ms 모음 저장, 정상 창 경계+최대화 저장, 종료 때 마지막 저장 후 동결. 실제 Electron 재시작 검사 |
| [원자 파일 저장](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/main/plugins/plugin-atomic-file-write.ts#L17-L37) | 고유 임시 파일 → rename → 임시 파일 정리 | 적용: 작은 창 환경설정에 원자 교체. 기존 vault/bootstrap의 별도 저장·복구 계약 유지 |
| [첫 설정 중복 처리](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/components/onboarding/use-onboarding-flow-persistence.ts#L88-L141) | 종료/저장 중복 클릭 차단, 실패하면 재시도 가능 | 대조: 루프리의 busy/저장 후 전환과 native 온보딩 회귀 유지. Orca telemetry/star 유도는 도입 안 함 |
| [IPC 입력](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/main/ipc/onboarding.ts#L1-L16) | renderer 입력을 신뢰하지 않고 정제 | 유지: 루프리 trustedRenderer + Zod 계약. renderer에 범용 Node/shell 권한을 주지 않음 |
| [설정 복원](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/main/persistence/applying-settings/onboarding-normalization.ts#L17-L69) | 타입을 필드별로 검사하여 문자열 false 등을 정상 값으로 오해하지 않음 | 적용: 창 설정 version/숫자/범위 검증. 기존 승인·하네스 schema와 비밀 저장 정책 유지 |
| [환경 검사 동시성](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/main/preflight/agent-detection.ts#L80-L139) | 대상별 in-flight 합치기와 generation/epoch 무효화 | 대조: 루프리의 준비 작업 단일화와 연결 버전 검사 유지. 새 전역 영구 cache는 도입하지 않음 |
| [실행자 생존](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/main/runtime/orchestration/worker-terminal-process-liveness.ts#L8-L45) | 정확한 process incarnation, 불확실과 종료 구분 | 유지: 루프리 run별 Docker 이름/label과 terminationConfirmed. 연락 끊김을 완료로 처리하지 않음 |
| [주의 필요 상태](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/main/runtime/orchestration/worker-attention-context.ts#L1-L60) | 운영 사실·승인 대기·생존 정보를 별도 projection으로 결합 | 유지: 루프리 workState/실행 그래프의 HUMAN·AGENT·SYSTEM 분리. 모델 문장만으로 성공 표시 안 함 |
| [결정 gate 검증](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/main/runtime/orchestration/coordinator-decision-gates.test.ts#L1-L117) | 다른 실행자가 대상 작업의 gate를 바꾸는 경우 거절 | 유지: 루프리 immutable approval binding + native 본인 인증. Orca 테스트를 실행한 것은 아님 |
| [알림 대상 귀속](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/renderer/src/components/terminal-pane/terminal-notification-state.ts#L26-L124) | 현재 pane·worktree·live PTY와 알림 대상 일치 확인 | 후속: native 알림/읽음 상태는 run ID·attempt에 귀속하는 설계로 확장. 현재 PR에서 가짜 완료 알림을 만들지 않음 |
| [권한 모드](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/shared/tui-agent-permissions.ts#L1-L43) | 여러 CLI의 자동 승인 옵션을 모드로 묶음 | 미도입: 루프리의 사용자 설계 승인을 끄는 모드로 해석하지 않는다 |
| [diff 캐시 비용](https://github.com/stablyai/orca/blob/b76bc79d73d12a3489bb30e5d438952ec5d0582c/src/main/git/source-control/settled-diff-cache.ts#L8-L145) | 개수와 내용 크기를 제한하고 검증할 수 없는 snapshot은 cache하지 않음 | 유지/후속: 루프리 Git 출력 200,000자 초과 거절 유지. 대용량 file별 조회는 별도 API로 설계 |

## 이번에 구현한 사용자 흐름

### 1. 프로젝트·기능을 오가며 문맥 복원

기능 A → 전체 작업에서 검색 → 기능 B → 이전 작업으로 이동하면 검색어가 있는 목록으로 돌아간다. 다시 앞으로 이동하면 B를 연다. 뒤로 간 뒤 새로운 작업을 열면 이전의 앞으로 이력을 폐기한다. 같은 위치에서 검색어를 타이핑한 횟수만큼 이력을 쌓지 않는다. 없어진 대상은 건너뛴다.

상단의 작은 이동 버튼과 `⌘[` / `⌘]` 또는 `Ctrl+[` / `Ctrl+]`로 조작한다. 입력창/편집 영역/대화상자에서는 이동 단축키를 가로채지 않는다. 이력은 현재 renderer 세션에서 최대 60개며 앱 전체 재시작 시 과거 60개 방문 목록을 복원하는 기능은 아니다. 기존 마지막 위치 저장은 유지한다.

코드: `workspace/navigation.ts`, `workspace/useNavigationHistory.ts`, `App.tsx`. 별도 글로벌 store 라이브러리를 추가하지 않았다.

### 2. 변경 검토의 정확성과 이동

기존 파일 ID는 배열 순번이었다. 새 파일이 앞에 끼어드는 diff 갱신에서 다른 파일이 선택될 수 있었다. `RunPanel`도 조회 시각을 React key에 넣어 갱신마다 선택 상태를 지웠다. 파일 헤더 기반 ID와 run 기반 viewer 수명으로 바꿨다.

파서는 hunk 내부의 `+++` 코드 줄을 파일 헤더로 오인하지 않는다. Git의 UTF-8 octal 경로는 한글로 읽을 수 있게 표시하고, 삭제/rename의 경로도 분리한다. 실제 원문 patch의 줄은 유지한다. 표시 경로를 host 파일 읽기/명령 실행에 사용하지 않는다.

파일 필터, 검색 결과 수, 파일별 스크롤 위치, 이전·다음 변경 구간, 긴 줄 바꿈을 추가했다. 빈 검색 결과는 이전 파일을 그대로 보여주지 않는다. 좁은 창에서는 코드에 공간을 먼저 주기 위해 변경 탭의 실행 출력을 기본 접힘으로 둔다. 필요하면 하단에서 다시 열 수 있으며 다른 탭의 출력 표시와 별도로 기억한다.

실제 diff 내용·줄 번호·tree 검증을 새로 만들거나 AI가 검토했다고 표시하는 기능은 없다. 바이너리 파일은 원래 metadata만 표시한다.

### 3. 로그 읽기와 새 출력 분리

진행 기록은 처음에는 최신 위치를 따라간다. 사용자가 위로 스크롤하거나 일시정지를 누르면 현재 읽는 기록을 유지하고 새 기록 도착만 알린다. 최신으로 버튼을 눌러 추적을 재개한다. 로그 앞부분이 보존 범위에서 삭제되어도 남아 있는 기록의 위치를 기준으로 복원하고, 읽던 기록 자체가 사라졌으면 이를 안내한다.

이 기능은 기존 최대 120개 운영 이벤트의 보기 방식이다. 모든 PTY 출력이나 모델 내부 추론을 저장·공개하는 기능으로 바꾸지 않았다.

### 4. 실제 맥 창 복원

정상 창 크기·위치와 최대화 여부를 작은 versioned 설정 파일로 저장한다. 이동/크기 변경은 250ms 단위로 모아 저장하고, 닫기/앱 종료 직전에는 남은 값을 반영한 뒤 저장을 동결한다. 고유 임시 파일을 rename하여 부분 JSON으로 교체하지 않는다.

외부 모니터 분리 후에는 현재 화면 안으로 보정한다. 잘못된 타입·숫자·버전 또는 읽기 실패는 기본 위치로 복구한다. 앱의 기존 최소 크기 1024×700은 유지한다. DB/연결 비밀/승인 기록과 창 선호는 별개다. 모니터 분리와 잘못된 값은 순수 함수 검사, 정상 위치 복원은 실제 Electron 프로세스를 닫고 다시 열어 확인한다.

### 5. 명령 검색

앞뒤 공백을 정리하고, 제목 정확 일치 → 제목 접두어 → 제목 단어 → 프로젝트 문맥 순으로 정렬한다. 여러 단어로 프로젝트와 기능을 함께 좁힐 수 있다. 입력은 500자로 제한하며 동점은 입력 순서를 유지한다. 한국어 IME 조합 중 Enter가 선택된 명령을 실행하지 않도록 했다.

## 이미 갖춘 구조와 추가하지 않은 기능

- **승인과 실행 상태:** 루프리는 이미 immutable 설계 binding, main의 본인 인증, 고정 검사·독립 리뷰, 작업별 clone/Docker 경계를 갖고 있다. Orca의 터미널 이벤트를 승인/성공의 증거로 대신 쓰지 않는다.
- **늦은 응답/연결 검사:** run 요청 generation과 연결 version 검사를 유지한다. 시간만 기준으로 실제 diff/연결 검사를 유효하다고 캐시하지 않는다.
- **저장 실패:** vault와 bootstrap의 기존 원자 교체/복구 방식을 유지한다. 창 선호 저장 실패로 작업이나 승인을 취소하지 않는다.
- **대용량 diff:** 현재 Git 출력은 200,000자 초과 시 거절한다. 다음 확장은 main에서 파일 목록과 개별 파일 patch를 별도 반환하고 renderer에서 필요한 파일만 읽는 방식이다. 단순히 화면에서 일부를 자르고 전체 검토가 끝났다고 표시하면 안 된다.
- **항상 실행되는 daemon:** 앱을 닫아도 계속 실행하려면 소유권 이전·RPC·DB migration·비밀 전달·프로세스 복구 설계가 추가로 필요하다. 이번 UI 개선에 섞어 만들지 않았다.
- **완료 알림/읽음 이력:** run/attempt/현재 프로젝트에 귀속한 지속 알림을 후속 대상으로 남긴다. 현재 메모리 이벤트 UI를 신뢰할 수 있는 native 완료 알림으로 과장하지 않는다.
- **diff 줄별 코멘트와 수정 지시:** 다음 후보지만 해당 코멘트를 어떤 tree에 대한 지시로 고정할지 먼저 정해야 한다. 사용자의 설계 승인 규칙과 구분해야 한다.
- **원격/모바일/다중 CLI:** Orca의 관련 디렉토리는 목록화했지만 상세 구현·실행 검증을 마친 범위가 아니다. 현재 Claude-compatible 연결을 여러 provider가 검증됐다고 설명하지 않는다.

## 검증과 출처 경계

루프리 검증: `pnpm check`(단위/DB 97개), `pnpm test:web`(27개), 실제 Electron 시작/온보딩/self-use 3개. 변경된 상태 전이, 검색·IME, diff 갱신·경로, 로그 갱신·보존 범위, 창 종료·재시작을 포함한다. 브라우저에서 axe 검사 및 1280×800 다크/1024×700 라이트 화면을 확인했다. 최종 커밋은 별도 PR 리뷰와 최신 CI로 확인한다.

근거 파일: `artifacts/orca-check.log`, `artifacts/orca-web.log`, `artifacts/orca-native.log`, `artifacts/orca-diff-dark.png`, `artifacts/orca-diff-compact.png`, `artifacts/orca-log-paused.png`. 테스트 fixture는 사용자 앱 기본 데이터에 포함하지 않는다. 실제 모델 호출, 사용자 본인 인증, 장시간 운영, 배포 검증은 이 소스 비교의 완료 근거에 포함하지 않는다.

Orca의 고정 LICENSE는 MIT다. 이번 변경은 동작 패턴을 참고해 루프리 계약에 맞춰 작성했고 Orca 구현 파일/아이콘/브랜드를 복사하지 않았다. 향후 코드 자체를 가져오면 원저작권·허가 고지와 파일/커밋/변경 내역을 함께 유지한다. 소스 라이선스 확인을 전체 의존성·자산 검토로 확대해 설명하지 않는다.
