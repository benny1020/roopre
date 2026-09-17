# Roopre 작업 지침

- 제품 요구와 상태: `docs/design/PRODUCT-DESIGN.md`, `docs/design/DESIGN-REVIEW.md`, `docs/VERIFICATION.md`.
- 구조: `docs/ARCHITECTURE.md`. 절차: `docs/DEVELOPMENT.md`.
- 현재 범위는 M1. Claude Code, worktree 병렬 개발, 자동 테스트 runner, 실제 팀 인증을 연결했다고 주장하지 않는다.
- 승인된 기능의 필수 검사·개발자 리뷰를 생략하거나 테스트 기대값을 완화해 통과시키지 않는다.
- 명령: `pnpm install --frozen-lockfile`, `pnpm db:start`, `pnpm check`, `pnpm build:mac`.
- renderer는 Node/Electron main/server/database 모듈을 import하지 않는다. 공유 계약은 src/shared에 둔다.
- domain 규칙은 UI와 분리하고 승인·동시 수정·정책 변경에 의미 있는 회귀 검사를 둔다.
- API/명령 계약을 바꾸면 요구와 검토 영향을 설명한다. 승인된 범위의 통상 구현 선택은 자율적으로 진행한다.
- 작업 종료 시 변경·수행 검사·미검증 범위를 간단히 보고한다. 실제로 수행하지 않은 검사를 통과로 표시하지 않는다.
- 사용자 저장소·DB 볼륨·이전 조사 폴더를 삭제하지 않는다. credentials와 로컬 산출물을 커밋하지 않는다.
