# 에이전트 대화와 기억: 적용 결정

조사·설계 기준일: 2026-09-28. [고정 설계](../design/AGENT-CONVERSATION-MEMORY.md)와 [사용자 승인](../design/AGENT-CONVERSATION-MEMORY-APPROVAL.md)이 구현 범위의 기준이다. 공급자 문서의 지원 기능을 루프리에 이미 연결된 기능으로 해석하지 않는다. 구현과 검증 상태는 [작업 기록](../design/AGENT-CONVERSATION-MEMORY-IMPLEMENTATION.md)에서 구분한다.

## 왜 앱이 기억을 보관하는가

Claude Agent SDK는 명시적인 세션을 저장하고 재개할 수 있지만, 대화의 재개와 파일 시스템 복구는 다르다. 루프리의 기존 실행기는 격리된 컨테이너에서 새 CLI 프로세스를 실행하므로, 세션 ID만 저장한다고 다음 작업에 기억이 이어지지 않는다. 필요한 기록을 앱에서 보관하고 새 실행에 전달하는 방식부터 적용한다. 공유 writable home이나 CLI 세션 폴더를 추가하지 않는다. [Anthropic 세션 문서](https://code.claude.com/docs/en/agent-sdk/sessions).

Anthropic의 memory tool도 실제 저장·조회·범위 검증을 애플리케이션에서 구현하는 인터페이스다. 루프리는 임의 파일 경로 대신 서버가 검증한 프로젝트·에이전트·기능 ID로 기록을 찾는다. [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool).

## 원문, 요약, 작업 상태, 장기 기억의 역할

길어진 대화의 압축, 구조화된 노트, 필요한 자료의 조회는 서로 보완한다. 원문을 요약으로 대체해 버리면 요약에서 빠진 결정의 근거를 복구할 수 없다. 따라서 원문은 보존하고, 요약에는 실제 포함한 범위와 출처를 붙인다. 모델이 쓴 요약을 검사 성공이나 사용자 승인으로 취급하지 않는다. [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

OpenAI의 지속 conversation 객체와 compaction도 구분된 기능이다. 특히 불투명한 압축 상태를 사람이 편집하는 프로젝트 지식과 동일시하지 않는다. 이번 구현은 현재 Messages 호환 연결을 사용하며 OpenAI Conversations/Responses 연결을 추가하는 작업은 아니다. [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state), [Compaction](https://developers.openai.com/api/docs/guides/compaction).

thread 상태와 여러 대화에 재사용할 기억 저장소를 분리하는 개념은 LangGraph 문서에도 나타난다. 루프리는 이 분리를 적용하되 프레임워크·벡터 DB를 새로 도입하지 않는다. 범위 필터와 어휘 검색을 먼저 검증하고, 검색 품질에서 실제 한계가 확인되면 의미 검색을 별도 평가한다. [LangGraph memory](https://docs.langchain.com/oss/javascript/concepts/memory).

## 루프리의 적용 흐름

사용자 질문을 해당 에이전트의 대화에 저장한다. 질문·필수 지침을 먼저 확보하고, 같은 범위의 기억·최근 대화·작업 근거·요약·과거 검색 결과를 제한된 입력 크기에 맞춰 선택한다. UI에는 실제로 보낸 참조 목록을 표시한다. 상담 결과는 읽기 전용이며 실행 중인 CLI를 조작하지 않는다.

사용자가 확인한 기억만 다음 개발 입력에 재사용한다. 기억 변경은 해당 프로젝트의 승인에 영향을 주고, 실행 중인 입력에는 반영하지 않는다. 시작 시 고정한 기억 ID·버전·내용 해시를 실행 기록에 남긴다. 다른 프로젝트의 기억, 자동 요약의 추측, 오래된 성공 주장이 승인이나 도구 권한을 바꾸지 못하게 한다.

공식 문서를 조사한 것과 실제 모델의 기억 품질을 검증한 것은 별개다. 실모델 호출·장기 운영·App Store 제출 적합성은 자동 fixture 검사 결과와 구분해 보고한다.
