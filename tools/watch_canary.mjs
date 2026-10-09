// D-058 애플워치 받기 연결 시험 (배포한 Apps Script 서버에 실제로 보냄)
// 실행: node tools/watch_canary.mjs [설정.txt 경로]
// - 설정.txt 의 "주소#키" 를 읽음. 키는 화면에 쓰지 않음 (끝 4자리만)
// - kind:"canary" 로 심박 3줄을 보냄 → 서버는 읽기만 하고 health 표에 'canary' 기록 하나만 씀 (실제 심박 기록에는 안 섞임, 앱 화면은 무시)
// - 앱과 같은 읽기 경로(op:sync, healthSince:0)로 다시 받아 canary 기록이 방금 시각인지 확인
// - 옛 앱 경로(healthSince 없음)에는 health 기록이 하나도 없어야 함 (호환 확인)
import { readFileSync } from 'node:fs';

async function main() {
  const path = process.argv[2] ?? 'G:/내 드라이브/WORK_OUT_APP/sync/설정.txt';
  let line;
  try { line = readFileSync(path, 'utf8').split(/\r?\n/).map((s) => s.trim()).find((s) => /^https?:\/\/\S+#\S+$/.test(s)); }
  catch { console.error(`설정 파일을 못 읽었어요: ${path}`); return 2; }
  if (!line) { console.error('설정 파일에 "주소#키" 줄이 없어요'); return 2; }
  const [url, key] = [line.slice(0, line.indexOf('#')), line.slice(line.indexOf('#') + 1)];
  console.log(`서버: ${url.replace(/\/s\/([\w-]{6})[\w-]+\//, '/s/$1…/')} · 키 ••••${key.slice(-4)}`);

  const post = async (body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, key }) });
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw new Error(`JSON 아닌 응답 (HTTP ${r.status}): ${text.slice(0, 120)}`); }
  };
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
  const t0 = Date.now();
  const ing = await post({ op: 'health', kind: 'canary', hr: [`${iso(60000)} | 61 count/min`, `${iso(30000)} | 62 count/min`, `2026. 10. 8. 오전 11:24 | 63 회/분`, '읽을 수 없는 줄'].join('\n') });
  console.log('보내기 응답:', JSON.stringify(ing));
  if (!ing.ok) { console.error(ing.error === 'bad_key' ? '키가 맞지 않아요' : ing.error === 'not_json' ? '서버가 아직 옛 코드예요 (D-058 배포 전)' : '보내기 실패'); return 1; }

  const full = await post({ op: 'sync', schema: 1, epoch: 0, since: 0, muts: [], healthSince: 0 });
  if (!full.ok) { console.error('받기 실패:', full.error); return 1; }
  const canary = (full.health ?? []).find((r) => r.id === 'canary');
  const at = canary?.data?.at ? Date.parse(canary.data.at) : 0;
  const fresh = at >= t0 - 5000 && at <= Date.now() + 5000;
  console.log(`받기: health ${full.health?.length ?? '없음'}건 · canary ${canary ? canary.data.at : '없음'} · received ${canary?.data?.received} · skipped ${canary?.data?.skipped}`);
  const old = await post({ op: 'sync', schema: 1, epoch: 0, since: 0, muts: [] });
  const leak = (old.changes ?? []).filter((c) => c.table === 'health').length + (old.health ? old.health.length : 0);
  console.log(`옛 앱 경로(healthSince 없음): health ${leak}건 ${leak ? '← 문제 (옛 앱이 멈출 수 있음)' : '(정상: 없음)'}`);
  const ok = fresh && leak === 0;
  console.log(ok ? '결과: 통과 (단축어 → 서버 → 앱 받기 경로 정상)' : '결과: 실패');
  return ok ? 0 : 1;

}
// process.exit 대신 exitCode: 열린 연결이 정리된 뒤 끝남 (Windows 비정상 종료 방지)
process.exitCode = await main();
