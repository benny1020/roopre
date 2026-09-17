# 변경 이력

## 0.2.0 — 2026-09-18

- macOS 본인 인증과 설계·정책·실행 프로필에 묶인 승인 계약.
- API key/Bearer·HTTPS endpoint 설정, 암호화 저장, 연결 검사.
- Docker 기반 Claude Code 실행, 고정 검사·읽기 전용 리뷰·제한된 수정 반복.
- 독립 체크아웃, 프로젝트당 1개·전체 2개 실행, 중단과 체크포인트 복구.
- 진행 현황, diff/commit, 시도별 검사·산출물, 라이트/다크/시스템 테마.
- 실제 DB·Docker 계약 검사 및 브라우저 회귀 시나리오. 모델 호출/네이티브 성공 흐름은 별도 검증 필요.
- 로컬 소유자 파일럿이며 실제 팀 인증·서명·공증·배포는 포함하지 않음.

## 0.1.1 — 2026-09-18

- 앱 표시 이름을 루프리, 영문 식별자를 roopre로 통일.
- 루프 리본 아이콘을 앱 내부·Dock·macOS 패키지에 적용.
- 표시 이름 변경 후에도 기존 roopre 사용자 설정 경로 유지.

## 0.1.0 — 2026-09-18

- 승인된 M1 구현을 benny1020/roopre 독립 저장소로 이전.
- Orca를 참고한 Electron main/preload/renderer/shared 및 config/docs/tests 구조.
- pnpm lockfile, 분리된 타입 검사, electron-vite 빌드, 로컬 ARM64 패키징.
- 개발자 설계 리뷰·승인, 프로젝트·기능·지침, API/DB/SSE 기능 보존.
- GitHub CI, 수동 macOS 빌드, 개발·에이전트 지침과 PR/이슈 템플릿 추가.
