'use client';

import Link from 'next/link';
import { BookOpen, ArrowRight } from 'lucide-react';
import type { ShortCourse } from '@/lib/tutor/short-course';
import styles from './family-workspace.module.css';

export function ShortCourseCard({
  course,
  busy,
  error,
  onStart,
  onRetry,
}: {
  course?: ShortCourse;
  busy: boolean;
  error?: string;
  onStart: () => void;
  onRetry: () => void;
}) {
  const canOpen = course && course.stageId && course.ready > 0 && course.state !== 'ended';
  const paused = course?.state === 'paused';
  const done = course?.state === 'completed';
  return (
    <section className={styles.card} aria-label="从这条问答生成课程">
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
                : canOpen
                  ? '第一节已就绪，后续内容继续生成。'
                  : '正在准备第一节，你可以继续聊。'}
            {course.total > 0 ? ' · ' + course.ready + '/' + course.total + ' 节已就绪' : ''}
          </p>
          <div className={styles.actions}>
            {canOpen && (
              <Link
                href={'/classroom/' + encodeURIComponent(course.stageId!)}
                className={styles.button}
              >
                {done ? '进入课堂' : '先学第一节'} <ArrowRight size={16} />
              </Link>
            )}
            {paused && (
              <button type="button" className={styles.secondary} disabled={busy} onClick={onRetry}>
                重试生成
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className={styles.muted}>围绕这个问题讲一个概念，动手试一次，再做一道检查题。</p>
          <button type="button" className={styles.button} disabled={busy} onClick={onStart}>
            {busy ? '正在创建短课…' : '生成短课'}
          </button>
        </>
      )}
    </section>
  );
}
