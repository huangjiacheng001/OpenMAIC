import type { HomeworkExchange } from './family';

export type ShortCourseExplanation = {
  title: string;
  grade?: string;
  sections: Array<{ question: string; answer: string }>;
};

export type ShortCourse = {
  id: string;
  exchangeId: string;
  title: string;
  state:
    | 'preparing'
    | 'outlining'
    | 'awaiting_outline_confirmation'
    | 'generating'
    | 'paused'
    | 'completed'
    | 'ended';
  stageId: string | null;
  ready: number;
  total: number;
  quizSceneId?: string;
  interactiveSceneId?: string;
};

const teachingQuestion =
  /为什么|为何|原理|区别|怎么|如何|比较|解释|讲讲|举例|推导|看不懂|不明白|不理解|怎么做|why\b|how\b|explain\b|difference\b/i;
const quickQuestion =
  /^(?:请问[，, ]*)?(?:今天(?:是|星期|周|几)|明天(?:是|星期|周|几)|现在几点|你是谁|你好|谢谢|再见|[\d一二三四五六七八九十]+\s*(?:小时|分钟|米|厘米|千米|公斤|克)\s*(?:等于|有|是)?\s*多少)/;
const contextQuestion =
  /^(?:那|所以|如果|还有|上面|这(?:个|里|里头|道题|一步|样|句话)|它|再|可以举|能举|比如|呢|what about|and |so )/i;
const unclearPhoto = /看不清|重拍|补拍|哪一道题|哪一题|第几题/;

export function canMakeShortCourse(exchange: HomeworkExchange): boolean {
  const text = (exchange.problem || exchange.question).trim();
  return Boolean(
    text &&
    exchange.answer.trim() &&
    !quickQuestion.test(text) &&
    !(!exchange.problem && unclearPhoto.test(exchange.answer)) &&
    (exchange.problem || teachingQuestion.test(text)),
  );
}

function terms(text: string) {
  const normalized = text
    .toLowerCase()
    .replace(/为什么|怎么|如何|这个|什么|是不是|能不能|请问|一下|一道/g, ' ');
  const words = normalized.match(/[a-z]{3,}|[\p{Script=Han}]+/gu) ?? [];
  return new Set(
    words.flatMap((word) =>
      /^[a-z]/.test(word)
        ? [word]
        : Array.from({ length: Math.max(0, word.length - 1) }, (_, index) =>
            word.slice(index, index + 2),
          ),
    ),
  );
}

function related(first: string, second: string) {
  const a = terms(first),
    b = terms(second);
  let common = 0;
  for (const item of a) if (b.has(item)) common++;
  return common >= 2;
}

export function shortCourseContext(exchanges: readonly HomeworkExchange[], exchangeId: string) {
  const index = exchanges.findIndex((exchange) => exchange.id === exchangeId);
  if (index < 0) return null;
  const selected = exchanges[index];
  if (!canMakeShortCourse(selected)) return null;
  const questionOf = (exchange: HomeworkExchange) => (exchange.problem || exchange.question).trim();
  const included = [selected];
  for (let i = index - 1; i >= 0 && included.length < 4; i--) {
    const previous = exchanges[i];
    const next = included[0];
    const question = questionOf(previous);
    if (!question || quickQuestion.test(question)) break;
    if (
      !related(questionOf(next), question) &&
      (next.problem || !contextQuestion.test(next.question.trim()))
    )
      break;
    included.unshift(previous);
  }
  for (let i = index + 1; i < exchanges.length && included.length < 5; i++) {
    const next = exchanges[i];
    const question = questionOf(next);
    if (
      !question ||
      quickQuestion.test(question) ||
      (!related(questionOf(selected), question) &&
        (next.problem || !contextQuestion.test(next.question.trim())))
    )
      break;
    included.push(next);
  }
  return {
    title: questionOf(selected).slice(0, 80),
    turns: included.map(({ question, problem }) => ({
      question: question.trim().slice(0, 1200),
      ...(problem ? { problem: problem.slice(0, 1200) } : {}),
    })),
    explanation: {
      title: questionOf(selected).slice(0, 80),
      sections: included
        .filter((exchange) => exchange.answer.trim())
        .map((exchange) => ({
          question: questionOf(exchange).slice(0, 4000),
          answer: exchange.answer.trim().slice(0, 12000),
        })),
    } satisfies ShortCourseExplanation,
  };
}
