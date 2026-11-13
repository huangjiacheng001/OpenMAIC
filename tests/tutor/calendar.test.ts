import { describe, expect, it } from 'vitest';
import { tutorCalendar } from '@/lib/tutor/calendar';

describe('family tutor calendar', () => {
  it('uses Beijing time when Beijing and California have different dates', () => {
    const calendar = tutorCalendar(new Date('2026-11-13T02:15:00Z'));
    expect(calendar.answer('请问，今天几月几日？')).toBe(
      '今天是2026年11月13日星期五（北京时间）。',
    );
    expect(calendar.answer('今天星期几？')).toBe('今天是2026年11月13日星期五（北京时间）。');
    expect(calendar.systemContext).toContain('2026-11-13（Asia/Shanghai）');
    expect(calendar.answer("What's the date today?")).toBe(
      'Today is Friday, November 13, 2026 (Beijing time).',
    );
  });

  it('moves by Beijing calendar days across midnight and a new year', () => {
    const beforeMidnight = tutorCalendar(new Date('2026-12-31T15:59:59Z'));
    const afterMidnight = tutorCalendar(new Date('2026-12-31T16:00:00Z'));
    expect(beforeMidnight.answer('明天周几？')).toBe('明天是2027年1月1日星期五（北京时间）。');
    expect(afterMidnight.answer('昨天几月几号？')).toBe('昨天是2026年12月31日星期四（北京时间）。');
    expect(afterMidnight.answer('What day was yesterday?')).toBe(
      'Yesterday was Thursday, December 31, 2026 (Beijing time).',
    );
  });

  it('leaves broader questions and explicitly named calendars or time zones to the tutor', () => {
    const calendar = tutorCalendar(new Date('2026-11-13T02:15:00Z'));
    expect(calendar.answer('如果今天是11月27日，明天是几号？')).toBeUndefined();
    expect(calendar.answer('今天几号？今天有什么新闻？')).toBeUndefined();
    expect(calendar.answer('农历今天几号？')).toBeUndefined();
    expect(calendar.answer('纽约今天几号？')).toBeUndefined();
  });
});
