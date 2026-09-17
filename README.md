<img src="resources/icon.png" width="96" height="96" alt="루프리 아이콘" />

# 루프리 · roopre

개발팀의 **요구사항 → 설계 → 개발자 승인 → 구현 → 리뷰·테스트** 흐름을 표준화하는 macOS 앱.

여러 프로젝트와 기능을 한곳에서 관리하고, 설계·검토 의견·적용 지침·진행 상태를 함께 확인합니다. **현재 M1은 설계 검토와 실행 요청 관리까지 구현했습니다.** Claude Code 실행, worktree 병렬 개발, 자동 웹 테스트는 M2에서 연결합니다.

[설계](docs/design/PRODUCT-DESIGN.md) · [구조](docs/ARCHITECTURE.md) · [개발 흐름](docs/DEVELOPMENT.md) · [검증](docs/VERIFICATION.md) · [변경 이력](CHANGELOG.md)

다음 단계의 [v0.2 설계·기업 사례 비교·직접 사용 보고](docs/design/PRODUCT-DESIGN-v0.2.md)를 검토 중입니다. 사용자 본인 설계 승인, API key·endpoint 연결, 실제 개발 실행과 자체 개발 적용을 다루며 아직 구현 승인은 받지 않았습니다.

[팀 개발 표준·품질 목표 보완](docs/design/TEAM-STANDARD-ADDENDUM.md): 누구나 같은 절차와 품질 기준으로 개발하도록, 단계별 결과물·검증·완료 조건을 실행 가능한 표준으로 관리하는 것이 핵심 목표입니다.

## 시작하기

준비: Apple Silicon macOS, Node.js 24, pnpm 11.0.4, 실행 중인 Docker Desktop.

```bash
git clone https://github.com/benny1020/roopre.git
cd roopre
pnpm install --frozen-lockfile
pnpm db:start
pnpm dev
```

API는 `127.0.0.1:4318`, 개발 UI는 `127.0.0.1:4317`입니다. `pnpm dev`가 API와 Electron 개발 앱을 시작합니다. 이전 Team Devflow 세션이 이 포트를 사용 중이라면 먼저 해당 세션을 종료합니다. Ctrl+C는 이 명령에서 시작한 자식 프로세스를 정리합니다. DB 중지는 `pnpm db:stop`이며 볼륨을 지우지 않습니다.

`config/compose.yaml`은 이전 M1의 DB 이름과 볼륨을 유지해 이 기기에 저장한 설계·승인 기록을 재사용합니다. 새 환경에서는 가상 프로젝트와 개발용 사용자로 초기화합니다.

## 현재 기능

- 프로젝트·기능 목록과 보드, 의존 관계, 검색.
- 표준 설계 초안, 버전별 문서·해시, 비교, 문단 의견과 답글.
- 독립 개발자들의 7항목 검토, 승인·수정 요청·철회, 차단 의견 해결 확인.
- 서버의 승인 조건 검사, 실행 대기열·취소, 설계·지침 변경 시 요청 차단.
- 팀·프로젝트·단계·역할·기능 지침, 적용 스냅샷과 이력.
- PostgreSQL 저장, 동시 수정 충돌 방지, 멱등 요청, SSE 동기화.

앱의 사용자 전환은 **개발 fixture**이며 실제 인증이 아닙니다. 기본 설정은 로컬에만 연결되며 현재 빌드를 팀 네트워크에 노출하지 않습니다. 실제 팀 계정·CI 병합 정책·배포는 M3입니다.

## 저장소 구성

[Orca의 공개 저장소](https://github.com/stablyai/orca)의 Electron 책임 분리와 개발 도구 배치를 참고했습니다. Roopre 고유의 팀 API·승인 규칙·DB 경계는 별도로 유지합니다.

```text
src/
  main/                  Electron 창·수명·보안 설정
  preload/               최소한의 renderer 연결
  renderer/
    index.html
    src/                 React 화면
  shared/                명령·이벤트·공유 타입
  server/                Fastify API·SSE
  domain/                승인·정책·의존성 규칙
  database/              PostgreSQL 저장·개발 fixture
  types/                 renderer 전역 타입
config/                  TS·브라우저 개발·DB 설정
  scripts/               실행·패키징·문서 검사
docs/                    설계·개발 안내·조사·검증
tests/                   도메인·API 회귀 테스트
.github/                 CI·macOS 빌드·PR/이슈 템플릿
electron.vite.config.ts  main/preload/renderer 빌드
```

## 명령

| 명령             | 용도                                             |
| ---------------- | ------------------------------------------------ |
| `pnpm dev`       | 로컬 API + Electron 개발 앱                      |
| `pnpm server`    | 로컬 API만 시작                                  |
| `pnpm dev:web`   | 같은 renderer를 브라우저에서 확인; API 별도 실행 |
| `pnpm check`     | 포맷·문서 링크·타입·빌드·실제 DB 테스트          |
| `pnpm test`      | 도메인·API 테스트; 실행 중인 DB 필요             |
| `pnpm build:mac` | `release/루프리-darwin-arm64/루프리.app` 생성    |
| `pnpm start`     | 빌드된 Electron 앱 실행; API/DB 별도 필요        |

패키지는 개발용 미공증 빌드입니다. 앱은 화면 클라이언트이므로 API와 DB를 별도로 실행해야 합니다. GitHub의 **macOS package** 워크플로우에서도 수동 빌드를 할 수 있으며 공개 GitHub Release를 자동 발행하지 않습니다.

## 개발 원칙

1. 중요한 요구·설계를 먼저 문서화하고 개발자 승인을 받습니다.
2. 승인된 범위 안의 구현 선택과 검증은 자율적으로 진행합니다.
3. 개발자는 필수 검토·검사 기준을 우회하거나 테스트를 약화해 완료 처리하지 않습니다.
4. 문서나 에이전트의 완료 선언과 실제 실행 근거를 구분합니다.

[CONTRIBUTING](CONTRIBUTING.md)과 [AGENTS](AGENTS.md)에 구체적인 작업·검증 기준을 정리했습니다.
