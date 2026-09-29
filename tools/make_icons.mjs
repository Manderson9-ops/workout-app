import { chromium } from '@playwright/test';
// 앱 아이콘 만들기 (파란 바탕 + 흰 바벨). 실행: node tools/make_icons.mjs
const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">
<rect width="100" height="100" fill="#1d4ed8"/>
<rect x="14" y="46" width="72" height="8" rx="3" fill="#fff"/>
<rect x="20" y="30" width="10" height="40" rx="3" fill="#fff"/><rect x="70" y="30" width="10" height="40" rx="3" fill="#fff"/>
<rect x="31" y="36" width="7" height="28" rx="2" fill="#dbeafe"/><rect x="62" y="36" width="7" height="28" rx="2" fill="#dbeafe"/>
<text x="50" y="92" font-family="Arial" font-weight="700" font-size="11" fill="#dbeafe" text-anchor="middle">WORKOUT</text></svg>`;
const b = await chromium.launch();
const p = await b.newPage();
for (const s of [180, 192, 512]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<html><body style="margin:0">${svg(s)}</body></html>`);
  await p.screenshot({ path: `public/icons/icon-${s}.png`, omitBackground: false });
}
await b.close();
console.log('icons done');
