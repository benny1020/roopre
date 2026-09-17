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

21은 상위 API 테스트와 하위 테스트를 포함한 테스트 러너의 집계다. 전체 제품 인수 시나리오 21개를 완료했다는 뜻이 아니다. 자동 검사는 [CI](https://github.com/benny1020/roopre/actions/workflows/ci.yml)에서 각 커밋에 대해 재현한다. 로컬 상세 로그는 git에서 제외된 `artifacts/check.log`, `artifacts/package.log`, `artifacts/audit.log`에 있다.

패키징 중 pnpm의 의존성 링크 탐색 실패를 확인해, 전체 소스/의존성 대신 빌드된 데스크톱 런타임만 임시 디렉터리에 준비하도록 수정했다. API는 별도 서버이므로 앱에 포함하지 않는다. Electron 바이너리가 설치 스크립트 생략으로 없을 때의 dev 시작 실패도 확인해 앱 시작 시 명시적인 바이너리 설치 단계를 추가했다.

승인 규칙/API/DB를 원본과 비교했으며 해당 모듈의 변경은 import 경로와 로그의 앱 이름이다. 승인 문서 원본 SHA-256은 `31a7f8c0c2bf171f6432dc70973f5056e5d33f791c9030bb8b6d19055c228832`로 동일하다. DB compose 프로젝트/볼륨은 유지했다.

[최초 M1 검증](design/M1-ORIGINAL-VERIFICATION.md)은 이전 폴더 기준의 역사 기록이다. 그 문서의 로컬 로그/앱 경로는 보존본 기준이며 현재 저장소의 실행 근거로 사용하지 않는다.

현재도 실제 CLI·worktree 병렬 실행·팀 인증·자동 웹 테스트는 연결하지 않았다. 네이티브 창 조작과 최소 창 크기 검증의 기존 제한도 유지된다. 서명·공증·공개 Release는 수행하지 않았다.
