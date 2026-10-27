# 게이트 0.9.14-preview (D-079), 2026-10-28

| 관문 | 결과 |
|---|---|
| typecheck | 오류 0 (`tsc --noEmit`) |
| decisions:check | 불일치 0 (`tools/check_decisions.ts`) |
| npm test | 단위 662 + 플랜 72 = 734 전수 통과 (`--testTimeout=20000`. 기본 5초에서는 PC 부하로 `preview.test.ts`·`routineList.test.ts` 시간 초과 1~2건, 단독 재실행 통과) |
| E2E (iPhone 13 WebKit·Chromium + PC 1280) | 버전 올린 뒤 07:2x 전체 169/170 — 실패 1 = `app.spec.ts:2530` D-056 휴식 진동(chromium, `.rest-pill.end` 5초 안 안 보임, 시간 의존). 단독 3회×2엔진 6/6 통과 → 부하 흔들림으로 판단. 버전 올리기 전 01:01 전체 170/170 |
| UX/UI 감사 게이트 | `node tools/uxui_audit.ts --gate` exit 0 — PASS 22 · INFO 4 · JUDGED 11 · N/A 12 (기준선 FAIL 13) |
| build:next | 정상 |
| 독립 검토 (Opus) | 9.55 / 10 (PASS-with-findings, 지적 3건 반영) — `docs/reviews/d079-uxui.md` |
| 저장 구조 | 바뀜 없음 (Dexie·동기화 그대로. 영구 삭제 Undo는 제안 P-01로 보류) |
| 사용자 확인 | 미리 보기 판 실기기 확인 대기 (L-01 WebKit 줄 끝 문장부호 32곳 포함) → 본판은 "메인 배포" 승인 후 |

## 주요 반영 사항
- **D-079**: UX/UI 가이드(`VIBE_CODER_UXUI_GUIDE.md`) 49개 규칙을 DB화해 적용
  - 화면마다 주 버튼 1개, 나머지는 옅은 버튼(tonal)으로
  - 입력 오류는 버튼을 막지 않고 누르면 잘못된 칸으로 이동 + 이유 표시(`formError.ts`)
  - 행동 라벨(루틴 저장하기·기록 저장하기·운동 추가하기 등), 기록 수정의 운동 빼기 5초 되돌리기
  - 카드 면 링(`--surface-ring`)·여백 20/24, `:focus-visible`, 한국어 단어 단위 줄바꿈
  - 측정: `e2e/uxui.spec.ts`, 감사: `tools/uxui_audit.ts` (`npm run test:uxui`)
