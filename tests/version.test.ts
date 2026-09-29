import { describe, expect, it } from 'vitest';
import { gradeAtLeast } from '../src/core/version';

describe('gradeAtLeast', () => {
  it('S는 A- 이상', () => expect(gradeAtLeast('S', 'A-')).toBe(true));
  it('B는 A- 미만', () => expect(gradeAtLeast('B', 'A-')).toBe(false));
  it('같은 등급은 이상', () => expect(gradeAtLeast('A-', 'A-')).toBe(true));
});
