import { describe, expect, it } from 'vitest';
import { togglePart, setPartPriority, resolveEquipmentForPreset, EQUIPMENT_PRESETS } from '../src/core/planForm';
import type { PartsForm } from '../src/core/planForm';
import { EQUIPMENT } from '../src/core/types';

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

describe('플랜 장비 프리셋 선택 (D-076)', () => {
  it('4가지 선택 값(기구 전체, 맨몸, 케이블, 덤벨+바벨)이 정의되어 있음', () => {
    expect(EQUIPMENT_PRESETS.map((p) => p.label)).toEqual(['기구 전체', '맨몸', '케이블', '덤벨+바벨']);
  });

  it('기구 전체: 사용자 설정 또는 전체 장비 반환', () => {
    expect(resolveEquipmentForPreset('all')).toEqual([...EQUIPMENT]);
    expect(resolveEquipmentForPreset('all', ['machine', 'cable'])).toEqual(['machine', 'cable']);
  });

  it('맨몸: 오직 맨몸과 기타만 반환', () => {
    expect(resolveEquipmentForPreset('bodyweight')).toEqual(['bodyweight', 'other']);
  });

  it('케이블: 케이블과 맨몸/기타 반환', () => {
    expect(resolveEquipmentForPreset('cable')).toEqual(['cable', 'bodyweight', 'other']);
  });

  it('덤벨+바벨: 덤벨, 바벨과 맨몸/기타 반환', () => {
    expect(resolveEquipmentForPreset('free_weight')).toEqual(['dumbbell', 'barbell', 'bodyweight', 'other']);
  });
});
