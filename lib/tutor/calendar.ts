const CALENDAR_QUESTION_ZH =
  /^(?:请问[，,\s]*)?(今天|明天|昨天)(?:到底)?(?:是|(?:的)?日期(?:是)?)?(?:公历|阳历)?(几号|几日|几月几号|几月几日|几月|哪一天|哪天|什么日期|星期几|周几|礼拜几|几月几日星期几|几月几号星期几|几月几日周几|几月几号周几|哪一年)[呢吗呀]?[？?。!！]?$/u;
const CALENDAR_QUESTION_EN =
  /^(?:what(?:'s| is) (?:the |today's )?date(?: (today|tomorrow|yesterday))?|what (?:day|day of the week) (?:is|was) (?:it(?: (today|tomorrow|yesterday))?|(today|tomorrow|yesterday)))[?.!]?$/i;
const CHINESE_DAYS: Record<string, number> = { 昨天: -1, 今天: 0, 明天: 1 };
const ENGLISH_DAYS: Record<string, number> = { yesterday: -1, today: 0, tomorrow: 1 };

/** The instant comes from the server. The browser supplies only its time zone. */
export function tutorCalendar(now: Date, requestedTimeZone?: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      calendar: 'gregory',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      timeZone: requestedTimeZone,
    });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    formatter = new Intl.DateTimeFormat('en-CA', {
      calendar: 'gregory',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
  }
  const { timeZone } = formatter.resolvedOptions();
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  // From here on the date is a local calendar day. Move by calendar days,
  // irrespective of daylight-saving changes in the user's time zone.
  const calendarDay = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)),
  );
  const isoDate = calendarDay.toISOString().slice(0, 10);
  const systemContext = `当前公历日期由服务器时钟按用户时区计算：${isoDate}（${timeZone}）。解释“今天”“昨天”“明天”等相对日期时，以这个日期为准。`;

  function answer(question: string): string | undefined {
    const normalized = question.trim().replace(/\s+/g, ' ');
    const chinese = normalized.replace(/\s/g, '').match(CALENDAR_QUESTION_ZH);
    if (chinese) {
      const label = chinese[1];
      const date = shiftedDay(CHINESE_DAYS[label]);
      const value = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full', timeZone: 'UTC' }).format(
        date,
      );
      return `${label}是${value}。`;
    }
    const english = normalized.match(CALENDAR_QUESTION_EN);
    if (!english) return undefined;
    const label = (english[1] || english[2] || english[3] || 'today').toLowerCase();
    const date = shiftedDay(ENGLISH_DAYS[label]);
    const value = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' }).format(
      date,
    );
    return `${label[0].toUpperCase() + label.slice(1)} ${label === 'yesterday' ? 'was' : 'is'} ${value}.`;
  }

  function shiftedDay(offset: number) {
    const date = new Date(calendarDay);
    date.setUTCDate(date.getUTCDate() + offset);
    return date;
  }

  return { systemContext, answer };
}
