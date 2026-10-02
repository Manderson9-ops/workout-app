import { describe, expect, it } from 'vitest';
import { togglePart, setPartPriority } from '../src/core/planForm';
import type { PartsForm } from '../src/core/planForm';

describe('플랜 부위 고르기 (D-043)', () => {
  const empty: PartsForm = { parts: {}, order: [] };
  it('켜면 기본 높음, 고른 순서대로', () => {
    const f = togglePart(togglePart(empty, '가슴'), '삼두');
    expect(f.parts).toEqual({ 가슴: 'high', 삼두: 'high' });
    expect(f.order).toEqual(['가슴', '삼두']);
  });
  it('우선순위를 바꿔도 순서는 그대로 (예전 돌리기 방식은 맨 뒤로 보냈음)', () => {
    const f = setPartPriority(togglePart(togglePart(empty, '가슴'), '삼두'), '가슴', 'low');
    expect(f.parts.가슴).toBe('low');
    expect(f.order).toEqual(['가슴', '삼두']);
  });
  it('다시 누르면 빼기, 다시 켜면 높음으로 맨 뒤', () => {
    let f = togglePart(togglePart(empty, '가슴'), '삼두');
    f = setPartPriority(f, '가슴', 'normal');
    f = togglePart(f, '가슴');
    expect(f).toEqual({ parts: { 삼두: 'high' }, order: ['삼두'] });
    f = togglePart(f, '가슴');
    expect(f.order).toEqual(['삼두', '가슴']);
    expect(f.parts.가슴).toBe('high');
  });
  it('고르지 않은 부위의 우선순위는 바꾸지 않음, 다른 폼 값은 유지', () => {
    const f = { ...empty, minutes: 60 };
    expect(setPartPriority(f, '등', 'low')).toBe(f);
    expect(togglePart(f, '등').minutes).toBe(60);
  });
});
