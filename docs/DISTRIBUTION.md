# 외부 배포 준비 · 0.3.0-beta.1

상태: **온보딩·단계별 에이전트를 구현한 로컬 베타 후보**. 사용자는 이번 변경의 전담 리뷰·검사 후 main 반영을 승인했다([승인 기록](design/V03-APPROVAL.md)). 공개 Release 게시와 Apple 서명·공증은 별도이며 아직 완료하지 않았다.

## 이번 보강 범위

| 입력/실패                                | 프로그램의 처리                                                          | 확인할 결과                                            |
| ---------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| 시작 시 DB 중단                          | DB 없이 시작 가이드 표시, 전용 환경 준비·재시도·취소                     | 원본 데이터 보존, 두 번 재연결해도 정상 종료           |
| DB 연결 중단                             | idle 오류 처리, 직렬 재연결, 오래된 snapshot 무시                        | 마지막 화면 보존, 복구 후 오류 해제                    |
| 렌더러 파일/권한 요청                    | 정확한 앱 문서만 IPC 허용, 권한·새 창·webview·다운로드 차단              | 다른 file URL 및 개발 origin 사칭 거절                 |
| 에이전트가 FIFO/큰 파일/심볼릭 링크 생성 | nonblocking open + 열린 파일의 일반 파일 여부·실제 읽은 바이트 상한 확인 | 파일 읽기 때문에 취소/종료가 멈추지 않음               |
| 검사 제한 시간 초과                      | 후속 검사 중지, 컨테이너 제거 및 종료 확인                               | 고아 명령·다음 검사 중첩 없음                          |
| 이전 컨테이너 종료 미확인                | 프로젝트/전체 실행 슬롯 점유                                             | 같은 프로젝트 새 실행 차단                             |
| 연결 파일 손상                           | 구조 검증 후 실패, 원본 파일 유지                                        | 잘못된 파일을 빈 연결 목록으로 덮어쓰지 않음           |
| 패키지 생성                              | 격리 폴더에서 frozen/offline production 설치, scripts 미실행             | 개발 작업 공간 의존성 유지, 비밀·테스트·개발 소스 제외 |
| 배포 빌드                                | Developer ID 서명 → 공증 → staple → Gatekeeper 확인                      | 실패 시 미서명 배포본으로 대체하지 않음                |

Electron 보안 fuse로 RunAsNode, NODE_OPTIONS, CLI inspector를 비활성화하고 ASAR 전용 로딩과 내장 무결성 검사를 활성화한다. 권한/CSP/IPC 검사와 함께 적용하며 OS 관리자나 같은 로컬 사용자에 대한 완전한 격리를 주장하지 않는다. [Electron 보안 지침](https://www.electronjs.org/docs/latest/tutorial/security), [fuse 설명](https://www.electronjs.org/docs/latest/tutorial/fuses).

## 패키지 생성과 검증

Apple Silicon macOS + Node 24 + pnpm 11.0.4 + Xcode Command Line Tools에서 실행한다.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test:runner
pnpm test:web
pnpm build:mac
pnpm test:desktop
pnpm verify:mac
```

`release/<version>/`에 미공증 ZIP, SHA-256, build-manifest.json을 만든다. manifest는 실제 commit·dirty 여부·lockfile hash·Electron 버전·공증 여부를 기록한다. 테스트 중 만든 dirty 빌드는 배포본으로 쓰지 않는다. 패키지에는 Git/Docker/DB 준비 파일, 설치·복구 안내, production 의존성 목록과 저작권 고지를 넣는다. Electron/Chromium 고지는 원래 배포 파일을 유지한다.

`pnpm verify:mac`은 포함 파일·pg/zod 버전·비밀 파일 제외·보안 fuse·서명 무결성을 검사한다. **ad-hoc 서명 무결성 통과는 Developer ID 서명이나 공증 성공을 뜻하지 않는다.** 실제 GUI·provider 검증도 대신하지 않는다.

서명 가능한 Mac에서 Keychain에 Developer ID Application 인증서와 notarytool profile을 준비한 뒤 아래 환경변수의 이름만 사용한다. 비밀번호·private key를 소스/명령 인자/PR/채팅에 넣지 않는다.

```bash
ROOPRE_SIGNING_IDENTITY='Developer ID Application: 발급된 실제 ID' \
ROOPRE_NOTARY_PROFILE='Keychain에 저장한 profile 이름' \
pnpm release:mac
```

이 명령은 자격 증명과 clean commit을 먼저 확인하고 check·Docker·웹·Electron 시작 검사를 모두 통과한 뒤 로컬 서명·Apple 공증과 ZIP 생성을 수행한다. PostgreSQL과 실행 이미지가 준비되어 있어야 한다. GitHub Release 공개나 자동 업데이트 게시를 수행하지 않는다. 자격 증명 미준비 시 즉시 실패한다. [Electron 서명·공증 설명](https://www.electronjs.org/docs/latest/tutorial/code-signing).

## 배포 전에 반드시 확인할 조건

| 조건                 | 현재 상태 / 필요한 결정                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 배포 대상            | 비공개 개발자 베타 권장. 공개 베타/팀 서비스는 별도 결정 필요                                                                     |
| 서명·공증            | 준비 경로 구현. Apple Developer 가입·인증서 준비 여부 답변 필요. 실제 서명/공증 미수행                                            |
| 실제 Claude 연결     | API key를 앱에서 등록하고 사용자 승인된 비용 한도로 streaming/tool/E2E를 검증해야 함. fixture 성공으로 대체할 수 없음             |
| 사용자 본인 승인     | 실제 로그인한 Mac에서 승인 성공·취소·승인 중 설계 변경을 수동 확인해야 함. 에이전트가 본인 확인을 대신하지 않음                   |
| 깨끗한 다른 Mac 설치 | 소스·Node·pnpm 없는 Mac에 ZIP 설치, Git/Docker 감지 및 앱 환경 준비, 첫 작업 완료, 재시작 복원 확인 필요                          |
| DB 자격 증명         | 새 환경은 프로필별 임의 자격 증명과 전용 볼륨 사용. 기존 개발 DB는 명시적인 백업·검증 이전 지원. 원본은 유지                      |
| 팀 공유              | SSO/RBAC/원격 runner/서버 API는 M3. 현재 개발 fixture를 외부에 바인딩해 대체하지 않음                                             |
| 업데이트             | 수동 교체만 지원. 실행 중단 확인 → DB 백업 → 교체 → 연결/기록 복원 검사. 자동 업데이트 서버·서명된 feed·rollback 전략은 별도 설계 |
| 배포 정책            | 비공개 저장소/UNLICENSED 유지. 공개 소스 여부, 사용 조건, 문의 채널·지원 범위 결정 필요                                           |
| 머지                 | 이번 PR은 최신 사용자 지시로 리뷰·검사 후 main 반영 승인. 정확한 최종 head/base 확인 필요                                         |

현재 앱이 모든 개발자가 같은 품질로 개발하도록 강제하는 팀 서비스까지 완성됐다고 판단하지 않는다. 이 버전은 로컬 실행·품질 경계를 먼저 검증하는 단계다. 특히 실제 모델 실행, 사용자 인증, 다른 Mac 설치 세 조건이 통과하기 전에는 실무 배포 완료라고 표시하지 않는다.

## 데이터·문제 보고·복구

- 모델 제공자: 사용자가 설정한 HTTPS endpoint에 승인된 설계·지침·코드/도구 결과가 전달될 수 있다. 연결 검사도 실제 요청이며 소량의 비용이 발생할 수 있다.
- 로컬 보관: PostgreSQL에 설계·실행 상태·프로젝트 경로, 사용자 데이터 폴더에 암호화 key와 실행 체크아웃·근거를 보관한다. 현재 별도 텔레메트리·자동 오류 업로드·자동 GitHub 게시 기능은 없다.
- 문제 보고: 앱/macOS 버전, 단계, 재현 방법을 적고 필요한 발췌만 검토 후 공유한다. 원본 key·connections.json·DB dump·전체 로그는 첨부하지 않는다.
- 백업/복구 명령과 데이터 보존 원칙은 패키지의 [설치 안내](../resources/setup/README.md)에 있다. 복원은 별도 DB에서 먼저 검증하고 운영 DB에 자동 덮어쓰지 않는다.

현재 GitHub private repo 요금제의 branch protection 제한은 그대로다. 전용 CLI 승인 절차를 적용하지만 직접 웹/API 머지를 서버에서 막는다고 주장하지 않는다.
