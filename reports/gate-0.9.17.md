# 게이트 0.9.17-preview (D-081 기록 요약 카드 주·월·년 + 시인성), 2026-11-17

| 관문 | 결과 |
|---|---|
| typecheck | 오류 0 (`npm run typecheck`, 최종 8af31b2) |
| decisions:check | M 결정 33개 불일치 0 |
| npm test | 단위 755 + 플랜 72 전부 통과, `src/core` 줄 커버리지 99.63%, period.ts·periodText.ts 줄·분기 100% |
| E2E | 8af31b2 전체(--workers=1, 로그 reports/e2e-0.9.17-8af31b2.txt, HEAD 머리글): 262/264 — 실패 2 = uxui.spec.ts:465 설정 묶음 기억(WebKit·Chromium). 원인 = 시험이 toggle 저장 전에 새로고침하는 경쟁(설정 화면, D-081 무관 — 고침은 후속) |
| UX/UI 감사 게이트 | 8af31b2 e2e 직후 `node tools/uxui_audit.ts --gate` exit 0 — PASS 22 · INFO 4 · JUDGED 11 · N/A 12 (reports/uxui-audit-0.9.17-8af31b2.txt) |
| 동기화 서버 | syncMerge·syncStamp·hlc·tools/gas 변경 없음 → Apps Script 재배포 불필요 |
| 저장 구조 | DB·백업 변경 없음 (기기 설정 localStorage `stats.period.v1` 만 추가) |
| 독립 검토 (Opus, 매회 새 검토자) | 9.15 → 9.30 → 9.60 → 9.68 → 9.45 → 9.45 → 9.55 → 9.65 → 9.70 → **9.65 PASS** (최종 8af31b2, blocker·major·minor 0). 채점표 Drive WORK_OUT_APP/docs/reviews/v0.9.17.md |
| /ogf 패널 (role-stacking, 평균 ≥9.25) | 9회, 최고 9.00 — 미달(nit 만 남은 채 수렴하지 않아 중단) |
| 사용자 확인 | 본판은 "메인 배포" 승인 후 |

## 주요 반영 (D-081)
- 기록 → 요약 카드: 주|월|년 전환, ‹ 기간 › 이동(가장 오래된 기록까지), 이동 줄 "vs. 지난주"
- 맨 위 한 문장 해석("지난주 이맘때보다 작업 세트가 9세트 많아요"), 지표 카드 2×2(지금 값 크게·이전 값 작게·▲▼=, 누르면 그래프 지표)
- 막대 그래프(이번 칸 강조·평균 범례·최댓값 눈금·운동한 날 점), 탭·가로 훑기·방향키로 칸 값 보기, 세로로 끌면 스크롤만
- 비교 = 지난 기간 같은 시점까지(오늘 운동 전이면 어제까지, 첫날 운동 전이면 "운동하면 비교해요", 월말엔 "지난달 전체"), 홈 "지난주보다"도 같은 구간
- 100만 kg 이상 톤, 시간은 시간+분, 보이는 값끼리 비교
