import { FamilyError } from './family-client';
import type { ShortCourse } from '@/lib/tutor/short-course';
import type { HomeworkExchange } from '@/lib/tutor/family';

export async function shortCourseRequest<T>(query: Record<string, string>, init?: RequestInit) {
  const result = await fetch('/api/tutor/courses?' + new URLSearchParams(query), {
    cache: 'no-store',
    ...init,
  });
  const data = await result.json().catch(() => null);
  if (!result.ok || !data) throw new FamilyError(data?.code ?? 'unavailable');
  return data as T;
}

export const readShortCourses = (thread: string, signal?: AbortSignal, restore = false) =>
  shortCourseRequest<{ courses: ShortCourse[]; exchanges?: HomeworkExchange[] }>(
    restore ? { thread, restore: '1' } : { thread },
    { signal },
  );

export const prepareShortCourse = (thread: string) => shortCourseRequest({ thread, prepare: '1' });

export function writeShortCourse(fields: Record<string, unknown>) {
  return shortCourseRequest<{ course: ShortCourse }>(
    {},
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    },
  );
}

const errors: Record<string, string> = {
  busy: '目前有课程在生成，请稍后重试。',
  topic_missing: '先确认题目，再生成短课。',
  course_model: '课程模型暂时不可用，请在课堂的模型设置里检查。',
  session_changed: '孩子档案已切换，请重新打开问答。',
};
export function shortCourseError(error: unknown) {
  return error instanceof FamilyError && errors[error.code]
    ? errors[error.code]
    : '暂时无法连接课程生成，请稍后重试。';
}

export function shortCourseIsActive(course: ShortCourse) {
  return !['completed', 'paused', 'ended'].includes(course.state);
}
