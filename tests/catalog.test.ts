import { describe, it, expect } from 'vitest';
import wkFile from '../data/exercises.workout_k.json';
import { catalog, ensureFullCatalog, isFullCatalog } from '../src/ui/catalog';

/** 0.9.3 성능 관문: 첫 화면은 가벼운 목록(자세 포인트 없음), 다른 화면은 ensureFullCatalog() 뒤 전체 목록. 둘의 뼈대는 같아야 함 */
describe('가벼운 운동 목록 vs 전체 목록', () => {
  it('이름·부위·장비·종류·등급·순서가 같고, 자세 포인트만 전체 목록에 있음', async () => {
    expect(isFullCatalog()).toBe(false);
    const light = catalog([]).map((e) => ({ ...e }));
    expect(light.every((e) => e.guide.length === 0)).toBe(true);
    await ensureFullCatalog();
    expect(isFullCatalog()).toBe(true);
    const full = catalog([]);
    expect(full).not.toBe(light);
    const skel = (xs: typeof full) => xs.map(({ guide: _g, ...rest }) => rest);
    expect(skel(full)).toEqual(skel(light));
    expect(full.map((e) => [e.id, e.name_ko, e.part])).toEqual(light.map((e) => [e.id, e.name_ko, e.part]));
    // 자세 포인트는 원본 데이터와 똑같이
    const guides = (wkFile as unknown as { guides: Record<string, unknown[]> }).guides;
    let n = 0;
    for (const e of full) { expect(e.guide).toEqual(guides[e.id] ?? []); n += e.guide.length; }
    expect(n).toBeGreaterThan(100);
    // 사용자 운동이 바뀌면 다시 만들고, 전체 목록 위에 붙음
    const withCustom = catalog([{ id: 'c1', name_ko: '내 운동', part: '등', mechanics: 'compound', equipment: ['machine'], muscles: [] } as never]);
    expect(withCustom.length).toBe(full.length + 1);
    expect(withCustom.at(-1)!.guide).toEqual([]);
    // 두 번 불러도 한 번만
    await ensureFullCatalog();
    expect(catalog([]).length).toBe(full.length);
  });
});
