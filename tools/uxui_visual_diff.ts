/**
 * D-079 2차: 화면이 "실제로" 얼마나 바뀌었나 — 이전 스크린샷 폴더와 지금 폴더(reports/screens)의 같은 이름 PNG 를
 * 픽셀 비교한다. 규칙 통과(감사 PASS)와 별개로 사용자 눈에 보이는 변화량을 숫자로 남긴다.
 *   node tools/uxui_visual_diff.ts <이전 폴더> [지금 폴더=reports/screens] [--min 0.05]
 * 출력: 화면별 바뀐 픽셀 비율·높이 변화, --min 보다 적게 바뀐 화면 수. 비교는 Playwright Chromium 캔버스(새 의존성 없음).
 */
import { chromium } from 'playwright';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const minAt = args.indexOf('--min');
const MIN = minAt >= 0 ? Number(args[minAt + 1]) : 0.05;
const pos = args.filter((a, i) => !a.startsWith('--') && (minAt < 0 || i !== minAt + 1));
const [before, after = 'reports/screens'] = pos;
if (!before || !existsSync(before)) { console.error('사용법: node tools/uxui_visual_diff.ts <이전 폴더> [지금 폴더] [--min 0.05]'); process.exit(2); }

const names = readdirSync(before).filter((f) => f.includes('uxui') && f.endsWith('.png') && existsSync(join(after, f))).sort();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id="a"></canvas><canvas id="b"></canvas>');
const rows: { name: string; changed: number; h0: number; h1: number }[] = [];
for (const name of names) {
  const a = readFileSync(join(before, name)).toString('base64');
  const b = readFileSync(join(after, name)).toString('base64');
  rows.push({ name, ...(await page.evaluate(async ([a, b]) => {
    const load = (s: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:image/png;base64,${s}`; });
    const [ia, ib] = await Promise.all([load(a!), load(b!)]);
    // 같은 너비로 놓고 겹치는 높이만 픽셀 비교, 넘치는 높이는 모두 "바뀜"으로 셈
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height), H = Math.max(ia.height, ib.height);
    const px = (img: HTMLImageElement) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = px(ia), db = px(ib);
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i]! - db[i]!) + Math.abs(da[i + 1]! - db[i + 1]!) + Math.abs(da[i + 2]! - db[i + 2]!) > 24) diff++;
    return { changed: (diff + (H - h) * w) / (w * H), h0: ia.height, h1: ib.height };
  }, [a, b])) });
}
await browser.close();
for (const r of rows) console.log(`${(r.changed * 100).toFixed(1).padStart(5)}%  높이 ${r.h0}→${r.h1}  ${r.name}`);
const low = rows.filter((r) => r.changed < MIN);
console.log(`화면 ${rows.length}개 · 평균 변화 ${(rows.reduce((s, r) => s + r.changed, 0) / Math.max(1, rows.length) * 100).toFixed(1)}% · ${MIN * 100}% 미만 ${low.length}개`);
