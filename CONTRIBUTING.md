# 기여 안내

[개발 흐름](docs/DEVELOPMENT.md)을 먼저 확인합니다.

- 새 작업은 `codex/<작업명>` 브랜치를 사용합니다.
- 요구사항·설계·수용 기준과 구현을 연결하고 변경 범위를 작게 유지합니다.
- `pnpm install --frozen-lockfile`, `pnpm db:start`, `pnpm check`로 검증합니다.
- 중요한 설계 변경은 사용자 본인이 검토·승인합니다. AI가 승인을 대신하지 않습니다. 로컬 owner 모드는 본인이 작성한 설계를 macOS 인증으로 승인할 수 있으며, M1의 독립 검토자 fixture 규칙과 구분합니다.
- API/DB 테스트의 통과를 실제 팀 인증·runner·브라우저 E2E 완료로 확대해 보고하지 않습니다.
- generated output, node_modules, 환경 파일, 사용자 데이터는 커밋하지 않습니다.

[PR 템플릿](.github/pull_request_template.md)을 사용해 검증 근거와 제한을 기록합니다.
