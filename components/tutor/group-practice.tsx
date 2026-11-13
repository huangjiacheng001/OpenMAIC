'use client';

import Link from 'next/link';
import { ArrowLeft, BookOpen, CircleHelp } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  GROUP_SIZES,
  exerciseTotal,
  isCorrectAttempt,
  parseGroupAnswer,
  parsePracticeAttempt,
  pendingReviews,
  type GroupExercise,
  type PracticeAttempt,
} from '@/lib/tutor/practice';
import styles from './family-tutor.module.css';

const ATTEMPT_PREFIX = 'openmaic.practice.groups.v1.';
const INITIAL_EXERCISE: GroupExercise = { groupSize: 5, groupCount: 3 };
const MAX_STORED_ATTEMPTS = 150;

function readAttempts(): PracticeAttempt[] {
  const entries: PracticeAttempt[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(ATTEMPT_PREFIX)) continue;
    const attempt = parsePracticeAttempt(localStorage.getItem(key) ?? '');
    if (attempt && key === ATTEMPT_PREFIX + attempt.id) entries.push(attempt);
  }
  return entries.sort((left, right) => left.submittedAt - right.submittedAt);
}

export function GroupPracticePage() {
  return (
    <main className={styles.shell} lang="zh-CN">
      <header className={styles.header}>
        <div className={styles.brand}>
          <span>
            <BookOpen size={19} />
          </span>
          家庭学习助手
        </div>
        <nav className={styles.nav} aria-label="主导航">
          <Link href="/" prefetch={false}>
            <ArrowLeft size={16} />
            返回问答
          </Link>
        </nav>
      </header>
      <GroupPractice />
    </main>
  );
}

export function GroupPractice({ inDialog = false }: { inDialog?: boolean }) {
  const [exercise, setExercise] = useState(INITIAL_EXERCISE);
  const [input, setInput] = useState('');
  const [result, setResult] = useState<PracticeAttempt>();
  const [attempts, setAttempts] = useState<PracticeAttempt[]>([]);
  const [hint, setHint] = useState(false);
  const [counted, setCounted] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const submitted = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function sync() {
      try {
        setAttempts(readAttempts());
      } catch {
        setStorageError(true);
      }
    }
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key.startsWith(ATTEMPT_PREFIX)) sync();
    }
    sync();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const reviews = pendingReviews(attempts);
  const correct = result ? isCorrectAttempt(result) : false;
  const { groupSize, groupCount } = exercise;
  const groupLabel = (item: GroupExercise) => `${item.groupCount} 组，每组 ${item.groupSize} 个`;

  function startExercise(next: GroupExercise, focus = false) {
    submitted.current = false;
    setExercise(next);
    setInput('');
    setResult(undefined);
    setHint(false);
    setCounted([]);
    setError('');
    if (focus) requestAnimationFrame(() => inputRef.current?.focus());
  }

  function checkAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitted.current) return;
    const answer = parseGroupAnswer(input);
    if (answer === undefined) {
      setError('请输入一个整数。');
      inputRef.current?.focus();
      return;
    }

    submitted.current = true;
    const attempt = { id: crypto.randomUUID(), exercise, answer, submittedAt: Date.now() };
    setError('');
    setResult(attempt);
    try {
      localStorage.setItem(ATTEMPT_PREFIX + attempt.id, JSON.stringify(attempt));
      const saved = readAttempts();
      for (const old of saved.slice(0, Math.max(0, saved.length - MAX_STORED_ATTEMPTS))) {
        localStorage.removeItem(ATTEMPT_PREFIX + old.id);
      }
      setAttempts(saved.slice(-MAX_STORED_ATTEMPTS));
      setStorageError(false);
    } catch {
      setAttempts((previous) => [...previous, attempt].slice(-MAX_STORED_ATTEMPTS));
      setStorageError(true);
    }
  }

  return (
    <div className={inDialog ? styles.practiceDialogBody : styles.practicePage}>
      <section className={styles.practiceCard} aria-label="按组数数题目">
        {!inDialog && <h1>按组数数</h1>}
        <div className={styles.practiceActions} role="group" aria-label="每组数量">
          {GROUP_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={size === groupSize}
              onClick={() => {
                if (size !== groupSize) startExercise({ groupSize: size, groupCount });
              }}
            >
              {size} 个一组
            </button>
          ))}
        </div>
        <p className={styles.practicePrompt}>{groupLabel(exercise)}。一共有多少个？</p>
        <div className={styles.practiceGroups} aria-label="点一下标记已数的组" role="group">
          {Array.from({ length: groupCount }, (_, index) => (
            <button
              key={index}
              type="button"
              className={styles.practiceGroup}
              aria-pressed={counted.includes(index)}
              aria-label={`第 ${index + 1} 组，${groupSize} 个`}
              onClick={() =>
                setCounted((previous) =>
                  previous.includes(index)
                    ? previous.filter((item) => item !== index)
                    : [...previous, index],
                )
              }
            >
              {Array.from({ length: groupSize }, (_, dot) => (
                <span key={dot} aria-hidden="true" />
              ))}
            </button>
          ))}
        </div>
        <p className={styles.practiceMuted} aria-live="polite">
          {counted.length ? `已数 ${counted.length} 组` : '数完一组，可以点一下做标记。'}
        </p>

        <form className={styles.practiceForm} onSubmit={checkAnswer} aria-label="提交练习答案">
          <label htmlFor="group-answer">一共有</label>
          <input
            ref={inputRef}
            id="group-answer"
            value={input}
            inputMode="numeric"
            maxLength={8}
            readOnly={Boolean(result)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'group-answer-error' : undefined}
            autoComplete="off"
            onChange={(event) => {
              setInput(event.target.value);
              setError('');
            }}
          />
          <span>个</span>
          {!result && (
            <button className={styles.practicePrimary} type="submit">
              提交答案
            </button>
          )}
        </form>
        {error && (
          <p id="group-answer-error" role="alert" className={styles.practiceError}>
            {error}
          </p>
        )}

        {!result && (
          <button
            type="button"
            className={styles.practiceHint}
            aria-expanded={hint}
            onClick={() => setHint(!hint)}
          >
            <CircleHelp size={17} />
            {hint ? '收起提示' : '给我一点提示'}
          </button>
        )}
        {hint && !result && (
          <p className={styles.practiceFeedback}>
            先数第一组是 {groupSize} 个，再往下数。每多一组，就加 {groupSize} 个。
          </p>
        )}

        {result && (
          <>
            <p className={styles.practiceFeedback} role="status">
              {correct
                ? `答对了！${groupCount} 组，每组 ${groupSize} 个，共 ${exerciseTotal(exercise)} 个。`
                : `再试一次。每数完一组，就加 ${groupSize} 个。别漏掉最后一组。`}
            </p>
            <div className={styles.practiceActions}>
              {!correct && (
                <button
                  type="button"
                  className={styles.practicePrimary}
                  onClick={() => startExercise(exercise, true)}
                >
                  重做这题
                </button>
              )}
              <button
                type="button"
                className={correct ? styles.practicePrimary : undefined}
                onClick={() =>
                  startExercise(
                    { groupSize, groupCount: groupCount === 6 ? 2 : groupCount + 1 },
                    true,
                  )
                }
              >
                下一题
              </button>
            </div>
          </>
        )}
      </section>

      <section className={styles.practiceCard} aria-labelledby="practice-review">
        <h2 id="practice-review">练习记录</h2>
        <p className={styles.practiceMuted}>
          最近 {attempts.length} 次作答 · 待重做 {reviews.length} 道 · 保存在此浏览器
        </p>
        {storageError && (
          <p className={styles.practiceError} role="status">
            浏览器未能保存本次记录，关闭页面后可能丢失。
          </p>
        )}
        {reviews.length > 0 && (
          <ul className={styles.practiceReviews}>
            {reviews.map(({ id, exercise: item }) => (
              <li key={id}>
                <span>{groupLabel(item)}</span>
                <button
                  type="button"
                  onClick={() => startExercise(item, true)}
                  aria-label={`重做：${groupLabel(item)}`}
                >
                  重做
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
