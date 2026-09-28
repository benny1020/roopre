# Git host 연동 및 worktree 실행 구현 승인

2026-09-28 사용자 지시: “github뿐만아니라 사내gitlab 이런것도 다 지원가능하게해줘”, “동시성 이슈없도록 워크트리 기반으로 작업하게해줘”, “모두개발해서 메인에 반영해줘”.

고정 설계: `GIT-HOST-INTEGRATION.md` SHA-256 `72d4dd5f0ba4682a1d2a79cd008712c3e920b6e8a97d7f25a9f96c4673d3cc87`. 최초 승인 기록 뒤 문서 포맷만 정규화했으며 설계 범위·결정은 바꾸지 않았다.

이번 구현은 GitHub.com/GitHub Enterprise와 GitLab.com/사내 GitLab 연결 정보를 별도 macOS 암호화 저장소에 보관하고, 안전한 remote 감지·연결 검사·프로젝트 binding을 제공한다. 지원하지 않는 provider는 일반 Git remote로 명확히 표시한다. 실행 checkout은 feature/run/attempt별 `git worktree`로 만들며, 독립 작업은 병렬로 실행하고 원격 전달은 사용자의 명시적 후속 동작으로 남긴다.

이 승인은 앱 안의 설계 본인 승인, host의 branch protection, 사람의 최종 PR/MR merge 승인을 대신하지 않는다. 실제 GitHub/GitLab token이나 회사 프로젝트는 이 구현 승인만으로 호출하지 않는다.
