<img src="resources/icon.png" width="96" height="96" alt="루프리 아이콘" />

# 루프리 · roopre

개발팀의 **요구사항 → 설계 → 개발자 승인 → 구현 → 리뷰·테스트** 흐름을 표준화하는 macOS 앱.

**v0.2는 한 명의 소유자가 사용하는 로컬 파일럿입니다.** 설계를 macOS 본인 인증으로 승인한 뒤, Claude Code가 격리된 Docker 작업 공간에서 구현하고 고정 검사와 별도 읽기 전용 리뷰를 수행합니다. 여러 프로젝트의 실행·diff·검사 근거를 앱에서 확인합니다. 실제 팀 계정과 서버 운영은 후속 M3 범위입니다.

[승인된 설계](docs/design/PRODUCT-DESIGN-v0.2.md) · [팀 개발 표준](docs/design/TEAM-STANDARD-ADDENDUM.md) · [구조](docs/ARCHITECTURE.md) · [사용·개발 안내](docs/DEVELOPMENT.md) · [검증과 남은 조건](docs/VERIFICATION.md) · [변경 이력](CHANGELOG.md) · [전담 PR 리뷰·머지 승인](docs/PR-REVIEW-PROCESS.md)

## 시작하기

외부 배포 준비 상태·설치 파일 검증·남은 결정은 [배포 안내](docs/DISTRIBUTION.md)를 확인하세요. `0.2.1-beta.1`은 품질 보강 중인 베타 후보이며 아직 공개 배포 완료 버전이 아닙니다.

준비: Apple Silicon macOS, Node.js 24, pnpm 11.0.4, Xcode Command Line Tools, 실행 중인 Docker Desktop.

```bash
git clone https://github.com/benny1020/roopre.git
cd roopre
pnpm install --frozen-lockfile
pnpm db:start
pnpm runner:image
pnpm dev
```

Electron 앱은 PostgreSQL에 직접 연결하며 소유자 워크스페이스를 사용합니다. `pnpm dev`가 함께 시작하는 `127.0.0.1:4318` API와 `4317` 브라우저 화면은 별도의 M1 샘플 데이터 검토용입니다. 기존 DB 볼륨과 기록은 보존됩니다. DB 중지는 `pnpm db:stop`입니다.

1. 앱의 **표준 · 연결 · 환경**에서 HTTPS endpoint, API key/Bearer token, 모델 ID를 등록하고 연결 검사합니다. Anthropic Messages 규격만 지원합니다. 연결 검사에는 소량의 과금이 발생할 수 있습니다.
2. 프로젝트의 Git 폴더·기준 브랜치·고정 검사 명령·예산·시간 한도를 저장합니다.
3. 기능의 `AC01` 형식 완료 기준과 7개 설계 항목을 작성하고 리뷰 요청합니다.
4. 본인이 설계를 검토하고 macOS 비밀번호/Touch ID로 승인합니다. **실행·결과 → 개발 시작**을 누릅니다.
5. **실행 현황**에서 진행 상태를, 기능에서 변경 diff·검사 로그·리뷰·테스트 산출물을 확인합니다. 병합과 배포는 기존 절차로 수행합니다.

## 현재 기능과 경계

- 프로젝트·기능·설계 버전·의견, 팀·프로젝트·단계·역할·기능 지침 관리.
- 설계·정책·실행 프로필에 묶인 본인 승인. 변경/철회 시 실행 차단.
- macOS 암호화 API key 저장. 모델 호출 중 실제 key는 호스트 broker에만 보관.
- 독립 체크아웃·Docker 격리. 최대 2개 프로젝트 동시 실행, 프로젝트당 1개.
- Claude Code 구현 → 고정 검사/E2E → 읽기 전용 AI 리뷰 → 제한된 수정 반복.
- 중단·재시도·변경 복구, 시도별 검사와 산출물 해시, 최종 commit·diff 확인.
- 라이트·다크·시스템 테마 및 설정 유지.

**지원 범위:** Node 단일 패키지 저장소의 lockfile 기반 준비입니다. 설치 스크립트·사설 레지스트리·외부 네트워크 의존 테스트·monorepo·서비스 DB 자동 준비는 아직 지원하지 않습니다. 기존 테스트/설정/의존성 파일은 보호하므로 이를 바꾸는 작업은 별도 검토가 필요합니다. 모델 응답·비용 보고와 gateway 호환성은 실제 연결로 확인해야 합니다. 임의 endpoint의 청구액을 앱이 절대 상한으로 보장하지 않습니다.

자동 테스트 결과와 남은 수동 검증은 [검증 문서](docs/VERIFICATION.md)를 확인하세요. 현재 상태를 팀 실무 배포 완료로 간주하지 않습니다.

## 저장소 구성

[Orca의 공개 저장소](https://github.com/stablyai/orca)의 Electron 책임 분리와 개발 도구 배치를 참고했습니다. Roopre 고유의 팀 API·승인 규칙·DB 경계는 별도로 유지합니다.

```text
src/
  main/                  Electron 창·본인 인증·비밀 저장·IPC
  preload/               명시적인 IPC 메서드만 노출
  renderer/
    index.html
    src/                 React 화면
  shared/                명령·이벤트·공유 타입
  runner/                Docker 실행·검증·broker·복구
  server/                M1 샘플 Fastify API·SSE
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

| 명령                | 용도                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`          | 로컬 API + Electron 개발 앱                                              |
| `pnpm server`       | 로컬 API만 시작                                                          |
| `pnpm dev:web`      | 같은 renderer를 브라우저에서 확인; API 별도 실행                         |
| `pnpm check`        | 포맷·문서 링크·타입·빌드·실제 DB 테스트                                  |
| `pnpm test`         | 도메인·API 테스트; 실행 중인 DB 필요                                     |
| `pnpm build:mac`    | `release/<version>/`에 미공증 앱·ZIP·체크섬 생성                         |
| `pnpm start`        | 빌드된 Electron 앱 실행; DB/Docker 별도 필요                             |
| `pnpm runner:image` | Claude Code·Playwright 실행 이미지 준비                                  |
| `pnpm test:runner`  | 실제 Docker + 가짜 Claude 계약 검사; DB/이미지 필요                      |
| `pnpm test:web`     | 실제 renderer/DB + 테스트용 IPC 브라우저 시나리오                        |
| `pnpm test:desktop` | 실제 Electron 시작 실패·재연결·종료, 응답은 fixture                      |
| `pnpm verify:mac`   | 패키지 파일·보안 fuse·서명 무결성 검사                                   |
| `pnpm release:mac`  | Developer ID·Keychain profile 필요. 서명·공증 후 ZIP 생성, 게시하지 않음 |

패키지는 개발용 미공증 빌드입니다. 앱에 DB 클라이언트·실행기를 포함하지만 PostgreSQL과 Docker는 별도로 실행해야 합니다. GitHub의 **macOS package** 워크플로우에서도 수동 빌드를 할 수 있으며 공개 GitHub Release를 자동 발행하지 않습니다.

## 개발 원칙

1. 중요한 요구·설계를 먼저 문서화하고 개발자 승인을 받습니다.
2. 승인된 범위 안의 구현 선택과 검증은 자율적으로 진행합니다.
3. 개발자는 필수 검토·검사 기준을 우회하거나 테스트를 약화해 완료 처리하지 않습니다.
4. 문서나 에이전트의 완료 선언과 실제 실행 근거를 구분합니다.

[CONTRIBUTING](CONTRIBUTING.md)과 [AGENTS](AGENTS.md)에 구체적인 작업·검증 기준을 정리했습니다.
