# 게이트 0.9.18-preview (D-082 기록판 2차 개선 — 막대+누적·전체 탭·훈련 부하·기간 내역), 2026-11-20

가지 `w-records2` (main e497b27 위 11커밋: a2ea87d WP1 기간 계산·문구 · d976ec6 WP2 부하 · d3134c6 WP3 화면 · 23bde8d WP4 e2e · 4ade924 e2e 단언 3개 · 5d9c899 M04 토큰 · b94d8f7 WP5 패널 1회 지적 · d12002b 죽은 e2e 단언 되살림 · 2af721a WP6 패널 2회 지적 · 980531f WP7 패널 3회 지적 · 6fa0f95 게이트 중간 기록 · 판 올림 0.9.18-preview). **최종 코드 = 980531f (그 뒤 커밋은 기록·판 번호만).** 아래 '최종' 줄이 이 커밋 기준이고, 그 아래 '이전' 줄은 기록으로 남긴다.

| 관문 | 결과 |
|---|---|
| typecheck | **최종 980531f 오류 0** (`npm run typecheck`) |
| decisions:check | M 결정 33개 불일치 0 |
| npm test | **최종 980531f: 단위 863 + 플랜 72 전부 통과**, src/core 줄 99.65%, periodText.ts 줄 100%·분기 98.13% (reports/unit-0.9.18-980531f.txt — 머리 줄에 HEAD·깨끗한 작업 폴더). 2af721a: 단위 860 + 플랜 72 (reports/unit-0.9.18-2af721a.txt). 이전 23bde8d: 단위 840 + 플랜 72 전부 통과 (reports/unit-0.9.18-23bde8d.txt). src/core 줄 커버리지 99.65%(기준 90%, reports/unit-0.9.18-23bde8d.txt:22·61), period.ts·periodPref.ts·loadText.ts 줄 100%, periodText.ts 줄 100%·분기 97.41%(377/387, 같은 로그 :34 — 처음 98.4% 로 잘못 옮김, 패널 Replication 지적으로 정정), stats.ts 줄 100% |
| E2E 전체 | **최종 980531f: 미완(배포 관문 미충족).** 로그 끝 요약 184 통과 · 7 실패 · 177 실행 안 함(18.9분, reports/e2e-0.9.18-980531f-w1.txt) — 나눠 보면 **iphone-webkit 184/184 전부 통과, iphone-chromium 0 실행**: 7 실패는 chromium 각 파일 첫 시험에서 `worker process exited unexpectedly (code=3221225794 = 0xC0000142, 작업자 시작 실패)` 0ms(로그 397~423행) — 단언 실패 아님. 같은 때 Claude Code 가 메모리 부족으로 백그라운드 명령을 멈춤. 다시 돌리기는 사용자 요청 때만, chromium 을 따로 돌린다. · 같은 내용으로 작업자가 돌린 records2+records 스펙 두 브라우저 각 75/75(reports/e2e-0.9.18-980531f-records-*.txt, 머리 줄은 '2af721a + 작업 폴더' — 980531f 와 같은 내용임은 INFERRED). · 2af721a 전체 실행(reports/e2e-0.9.18-2af721a-w1.txt): 181 통과 · 8 실패 · 175 실행 안 함 — 7 개는 같은 chromium 시작 실패, **1 개는 실제 단언 실패**: webkit `app.spec.ts:2235` D-055 홈 루틴 카드(`getByRole('button', { name: /^등 30분,/ })` 없음, 로그 393~414행). 그 시험은 980531f 실행에서 통과했고 2af721a→980531f 사이 그 시험 파일 변경 없음 → 불안정 시험으로 봄(INFERRED, 단독 재실행 없음). · 이전 23bde8d: `--workers=1` 337 통과 · 1 실패(D-056 휴식 진동 webkit, 단독 재실행 1/1 통과 reports/e2e-0.9.18-rest-rerun.txt), 병렬 335 · 3 실패(reports/e2e-0.9.18-23bde8d-parallel.txt, 3 개 단독 재실행 통과 — 그 출력은 저장 안 함) |
| E2E 새 스펙 | `e2e/records2.spec.ts`(목업 상황 11개 × 단위 4 × 보기 3, 부하 카드, 칸 고르기·내역, 시간 지표, 보기 저장, 375·320px, 카드 순서·눈금 없음·높이 기준 단언) 4ade924 기준 chromium 30/30(44초)·webkit 30/30(4.8분) |
| UX/UI 감사 게이트 | 5d9c899 에서 `npm run test:uxui` exit 0 — uxui.spec 20/20, 감사 PASS 22 · INFO 4 · JUDGED 11 · N/A 12 (reports/uxui-audit-0.9.18-5d9c899.txt). 그 전 M04(직접 쓴 색 1개) FAIL → `:root` 토큰 `--warn-soft` 로 고침(값 같음) |
| 동기화 서버 | syncMerge·syncStamp·hlc·tools/gas 변경 없음 → Apps Script 재배포 불필요 |
| 저장 구조 | DB·백업 변경 없음. 기기 설정 localStorage `stats.period.v1` 에 `mode` 추가(옛 값 → 막대+누적, 단위 시험 periodPref.test.ts) |
| 독립 검토 (Opus) | 1차 9.60 PASS(5d9c899), **2차 9.63 PASS(2af721a) — 조건 '최종 커밋 전체 e2e 실패 0' 은 아직 미충족**(위 E2E). **3차 9.60 PASS(605817b = 코드 980531f, WP7 집중 판정 통과)** — 배포 조건: chromium e2e 실패 0 + uxui — docs/reviews/v0.9.18.md |
| role-stacking 패널 (/fgf, 평균 ≥9.25·최저 ≥8.0, 최대 3회) | 1회 8.67(ML 9.3·Repl 7.8·DA 8.3) → WP5 · 2회 ML 9.2·DA 8.2 → WP6 · **3회 8.85(ML 9.2·DA 8.6·Repl 8.4) — 3회 모두 미달로 종료**(DA 3회 지적은 WP7 로 고침, 그 뒤 재채점 없음) — docs/reviews/v0.9.18.md |
| 사용자 확인 | 미리 보기 판 뒤, 본판은 "메인 배포" 승인 후 |

참고: 5d9c899(색 토큰, 값 같음)는 전체 e2e 뒤 커밋이다. 그 커밋 뒤에 typecheck·uxui.spec(20)·감사 게이트를 다시 돌렸다.

## 주요 반영 (D-082, SPEC = docs/mockups/records/SPEC.md v14)
- 기록 → 요약: 기간 카드 → 훈련 부하 카드(새) → 회복 카드 → 기간 내역(새, 요약 탭 "최근 운동" 3개 대체)
- 기간 카드: [주|월|년|전체], 그래프 보기 [누적|막대|막대+누적](처음 막대+누적, 마지막 보기 기억), 큰 숫자 + 이름 줄, 남은 양 줄("지난주 전체까지 N 남았어요"), 일부 기록 기간은 같은 구간끼리 비교, 기록 전 기간은 ▲▼ 없음, 기간 이름 "○월 ○일부터 한 주"
- 막대+누적: 지난 기간 넓은 회색 막대(뒤) + 이번 좁은 파랑 막대(앞) + 두 누적선, 막대·선 높이 기준 따로, 눈금 없음, 칸 고르면 "11월 16일 (월) · 작업 세트 22세트 · 누적 22세트 · 지난주 같은 요일 15세트"
- 훈련 부하: 최근 7일 ÷ 4주 평균(4주 미만은 첫 기록일부터 달력 날 수), 21일째부터, 구간 0.8·1.3·1.5, 지난주 같은 요일 비교, 7일 점 그래프
- 시간 비교는 D-081 보이는 값 규칙 그대로(방향·차이·남은 양 같은 쌍) — DECISIONS 2026-11-20 D-082 행
- SPEC→코드 추적(`G:/내 드라이브/WORK_OUT_APP/docs/reviews/v0.9.18-spec-trace.md`, 한 가지 라벨 규칙, b94d8f7·2af721a 기준 — WP7 의 #12/#13 우선순위·각주·'기록 전' 은 DECISIONS 행에만 있고 추적표 줄 번호는 갱신 안 함): 61항목 중 구현됨 51 · 다르게 구현 10(모두 DECISIONS 근거) · 근거 없는 차이 0 · 빠짐 0 (처음 23bde8d 때 56·5·0 은 라벨 규칙이 달랐음)


참고(커버리지 표): 텍스트 표는 100% 인 파일을 생략한다. period.ts·periodPref.ts·loadText.ts 의 100% 는 그때의 reports/coverage/coverage-summary.json(커밋 안 됨, HEAD 표시 없음)에서 읽은 값이다(INFERRED 수준).
