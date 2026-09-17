# 루프리 아이콘

- 앱 표시 이름: **루프리**
- 영문 식별자: **roopre**
- [원본 PNG](icon.png): 1024×1024, 투명한 외곽, 앱 내부/Dock/웹 아이콘.
- [macOS ICNS](icon.icns): 16–1024px 표현을 포함한 패키지 아이콘.
- 재생성: macOS에서 `pnpm build:icons`. PNG의 크기·포맷만 변환하며 그림을 다시 생성하지 않는다.

내장 imagegen으로 신규 제작했다. 별도 CLI/API 키를 사용하지 않았다. 새 아이콘은 남색 타일 위에 민트·하늘색 리본이 한 루프로 이어지는 형태로 반복 가능한 개발 흐름을 표현한다. 기존 설정 경로와 API/DB 식별자는 브랜딩 변경과 무관하게 유지한다.

## 제작 프롬프트

```text
Create one finished macOS application icon for a developer workflow app named roopre (Korean 루프리). Use-case: logo-brand. A striking, compact abstract lowercase r formed by a single continuous folded loop/ribbon: one clear open loop and a short rising terminal, conveying repeatable development and forward motion. Original identity, highly recognizable silhouette at 32px. Premium restrained Apple desktop app craft: deep midnight-blue rounded-square tile, luminous mint-to-icy-blue sculpted ribbon with subtle soft bevel and controlled studio highlights, very subtle depth, generous negative space. Centered, front view, precise balanced geometry. No letters or words printed on the icon, no text, no robots, no gears, no code brackets, no sparkles, no extra symbols, no busy textures. One icon only, not a presentation sheet, no device mockup. Square 1024x1024 PNG. Tile occupies about 86% of canvas width, smooth macOS rounded corners, fully transparent alpha outside tile including corners; no white backdrop and no checkerboard rendered as artwork. Clean polished production asset ready for a macOS Dock icon.
```

생성 결과를 PNG 1024px로 정규화하고 macOS 기본 도구 `sips`·`iconutil`로 ICNS를 내보냈다.
