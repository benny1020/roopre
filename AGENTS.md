# Roopre 작업 지침

- 제품 요구와 상태: `docs/design/PRODUCT-DESIGN.md`, `docs/design/DESIGN-REVIEW.md`, `docs/VERIFICATION.md`.
- 구조: `docs/ARCHITECTURE.md`. 절차: `docs/DEVELOPMENT.md`.
- 현재 승인 범위는 M2-A/B/C 구현이다. 완료된 기능과 실제 검증 범위는 docs/VERIFICATION.md로 확인한다. 실제 팀 인증은 M3이며 연결했다고 주장하지 않는다.
- v0.2 구현은 사용자의 “0.2 개발 ㄱㄱ”로 승인됐다. `docs/design/V02-APPROVAL.md`와 원본 설계를 함께 읽는다. 사용자가 말한 개발자 리뷰는 사용자 본인의 설계 승인이며, AI나 개발 fixture의 승인을 대신 기록하지 않는다. v0.1의 M1 승인을 M2 구현 승인으로 재사용하지 않는다.
- 제품의 핵심 목적과 M2-A의 표준 계약 보완은 `docs/design/TEAM-STANDARD-ADDENDUM.md`를 함께 읽는다. 개발 흐름과 품질 기준의 팀 표준화가 목적이며 실행·병렬 처리·시각화는 그 수단이다. 이 보완도 승인 범위에 포함한다.
- 승인된 기능의 필수 검사·개발자 리뷰를 생략하거나 테스트 기대값을 완화해 통과시키지 않는다.
- 명령: `pnpm install --frozen-lockfile`, `pnpm db:start`, `pnpm check`, `pnpm build:mac`.
- renderer는 Node/Electron main/server/database 모듈을 import하지 않는다. 공유 계약은 src/shared에 둔다.
- domain 규칙은 UI와 분리하고 승인·동시 수정·정책 변경에 의미 있는 회귀 검사를 둔다.
- API/명령 계약을 바꾸면 요구와 검토 영향을 설명한다. 승인된 범위의 통상 구현 선택은 자율적으로 진행한다.
- 작업 종료 시 변경·수행 검사·미검증 범위를 간단히 보고한다. 실제로 수행하지 않은 검사를 통과로 표시하지 않는다.
- 사용자 저장소·DB 볼륨·이전 조사 폴더를 삭제하지 않는다. credentials와 로컬 산출물을 커밋하지 않는다.
