import type { TutorSource } from './protocol';

export type ChildProfile = { id: string; name: string; grade: string };
export type FamilySession = {
  child: ChildProfile | null;
  guardian: boolean;
  needsSetup: boolean;
};
export type HomeworkExchange = {
  id: string;
  question: string;
  answer: string;
  problem?: string;
  sources: TutorSource[];
};
export type StudyThread = { id: string; title: string; updatedAt: string };
export type ReviewSummary = {
  id: string;
  problem: string;
  threadId: string | null;
  savedAt: string;
  completedAt: string | null;
  attempts: number;
};
export type ReviewAttempt = {
  id: string;
  answer: string;
  outcome: 'correct' | 'incorrect' | 'self_correct' | 'self_retry';
  submittedAt: string;
};
export type ReviewItem = ReviewSummary & {
  photo: string | null;
  explanation: string | null;
  checkable: boolean;
  attemptsList: ReviewAttempt[];
};

const digit = '(-?\\d{1,9})';
const fraction = digit + '\\s*[/／]\\s*' + digit;
const comparison = new RegExp(
  fraction + '\\s*(?:和|与|、|及|以及|对比|(?:□|☐|\\(\\s*\\)|（\\s*）|_{2,}))\\s*' + fraction,
);
const fractionMatch = new RegExp(fraction, 'g');

export function compareHomeworkFractions(problem: string): '<' | '=' | '>' | null {
  if (!/比(?:较|大小)|大小|[<>＜＞]/.test(problem)) return null;
  const fractions = [...problem.matchAll(fractionMatch)];
  const match = problem.match(comparison);
  if (!match || fractions.length !== 2 || /绝对值|差值|倒数|相反数|乘积/.test(problem)) return null;
  // Only opt into automatic marking for a plain comparison of exactly two fractions.
  const remaining = problem
    .replace(match[0], '')
    .replace(/^\s*\d{1,3}\s*[.．、)）]/u, '')
    .replace(
      /(?:第\s*\d+\s*题|在(?:下列|下面)?方框(?:里|中)?填上|在[□☐]里填上|比(?:较|大小)|的?大小|填(?:写|入)?|或|和|与|两个分数|分数|[\s\p{P}<>＜＞＝=□☐])/gu,
      '',
    );
  if (remaining) return null;
  const [a, b, c, d] = match.slice(1).map(BigInt);
  if (!b || !d) return null;
  const zero = BigInt(0);
  const delta = b * d < zero ? c * b - a * d : a * d - c * b;
  return delta > zero ? '>' : delta < zero ? '<' : '=';
}

export const familyTime = (time: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(time));
