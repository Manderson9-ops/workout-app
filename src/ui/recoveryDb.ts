/** D-057 회복 규칙 데이터 (기록 탭·회복 화면만 씀: 첫 화면 묶음에 안 들어감). 논문 목록은 회복 화면 묶음(screens/Recovery.tsx)에만 */
import rulesFile from '../../data/recovery_rules.json';
import type { Rule } from '../core/recoveryData';

export const RULES = rulesFile.rules as Rule[];
export const ruleById = (id: string): Rule | undefined => RULES.find((r) => r.id === id);
