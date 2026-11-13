export const GROUP_SIZES = [2, 5, 10] as const;
export type GroupSize = (typeof GROUP_SIZES)[number];

export type GroupExercise = {
  groupSize: GroupSize;
  groupCount: number;
};

export type PracticeAttempt = {
  id: string;
  exercise: GroupExercise;
  answer: number;
  submittedAt: number;
};

export function exerciseTotal(exercise: GroupExercise) {
  return exercise.groupSize * exercise.groupCount;
}

export function isCorrectAttempt(attempt: PracticeAttempt) {
  return attempt.answer === exerciseTotal(attempt.exercise);
}

export function parseGroupAnswer(input: string): number | undefined {
  const value = input.normalize('NFKC').trim();
  return /^\d{1,3}$/.test(value) ? Number(value) : undefined;
}

export function parsePracticeAttempt(raw: string): PracticeAttempt | undefined {
  try {
    const { id, exercise, answer, submittedAt } = JSON.parse(raw);
    if (
      typeof id !== 'string' ||
      !exercise ||
      !GROUP_SIZES.includes(exercise.groupSize) ||
      !Number.isInteger(exercise.groupCount) ||
      exercise.groupCount < 2 ||
      exercise.groupCount > 6 ||
      !Number.isInteger(answer) ||
      answer < 0 ||
      answer > 999 ||
      !Number.isSafeInteger(submittedAt) ||
      submittedAt < 0
    )
      return undefined;
    return { id, exercise, answer, submittedAt };
  } catch {
    return undefined;
  }
}

export function pendingReviews(attempts: readonly PracticeAttempt[]): PracticeAttempt[] {
  const latest = new Map<string, PracticeAttempt>();
  for (const attempt of attempts) {
    const { groupSize, groupCount } = attempt.exercise;
    const key = `${groupSize}:${groupCount}`;
    const previous = latest.get(key);
    if (!previous || attempt.submittedAt >= previous.submittedAt) latest.set(key, attempt);
  }
  return [...latest.values()]
    .filter((attempt) => !isCorrectAttempt(attempt))
    .sort((left, right) => right.submittedAt - left.submittedAt);
}
