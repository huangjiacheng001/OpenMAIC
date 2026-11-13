'use client';

import { CardSection } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createTutorId } from '@/lib/tutor/client-id';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { createSafeMathPlugin } from '@/lib/markdown/safe-math-plugin';
import {
  familyTime,
  type ChildProfile,
  type ReviewItem,
  type ReviewSummary,
} from '@/lib/tutor/family';
import { familyMessage, familyRead, familyWrite } from './family-client';
import { FamilyHeader, FamilyNav } from './family-shell';
import { useFamilySession } from './use-family-session';
import styles from './family-workspace.module.css';

const plugins = { math: createSafeMathPlugin() };
const signs = [
  ['<', '＜'],
  ['=', '＝'],
  ['>', '＞'],
] as const;

function ReviewDetail({ child, id }: { child: ChildProfile; id: string }) {
  const [item, setItem] = useState<ReviewItem>();
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const pending = useRef<{ id: string; answer: string }>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    familyRead<{ item: ReviewItem }>('item', { child: child.id, id }, ctl.signal)
      .then((data) => {
        if (!ctl.signal.aborted) setItem(data.item);
      })
      .catch((cause) => {
        if (!ctl.signal.aborted) setError(familyMessage(cause));
      });
    return () => ctl.abort();
  }, [child.id, id, requestVersion]);

  async function submit(self?: 'correct' | 'retry') {
    if (!item || sending || (!self && !answer.trim())) return;
    setSending(true);
    setError('');
    try {
      const last = item.attemptsList[0];
      const payload = self
        ? { id: last.id, answer: last.answer, self }
        : pending.current?.answer === answer.trim()
          ? pending.current
          : (pending.current = { id: createTutorId(), answer: answer.trim() });
      const result = await familyWrite<{ item: ReviewItem }>('attempt', {
        childId: child.id,
        itemId: id,
        ...payload,
      });
      pending.current = null;
      setItem(result.item);
      setAnswer('');
      if (!self) setShowAnswer(!result.item.checkable);
      if (self === 'retry') setShowAnswer(false);
    } catch (cause) {
      setError(familyMessage(cause));
    } finally {
      setSending(false);
    }
  }

  const latest = item?.attemptsList[0];
  return (
    <>
      {error && (
        <div role="alert" className={styles.alert}>
          {error}
          <Button
            size="touch"
            variant="ghost"
            className="text-primary-text"
            onClick={() => {
              setError('');
              setRequestVersion((v) => v + 1);
            }}
          >
            刷新题目
          </Button>
        </div>
      )}
      {!item ? (
        !error && (
          <p role="status" className={styles.muted}>
            正在打开原题…
          </p>
        )
      ) : (
        <>
          <div>
            <p className={styles.eyebrow}>
              {item.completedAt ? '错题本 · 已完成' : '错题本 · 重做原题'}
            </p>
            <h1>{item.completedAt ? '重做结果' : '先自己做一遍'}</h1>
          </div>
          <div className={styles.problem}>
            <span>原题</span>
            {item.problem}
          </div>
          {item.photo && <img className={styles.photo} src={item.photo} alt="保存的作业照片" />}
          {latest && (
            <p
              role="status"
              className={
                item.completedAt
                  ? styles.success
                  : latest.outcome === 'incorrect'
                    ? styles.alert
                    : styles.notice
              }
            >
              {item.completedAt
                ? latest.outcome === 'self_correct'
                  ? '已完成 · 你确认做对了。'
                  : '这次做对了。'
                : latest.outcome === 'incorrect'
                  ? '这次还没比对。先通分成相同的分母，再比较分子。'
                  : '已记录这次作答。你可以对照讲解，确认自己的做法。'}
            </p>
          )}
          {!item.completedAt && (
            <form
              className={styles.stack}
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {item.checkable ? (
                <>
                  <h2>{latest ? '再试一次' : '选一个比较符号'}</h2>
                  <div className={styles.choices} aria-label="比较符号">
                    {signs.map(([value, label]) => (
                      <button
                        type="button"
                        disabled={sending}
                        key={value}
                        aria-pressed={answer === value}
                        onClick={() => setAnswer(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <label className={styles.field}>
                  {latest ? '再写一次你的答案或做法' : '写下你的答案或做法'}
                  <textarea
                    value={answer}
                    disabled={sending}
                    maxLength={2400}
                    onChange={(event) => setAnswer(event.target.value)}
                  />
                </label>
              )}
              <Button size="touch" disabled={!answer.trim() || sending}>
                {sending ? '正在提交…' : '提交答案'}
              </Button>
            </form>
          )}
          {item.explanation && (
            <details
              className={styles.card}
              open={showAnswer}
              onToggle={(event) => setShowAnswer(event.currentTarget.open)}
            >
              <summary>{item.checkable ? '回看原讲解' : '对照原讲解'}</summary>
              <Streamdown
                plugins={plugins}
                controls={false}
                skipHtml
                disallowedElements={['img', 'a']}
                unwrapDisallowed
              >
                {item.explanation}
              </Streamdown>
              {!item.checkable && !item.completedAt && (
                <div className={styles.actions}>
                  <Button
                    size="touch"
                    variant="outline"
                    disabled={sending}
                    onClick={() => void submit('retry')}
                  >
                    还要再练
                  </Button>
                  <Button size="touch" disabled={sending} onClick={() => void submit('correct')}>
                    我确认做对了
                  </Button>
                </div>
              )}
            </details>
          )}
          {item.attemptsList.length > 0 && (
            <CardSection>
              <h2>这道题的作答</h2>
              {item.attemptsList.map((record, index) => (
                <div className={styles.row} key={record.id}>
                  <div>
                    <strong>
                      第 {item.attempts - index} 次 · {familyTime(record.submittedAt)}
                    </strong>
                    <span className={styles.muted}>{record.answer}</span>
                  </div>
                </div>
              ))}
            </CardSection>
          )}
          {item.completedAt && (
            <Button asChild size="touch">
              <Link href="/practice?done=1">回到已完成列表</Link>
            </Button>
          )}
          {item.threadId && (
            <Button asChild size="touch" variant="outline">
              <Link href={'/?thread=' + item.threadId}>回原问答继续学</Link>
            </Button>
          )}
        </>
      )}
    </>
  );
}

function ReviewList({ child, initialDone }: { child: ChildProfile; initialDone: boolean }) {
  const [done, setDone] = useState(initialDone);
  const [data, setData] = useState<{
    counts: { due: number; done: number };
    items: ReviewSummary[];
  }>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    familyRead<NonNullable<typeof data>>(
      'reviews',
      { child: child.id, done: done ? '1' : '0' },
      ctl.signal,
    )
      .then((result) => {
        if (!ctl.signal.aborted) setData(result);
      })
      .catch((cause) => {
        if (!ctl.signal.aborted) setError(familyMessage(cause));
      });
    return () => ctl.abort();
  }, [child.id, done, reload]);
  function select(value: boolean) {
    if (value === done) return;
    setData((previous) => previous && { ...previous, items: [] });
    setError('');
    setDone(value);
  }
  return (
    <>
      <div>
        <p className={styles.eyebrow}>{child.name}的错题本</p>
        <h1>把没做会的再做一遍</h1>
      </div>
      <div className={styles.tabs}>
        <button aria-pressed={!done} onClick={() => select(false)}>
          待重做{data ? ' ' + data.counts.due : ''}
        </button>
        <button aria-pressed={done} onClick={() => select(true)}>
          已完成{data ? ' ' + data.counts.done : ''}
        </button>
      </div>
      {error ? (
        <div className={styles.alert} role="alert">
          {error}{' '}
          <Button
            size="touch"
            variant="ghost"
            className="text-primary-text"
            onClick={() => {
              setError('');
              setReload((value) => value + 1);
            }}
          >
            重试
          </Button>
        </div>
      ) : !data ? (
        <p className={styles.muted} role="status">
          正在读取错题…
        </p>
      ) : data.items.length ? (
        <div className={styles.rows}>
          {data.items.map((item) => (
            <Link href={'/practice?item=' + item.id} className={styles.row} key={item.id}>
              <div>
                <strong>{item.problem}</strong>
                <span className={styles.muted}>
                  {item.attempts ? item.attempts + ' 次作答' : '还没重做'} ·{' '}
                  {familyTime(item.savedAt)}
                </span>
              </div>
              <ChevronRight size={17} />
            </Link>
          ))}
        </div>
      ) : (
        <p className={styles.muted}>
          {done ? '还没有完成的题。' : '现在没有待重做的题。讲完作业后可以把原题存到这里。'}
        </p>
      )}
    </>
  );
}

export function HomeworkReview({
  itemId,
  initialDone = false,
}: {
  itemId?: string;
  initialDone?: boolean;
}) {
  const { session, error, refresh } = useFamilySession();
  return (
    <div className={styles.page} lang="zh-CN">
      <FamilyHeader
        child={session?.child}
        title={itemId ? '重做原题' : '错题本'}
        back={itemId ? '/practice' : undefined}
      />
      <main className={styles.content}>
        {error ? (
          <div className={styles.alert} role="alert">
            {error}{' '}
            <Button
              size="touch"
              variant="ghost"
              className="text-primary-text"
              onClick={() => void refresh()}
            >
              重试
            </Button>
          </div>
        ) : !session ? (
          <p className={styles.muted} role="status">
            正在打开错题本…
          </p>
        ) : session.child ? (
          itemId ? (
            <ReviewDetail key={session.child.id + itemId} child={session.child} id={itemId} />
          ) : (
            <ReviewList
              key={session.child.id + String(initialDone)}
              child={session.child}
              initialDone={initialDone}
            />
          )
        ) : (
          <>
            <h1>错题本</h1>
            <p className={styles.copy}>用孩子档案保存和重做原题，换设备也能找到。</p>
            <Button asChild size="touch">
              <Link href="/family?view=profiles">打开家庭档案</Link>
            </Button>
          </>
        )}
      </main>
      {!itemId && <FamilyNav active="/practice" />}
    </div>
  );
}
