# 루프리 설치·복구 안내

이 빌드는 로컬 소유자용 베타 후보입니다. Apple Silicon Mac, Git, 실행 중인 Docker Desktop이 필요합니다. 아직 공개 배포 승인된 설치 파일이 아닙니다.

## 첫 실행

1. 앱을 Applications 폴더에 복사합니다. Docker Desktop을 설치하고 실행합니다. Git이 없다면 터미널에서 `xcode-select --install`을 실행합니다.
2. 이 폴더를 터미널로 엽니다. 앱에서 “설치 안내 열기”를 누르면 같은 폴더를 찾을 수 있습니다. 아래 명령은 이 폴더에서 실행합니다.
3. `docker compose -f compose.yaml up -d --wait`로 로컬 DB를 시작합니다.
4. `docker build -t roopre-runner:0.2 -f runner.Dockerfile .`로 실행 이미지를 만듭니다. 첫 준비에는 네트워크와 수 GB의 공간이 필요합니다.
5. 앱의 “다시 연결”을 누릅니다. 표준·연결·실행 환경에서 endpoint/API key와 프로젝트를 설정합니다. 모델 연결 검사는 소액 과금이 발생할 수 있습니다.

Node/pnpm이나 루프리 소스 저장소는 패키지 실행에 필요하지 않습니다. 개발할 저장소와 Docker/Git은 필요합니다. DB 주소는 127.0.0.1:55441이며 외부 네트워크에 공개하지 않습니다. 이 베타의 DB는 로컬 개발용 고정 자격 증명을 사용하므로 같은 Mac의 다른 사용자/프로세스를 신뢰하는 환경에서만 사용합니다. 팀 공유 서버로 사용하지 마세요.

## 복구·업데이트

- DB 중지: `docker compose -f compose.yaml stop`. 다시 위의 DB 시작 명령을 실행하면 기존 볼륨을 사용합니다.
- Docker 중단 후: Docker를 다시 켜고 앱을 재시작합니다. 이전 컨테이너 종료가 확인된 뒤 실패/중단 작업을 재시도합니다.
- 앱 업데이트: 실행 중인 작업을 먼저 중단하고 종료를 확인한 뒤 앱을 종료합니다. DB를 백업하고 새 앱으로 교체합니다. 자동 업데이트는 제공하지 않습니다.
- DB 백업: `docker compose -f compose.yaml exec -T db pg_dump -U devflow -d devflow --format=custom > roopre-backup.dump`. 백업은 설계·경로 등 개인정보를 포함하므로 공유하지 마세요. 복원은 별도 DB에서 먼저 검증합니다.
- 기존 앱의 API key는 macOS 암호화 저장소와 사용자 데이터 폴더에 묶여 있습니다. 다른 Mac에서 파일만 복사해 복원할 수 있다고 보장하지 않습니다. 동일 서명 ID로 업데이트하고 key 재입력이 필요한지 확인합니다.
- 앱 삭제는 DB와 사용자 기록을 삭제하지 않습니다. `docker compose down -v`, DB 볼륨 삭제, 사용자 데이터 폴더 삭제를 복구 절차로 사용하지 마세요.

문제 보고 시 앱 버전·macOS 버전·발생 단계·재현 방법을 전달하세요. API key, 연결 파일, 원본 저장소, DB 백업, 전체 실행 로그를 그대로 보내지 마세요. 실제 모델·네이티브 승인·깨끗한 다른 Mac 설치는 배포 전 별도 검증해야 합니다.
