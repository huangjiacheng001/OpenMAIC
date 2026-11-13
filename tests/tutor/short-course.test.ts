import { describe, expect, it } from 'vitest';
import type { HomeworkExchange } from '@/lib/tutor/family';
import { canMakeShortCourse, shortCourseContext } from '@/lib/tutor/short-course';

function turn(id: string, question: string, overrides: Partial<HomeworkExchange> = {}) {
  return { id, question, answer: '具体解释', sources: [], ...overrides };
}

describe('courses from tutoring conversations', () => {
  it('uses related questions up to the next topic', () => {
    const original = turn('a', '为什么一年有四季？');
    const followUp = turn('b', '那南半球为什么相反？');
    const date = turn('c', '今天是几号？');
    const newTopic = turn('d', '为什么金属会生锈？');
    expect(shortCourseContext([original, followUp, date, newTopic], 'a')).toEqual({
      title: original.question,
      turns: [{ question: original.question }, { question: followUp.question }],
    });
    expect(shortCourseContext([original, followUp, date, newTopic], 'b')?.turns).toEqual([
      { question: original.question },
      { question: followUp.question },
    ]);
    expect(shortCourseContext([original, followUp, date, newTopic], 'c')).toBeNull();
  });

  it('accepts a recognized photographed problem and skips requests for a clearer photo', () => {
    const pending = turn('a', '看看这张图', { answer: '看不清，请重拍。' });
    expect(canMakeShortCourse(pending)).toBe(false);
    const recognized = turn('b', '看看这张图', { problem: '一杯水喝掉三分之一，还剩多少？' });
    expect(shortCourseContext([recognized], 'b')?.turns[0]).toEqual({
      question: recognized.question,
      problem: recognized.problem,
    });
  });
});
