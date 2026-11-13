import { describe, expect, it } from 'vitest';
import { compareHomeworkFractions } from '@/lib/tutor/family';

describe('grading transcribed fraction comparisons', () => {
  it.each([
    ['4. 在方框里填上＞、＜或＝。3/4 □ 2/3', '>'],
    ['比较 1/3 和 2/6 的大小。', '='],
    ['比较 1/-4 和 2/3 的大小。', '<'],
    ['求 3/4 和 2/3 的差值，再比较大小。', null],
    ['比较 1/0 和 2/3 的大小。', null],
    ['比较 1/2、2/3 和 3/4 的大小。', null],
  ])('grades only a plain comparison %s', (problem, answer) => {
    expect(compareHomeworkFractions(problem)).toBe(answer);
  });
});
