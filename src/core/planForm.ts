/**
 * 플랜 만들기의 부위 고르기 (D-043). 화면과 따로 시험할 수 있게 순수 함수로.
 * 켜면 우선순위 '높음'으로 맨 뒤에, 끄면 빠짐. 우선순위를 바꿔도 고른 순서(같은 우선순위끼리의 앞뒤)는 그대로.
 */
import type { Part, Equipment } from './types';
import { EQUIPMENT } from './types';
import type { Priority } from './planner';

export interface PartsForm { parts: Partial<Record<Part, Priority>>; order: Part[] }

export type EquipmentPreset = 'all' | 'free_weight' | 'cable' | 'bodyweight';

export interface EquipmentPresetOption {
  id: EquipmentPreset;
  label: string;
  desc: string;
  equip: readonly Equipment[];
}

export const EQUIPMENT_PRESETS: EquipmentPresetOption[] = [
  { id: 'all', label: '기구 전체', desc: '머신·케이블·프리웨이트 등 모든 기구를 활용해요', equip: EQUIPMENT },
  { id: 'bodyweight', label: '맨몸', desc: '기구 없이 맨몸 운동만으로 플랜을 짜요', equip: ['bodyweight', 'other'] },
  { id: 'cable', label: '케이블', desc: '케이블 머신 중심의 고립 운동 플랜을 짜요', equip: ['cable', 'bodyweight', 'other'] },
  { id: 'free_weight', label: '덤벨+바벨', desc: '덤벨·바벨 중심 프리웨이트 플랜을 짜요', equip: ['dumbbell', 'barbell', 'bodyweight', 'other'] },
];

export function resolveEquipmentForPreset(preset: EquipmentPreset, userEquipment?: readonly Equipment[]): Equipment[] {
  const base = userEquipment && userEquipment.length > 0 ? userEquipment : EQUIPMENT;
  switch (preset) {
    case 'bodyweight':
      return ['bodyweight', 'other'];
    case 'cable':
      return ['cable', 'bodyweight', 'other'];
    case 'free_weight':
      return ['dumbbell', 'barbell', 'bodyweight', 'other'];
    case 'all':
    default:
      return [...base];
  }
}

export function togglePart<F extends PartsForm>(f: F, p: Part): F {
  const parts = { ...f.parts };
  if (parts[p]) { delete parts[p]; return { ...f, parts, order: f.order.filter((x) => x !== p) }; }
  parts[p] = 'high';
  return { ...f, parts, order: [...f.order.filter((x) => x !== p), p] };
}

export function setPartPriority<F extends PartsForm>(f: F, p: Part, pr: Priority): F {
  if (!f.parts[p]) return f;
  return { ...f, parts: { ...f.parts, [p]: pr } };
}
