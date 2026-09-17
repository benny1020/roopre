# 개발 흐름

1. 요구사항과 수용 기준을 정리한다. [제품 설계](design/PRODUCT-DESIGN.md)와 현재 검증 범위를 확인한다.
2. 주요 구조·API·권한·동작 변경은 설계와 검토 기록을 남긴다. 이미 승인된 요구 범위 내의 단순 리팩터링에는 승인을 반복 요청하지 않는다.
3. `codex/<작업명>` 브랜치에서 기능 하나를 구현한다. 같은 작업 디렉터리에 복수 쓰기 에이전트를 배정하지 않는다.
4. `pnpm db:start` 후 `pnpm check`를 실행한다. 테스트는 고유 workspace를 만들어 정리하며 `team-local` 데이터를 삭제하지 않는다.
5. UI 변경은 브라우저/앱에서 실제 흐름을 확인한다. `pnpm dev:web`와 `pnpm server`는 UI 확인용이며 실제 CLI 실행 검증으로 보고하지 않는다.
6. PR에 요구·설계 변경, 동작 결과, 수행한 검사와 미검증 항목을 기록한다.

## CI

- `CI`: push/PR에서 Node 24, pnpm 11.0.4, PostgreSQL 18을 사용해 동일한 `pnpm check`와 Chromium 시나리오를 실행한다.
- `macOS package`: 수동 실행 시 main/preload/renderer를 빌드하고 Apple Silicon 앱을 artifact로 업로드한다. Developer ID 서명·공증이나 공개 Release는 포함하지 않는다.
- workflow의 `contents` 권한은 read로 제한한다. 공식 Actions 참조는 확인한 커밋 SHA에 고정한다.
- 이 CI는 Roopre 자체 코드 검사다. 향후 사용자가 앱에서 개발하는 프로젝트들의 설계 승인을 CI에서 강제하는 M3 기능과 다르다.

## 개발 환경

`.node-version`은 Node 24, packageManager 필드는 pnpm 11.0.4다. lockfile은 `pnpm-lock.yaml` 하나를 사용한다. 의존성 변경 후 lockfile을 함께 반영하고 `pnpm install --frozen-lockfile`로 재현을 확인한다.

Electron 바이너리는 설치 후 스크립트와 앱 시작 명령에서 `install-electron`으로 준비한다. 설치 시 lifecycle scripts가 생략된 환경에서도 `pnpm dev`/`pnpm start`가 필요한 바이너리를 준비한다.

DB 접속 주소는 `DEVFLOW_DATABASE_URL`로 덮어쓸 수 있다. 기본값은 loopback의 개발 fixture다. 비밀 값이나 실제 토큰을 파일·로그·커밋에 넣지 않는다.

## v0.2 실행 환경과 검사

- `pnpm build:native`: macOS 본인 인증 helper 컴파일. 실제 인증 성공 검사는 사람이 앱에서 수행한다.
- `pnpm runner:image`: 고정 Claude Code/Playwright 버전의 Docker 이미지 준비.
- `pnpm test:runner`: 실제 Docker, 임시 Git 저장소와 PostgreSQL workspace를 사용한다. Claude는 명시적인 fixture로 대체하며 과금 모델 호출을 하지 않는다.
- `pnpm exec playwright install chromium` 후 `pnpm test:web`: headless Chromium에서 실제 renderer/DB의 사용자 흐름을 확인한다. IPC transport는 테스트용 대체이므로 native 인증/Keychain 검증과 다르다.
- `pnpm build:mac`: native helper, main/preload/renderer, PG/zod 런타임을 앱에 포함한다. DB와 Docker는 외부 전제다.

각 기능은 `AC01`, `AC02` 형식 완료 기준을 적고 실행 프로필을 저장한 다음 설계를 게시한다. 프로필 변경 시 재승인이 필요하다. 앱에서 모델 key를 설정하기 전 개인 Claude 로그인/OAuth 자격 증명을 자동으로 읽거나 사용하지 않는다.

## 로컬 파일럿 운영

앱 설정은 `~/Library/Application Support/roopre` 아래에 저장한다. `private/connections.json`은 safeStorage 암호문, `runs/<run-id>/checkout`은 변경 작업 공간, `runs/<run-id>/artifacts`는 시도별 테스트 근거다. DB에는 설계/승인/실행 상태와 검사 로그가 저장된다. DB 볼륨과 이 폴더를 함께 백업해야 한다. 자동 보관 기간 정리는 아직 없으므로 디스크 용량을 확인한다.

실행 실패 시 기능의 실행·결과에서 이유·검사 로그를 확인한다. 중단된 변경을 이어가려면 `변경을 이어서 재시도`를 사용한다. 승인 계약이 바뀌었으면 새 설계를 승인해야 한다. Docker 종료를 확인할 수 없으면 새 실행을 차단하므로 Docker 복구 후 앱을 재시작한다.

결과는 자동 push/merge/deploy하지 않는다. 작업 경로와 commit, diff와 검사 근거를 확인하고 팀의 기존 PR 절차로 통합한다. 사용자 본인의 설계 승인도 별개다. 이 저장소의 v0.2 구현 승인으로 앱 안의 다른 작업을 자동 승인하지 않는다.
