# Java · Gradle · Spring Boot 실행

루프리는 Gradle 기반 Java 저장소를 선택하면 root의 `gradlew`, `build.gradle`, 또는 `build.gradle.kts`를 감지해 Java · Gradle 런타임을 제안한다. `build.gradle`/`build.gradle.kts` 안의 Spring Boot plugin 표기도 함께 표시한다.

기본 고정 검사는 셸을 거치지 않는 argv로 다음과 같다.

```text
gradle --no-daemon classes
gradle --no-daemon test
```

실행 이미지는 Java 21과 [Gradle 8.14.5](https://gradle.org/releases/)를 포함한다. Java 21은 Gradle 8.5 이상에서 실행할 수 있으며, 프로젝트가 더 오래된 Gradle 또는 별도 JDK/toolchain을 요구하면 실행 프로필의 검사 argv를 프로젝트 기준으로 바꾼 뒤 설계를 다시 승인해야 한다. 루프리는 사용자 저장소의 `gradlew` shell script나 wrapper JAR을 자동 실행하지 않는다.

각 실행은 고정 base commit에서 만든 worktree를 사용한다. Gradle 의존성은 시작 시 unprivileged setup container가 `testClasses`로 한 번 준비한다. 준비 직전 root가 read-only source를 `.git` 없이 실행별 Docker workspace volume에 복제하고, cache와 workspace volume을 `pwuser` 소유로 초기화한다. 이 준비 단계는 공개 Maven/Gradle repository에 연결할 수 있지만 host home, API key, Git credential, Docker socket은 전달하지 않는다. 구현·검사·리뷰 container는 cache의 private copy만 사용하므로 agent가 만든 Gradle cache가 고정 검사에 이어지지 않는다.

`.gradle/`과 `build/`은 검증 전 정리한다. Gradle의 `build/reports` 아래 HTML·JSON·이미지와 `build/test-results`의 JUnit XML 결과는 실행 산출물로 hash와 함께 보관한다. root와 멀티모듈의 `build.gradle`, `settings.gradle`, `gradle.properties`, 그리고 `gradle/` wrapper·version catalog·convention 파일은 고정 검사 계약에 포함돼 agent나 검사 과정에서 변하면 실행을 중단한다. 통합 테스트, Testcontainers, 사내 Maven repository, 추가 JDK는 프로젝트의 고정 검사 argv·image와 지침으로 명시한다.
