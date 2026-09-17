# 개발 흐름

1. 요구사항과 수용 기준을 정리한다. [제품 설계](design/PRODUCT-DESIGN.md)와 현재 검증 범위를 확인한다.
2. 주요 구조·API·권한·동작 변경은 설계와 검토 기록을 남긴다. 이미 승인된 요구 범위 내의 단순 리팩터링에는 승인을 반복 요청하지 않는다.
3. `codex/<작업명>` 브랜치에서 기능 하나를 구현한다. 같은 작업 디렉터리에 복수 쓰기 에이전트를 배정하지 않는다.
4. `pnpm db:start` 후 `pnpm check`를 실행한다. 테스트는 고유 workspace를 만들어 정리하며 `team-local` 데이터를 삭제하지 않는다.
5. UI 변경은 브라우저/앱에서 실제 흐름을 확인한다. `pnpm dev:web`와 `pnpm server`는 UI 확인용이며 실제 CLI 실행 검증으로 보고하지 않는다.
6. PR에 요구·설계 변경, 동작 결과, 수행한 검사와 미검증 항목을 기록한다.

## CI

- `CI`: push/PR에서 Node 24, pnpm 11.0.4, PostgreSQL 18을 사용해 동일한 `pnpm check`를 실행한다.
- `macOS package`: 수동 실행 시 main/preload/renderer를 빌드하고 Apple Silicon 앱을 artifact로 업로드한다. Developer ID 서명·공증이나 공개 Release는 포함하지 않는다.
- workflow의 `contents` 권한은 read로 제한한다. 공식 Actions 참조는 확인한 커밋 SHA에 고정한다.
- 이 CI는 Roopre 자체 코드 검사다. 향후 사용자가 앱에서 개발하는 프로젝트들의 설계 승인을 CI에서 강제하는 M3 기능과 다르다.

## 개발 환경

`.node-version`은 Node 24, packageManager 필드는 pnpm 11.0.4다. lockfile은 `pnpm-lock.yaml` 하나를 사용한다. 의존성 변경 후 lockfile을 함께 반영하고 `pnpm install --frozen-lockfile`로 재현을 확인한다.

Electron 바이너리는 설치 후 스크립트와 앱 시작 명령에서 `install-electron`으로 준비한다. 설치 시 lifecycle scripts가 생략된 환경에서도 `pnpm dev`/`pnpm start`가 필요한 바이너리를 준비한다.

DB 접속 주소는 `DEVFLOW_DATABASE_URL`로 덮어쓸 수 있다. 기본값은 loopback의 개발 fixture다. 비밀 값이나 실제 토큰을 파일·로그·커밋에 넣지 않는다.

## 다음 개발 단위

M2: 시험 저장소의 승인된 설계 → runner claim → 승인 재검사 → worktree → Claude Code → 고정 검사 → 근거 저장. 그다음 독립 기능의 동시 실행과 실패·중지·복구를 검증한다. 이번 저장소 정리는 M2 구현 완료나 포괄 승인으로 취급하지 않는다.
