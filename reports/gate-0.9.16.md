# 게이트 0.9.16-preview (D-080 종목 교체 단축 + 루틴 미리보기), 2026-11-16

| 관문 | 결과 |
|---|---|
| typecheck | 오류 0 (`npx tsc --noEmit`) |
| decisions:check | M 결정 33개 불일치 0 (`node tools/check_decisions.ts`) |
| npm test | 단위 724 + 플랜 72 전수 통과 (`npm test`), `src/core` 줄 커버리지 99.61% (similar·undoWindow·routineDiff·session 줄 100%) |
| E2E (iPhone 13 WebKit·Chromium + PC 1280) | 최종 b429e5e 전체 218/218 (9.2m, 다른 실행과 겹치지 않게). 중간 108bd53 실행에서 D-056 휴식 끝 진동 WebKit 1회 흔들림(다른 e2e 와 동시 실행, 단독 3/3 통과) |
| UX/UI 감사 게이트 | `node tools/uxui_audit.ts --gate` exit 0 — PASS 22 · INFO 4 · JUDGED 11 · N/A 12 |
| 동기화 서버 | syncMerge·syncStamp·hlc·tools/gas 변경 없음 → Apps Script 재배포 불필요. 새 선택 칸 `swappedFrom`·`splitWork` 는 syncMerge 가 펼쳐 복사(시험 sync.test.ts) |
| 저장 구조 | DB 버전 그대로. WorkoutItem 선택 칸 2개 추가(백업 검사 optStr·optNum, 옛 백업 그대로 통과) |
| 독립 검토 (Opus, 매회 새 검토자) | 7.6 → 8.52 → 8.90 → 9.00 → 9.30 → 9.44 → **9.52 PASS** (blocker·major·minor 0, nit 7). 채점표 `G:\내 드라이브\WORK_OUT_APP\docs\reviews\v0.9.16.md` |
| 사용자 확인 | 미리 보기 판 실기기 확인(VoiceOver 알림 읽기·390px 묶음 카드 포함) → 본판은 "메인 배포" 승인 후 |

## 주요 반영 사항 (D-080)
- 교체 창: 맨 위 "비슷한 운동" 최대 5개(같은 변형 묶음 → 같은 움직임·주 근육 → 같은 움직임·부위, 해 본 운동 최근 순), 모든 줄에 "지난번 무게×횟수 · 며칠 전"
- 운동 중: 운동 머리 ⇄ 바로 교체(⋯ 메뉴 유지). 끝낸 작업 세트가 있으면 남은 세트만 새 운동 카드로(묶음은 묶음 다음 단일 블록), 끝낼 때 [루틴 업데이트]는 "교체"로 접어 원래 자리·세트 수 유지
- 시간↔횟수 운동 교체 때 새 운동 기본 목표(기존 ⋯ 교체 버그도 고침)
- 루틴 카드 누르면 미리보기(운동별 세트×횟수·지난 기록·[시작][편집]), 홈 다음 운동 카드에 운동 줄 전부(시작 버튼은 그 아래 — D-055 대체)
- 미리보기·홈 ⇄ = 루틴에 바로 저장 + 5초 [되돌리기](여러 번 바꾸면 한 번에, 초점·누름·교체 창 동안 시간 멈춤, 제자리로 돌아오면 처음 모습 그대로 저장)
- 루틴 편집 ⇄(저장은 [루틴 저장하기]), 플랜 교체 창에도 비슷한 운동
- 기존 버그: 플랜에서 교체·추가 중 새 운동 직접 추가하면 창이 안 닫히던 오류
