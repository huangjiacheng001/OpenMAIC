'use client';

import { useEffect, useRef, useState } from 'react';
import { CardSection } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { BookOpen, ArrowRight } from 'lucide-react';
import type { ShortCourse, ShortCourseExplanation as Explanation } from '@/lib/tutor/short-course';
import { ShortCourseExplanation } from './short-course-explanation';
import styles from './family-workspace.module.css';

export function ShortCourseCard({
  course,
  busy,
  error,
  getExplanation,
  onStart,
  onRetry,
}: {
  course?: ShortCourse;
  busy: boolean;
  error?: string;
  getExplanation: () => Explanation | undefined;
  onStart: () => void;
  onRetry: () => void;
}) {
  const [explanation, setExplanation] = useState<Explanation>();
  const preview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (explanation) preview.current?.scrollIntoView({ block: 'start' });
  }, [explanation]);
  const canOpen = course && course.stageId && course.ready > 0 && course.state !== 'ended';
  const paused = course?.state === 'paused';
  const done = course?.state === 'completed';
  const href = course?.stageId ? '/classroom/' + encodeURIComponent(course.stageId) : '';
  return (
    <CardSection aria-label="从这条问答生成课程">
      <div className={styles.statusLine}>
        <h2 className="flex items-center gap-2">
          <BookOpen size={17} />
          {course?.title || '用这道问题学一节短课'}
        </h2>
      </div>
      {error && (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      )}
      {course && course.state !== 'ended' ? (
        <>
          <p className={styles.muted} role="status">
            {paused
              ? canOpen
                ? '后续内容生成暂停，已就绪的部分可以学。'
                : '生成暂停，可以从中断处重试。'
              : done
                ? '短课已就绪'
                : course.quizSceneId && !course.interactiveSceneId
                  ? '测验已就绪，互动还在生成。'
                  : course.interactiveSceneId && !course.quizSceneId
                    ? '互动已就绪，测验还在生成。'
                    : canOpen
                      ? '导读已就绪，课堂内容继续生成。'
                      : explanation
                        ? '课堂内容正在后台生成。'
                        : '正在准备课堂，你可以继续聊。'}
            {course.total > 0 ? ' · ' + course.ready + '/' + course.total + ' 节已就绪' : ''}
          </p>
          <div className={styles.actions}>
            {canOpen && (
              <Button asChild size="touch">
                <Link href={href}>
                  {done ? '进入课堂' : '打开课堂'} <ArrowRight size={16} />
                </Link>
              </Button>
            )}
            {canOpen && course.quizSceneId && (
              <Button asChild size="touch" variant={done ? 'outline' : 'default'}>
                <Link href={href + '?scene=' + encodeURIComponent(course.quizSceneId)}>
                  {course.interactiveSceneId ? '做测验' : '先做测验'}
                </Link>
              </Button>
            )}
            {canOpen && course.lessonSceneId && (
              <Button asChild size="touch" variant="outline">
                <Link href={href + '?scene=' + encodeURIComponent(course.lessonSceneId)}>
                  看正式讲解
                </Link>
              </Button>
            )}
            {canOpen && course.interactiveSceneId && (
              <Button asChild size="touch" variant="outline">
                <Link href={href + '?scene=' + encodeURIComponent(course.interactiveSceneId)}>
                  做互动
                </Link>
              </Button>
            )}
            {paused && (
              <Button
                type="button"
                size="touch"
                variant="outline"
                disabled={busy}
                onClick={onRetry}
              >
                重试生成
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className={styles.muted}>
            {explanation && busy ? '正在准备课堂。' : '按问题和追问分节讲解，再动手练习和测验。'}
          </p>
          <Button
            type="button"
            size="touch"
            disabled={busy}
            onClick={() => {
              setExplanation(getExplanation());
              onStart();
            }}
          >
            {busy ? '正在创建短课…' : error ? '重试生成' : '生成短课'}
          </Button>
        </>
      )}
      {explanation && (
        <div ref={preview} className="scroll-mt-2">
          <ShortCourseExplanation explanation={explanation} />
        </div>
      )}
    </CardSection>
  );
}
