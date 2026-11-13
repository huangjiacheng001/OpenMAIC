import { describe, expect, it } from 'vitest';
import { tutorCalendar } from '@/lib/tutor/calendar';

describe('family tutor calendar', () => {
  const now = new Date('2026-11-13T02:15:00Z');

  it('returns the local date and weekday around UTC midnight', () => {
    const california = tutorCalendar(now, 'America/Los_Angeles');
    expect(california.answer('请问，今天几月几日？')).toBe('今天是2026年11月12日星期四。');
    expect(california.answer('今天星期几？')).toBe('今天是2026年11月12日星期四。');
    expect(california.systemContext).toContain('2026-11-12（America/Los_Angeles）');

    const china = tutorCalendar(now, 'Asia/Shanghai');
    expect(china.answer('今天是几号？')).toBe('今天是2026年11月13日星期五。');
    expect(china.answer("What's the date today?")).toBe('Today is Friday, November 13, 2026.');
  });

  it('uses calendar days across DST and year boundaries', () => {
    const beforeDst = tutorCalendar(new Date('2026-03-08T07:30:00Z'), 'America/Los_Angeles');
    expect(beforeDst.answer('明天周几？')).toBe('明天是2026年3月8日星期日。');
    const newYear = tutorCalendar(new Date('2027-01-01T00:01:00Z'), 'UTC');
    expect(newYear.answer('昨天几月几号？')).toBe('昨天是2026年12月31日星期四。');
    expect(newYear.answer('What day was yesterday?')).toBe(
      'Yesterday was Thursday, December 31, 2026.',
    );
  });

  it('falls back for invalid time zones and leaves broader questions to the tutor', () => {
    const calendar = tutorCalendar(now, 'fake/instructions');
    expect(calendar.answer('今天是几号？')).toBe(tutorCalendar(now).answer('今天是几号？'));
    expect(calendar.systemContext).not.toContain('fake/instructions');
    expect(calendar.answer('如果今天是11月27日，明天是几号？')).toBeUndefined();
    expect(calendar.answer('今天几号？今天有什么新闻？')).toBeUndefined();
    expect(calendar.answer('农历今天几号？')).toBeUndefined();
  });
});
