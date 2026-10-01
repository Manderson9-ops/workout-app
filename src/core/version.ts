export const APP_VERSION = '0.8.2-preview';

/** 등급 순서 (높을수록 앞). BLUEPRINT 3.2 */
export const GRADES = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'] as const;
export type Grade = (typeof GRADES)[number];

/** a가 b 이상이면 true */
export function gradeAtLeast(a: Grade, b: Grade): boolean {
  return GRADES.indexOf(a) <= GRADES.indexOf(b);
}
