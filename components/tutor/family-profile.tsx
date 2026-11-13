'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, CircleCheck, LockKeyhole, RotateCcw } from 'lucide-react';
import {
  familyTime,
  type ChildProfile,
  type ReviewAttempt,
  type ReviewItem,
} from '@/lib/tutor/family';
import { familyMessage, familyRead, familyWrite } from './family-client';
import { FamilyHeader } from './family-shell';
import { useFamilySession } from './use-family-session';
import styles from './family-workspace.module.css';

type Activity = {
  itemId: string;
  problem: string;
  time: string;
  outcome: ReviewAttempt['outcome'] | 'saved';
};
const outcomes: Record<Activity['outcome'], string> = {
  correct: '重做通过',
  incorrect: '重做答错',
  self_correct: '自行确认做对',
  self_retry: '提交作答，待复习',
  saved: '存入错题本',
};

export function FamilyProfile({
  start = 'records',
  chooseChild,
}: {
  start?: 'profiles' | 'records';
  chooseChild?: (child: ChildProfile) => void;
}) {
  const { session, refresh, error: sessionError } = useFamilySession();
  const [view, setView] = useState(start);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [target, setTarget] = useState('');
  const [activity, setActivity] = useState<{
    counts: { due: number; done: number };
    events: Activity[];
  }>();
  const [detail, setDetail] = useState<ReviewItem>();
  const [loginCode, setLoginCode] = useState<{ code: string; name: string }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);
  const [copied, setCopied] = useState(false);
  const current = children.find((child) => child.id === target);
  const embedded = Boolean(chooseChild);

  useEffect(() => {
    if (!session?.guardian) return;
    const ctl = new AbortController();
    familyRead<{ children: ChildProfile[] }>('children', {}, ctl.signal)
      .then((data) => {
        if (ctl.signal.aborted) return;
        setChildren(data.children);
        setTarget((id) =>
          data.children.some((child) => child.id === id)
            ? id
            : data.children.find((child) => child.id === session.child?.id)?.id ||
              data.children[0]?.id ||
              '',
        );
      })
      .catch((cause) => {
        if (!ctl.signal.aborted) setError(familyMessage(cause));
      });
    return () => ctl.abort();
  }, [session]);

  useEffect(() => {
    if (!session?.guardian || !target || view !== 'records') return;
    const ctl = new AbortController();
    familyRead<NonNullable<typeof activity>>('activity', { child: target }, ctl.signal)
      .then((data) => {
        if (!ctl.signal.aborted) setActivity(data);
      })
      .catch((cause) => {
        if (!ctl.signal.aborted) setError(familyMessage(cause));
      });
    return () => ctl.abort();
  }, [session?.guardian, target, view]);

  async function perform(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (cause) {
      setError(familyMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  function selectChild(child: ChildProfile) {
    if (chooseChild) chooseChild(child);
    else window.location.assign('/');
  }
  function backToRecords() {
    setDetail(undefined);
    setError('');
  }
  function showDetail(itemId: string) {
    void perform(async () => {
      const { item } = await familyRead<{ item: ReviewItem }>('parent-item', {
        child: target,
        id: itemId,
      });
      setDetail(item);
    });
  }

  const errorBlock = (error || sessionError) && (
    <p className={styles.alert} role="alert">
      {error || sessionError}
      {sessionError && (
        <button type="button" className={styles.textButton} onClick={() => void refresh()}>
          重试
        </button>
      )}
    </p>
  );

  const login = (
    <section className={styles.panel}>
      <h2>用孩子登录码继续</h2>
      <p className={styles.muted}>在另一台设备打开同一个 OpenMAIC 地址，输入家长给你的登录码。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void perform(async () => {
            const { child } = await familyWrite<{ child: ChildProfile }>('child-login', {
              code: data.get('code'),
            });
            selectChild(child);
          });
        }}
      >
        <label className={styles.field}>
          孩子登录码
          <input name="code" required maxLength={64} autoCapitalize="none" autoComplete="off" />
        </label>
        <button className={styles.button} disabled={busy}>
          登录孩子档案
        </button>
      </form>
    </section>
  );

  const codePanel = loginCode && (
    <section className={styles.panel}>
      <h2>{loginCode.name}的登录码</h2>
      <p className={styles.muted}>
        在另一台设备打开同一个 OpenMAIC 地址并输入此码。请先保存登录码。
      </p>
      <code className={styles.code}>{loginCode.code}</code>
      <button
        type="button"
        className={styles.secondary}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(loginCode.code)
            .then(() => setCopied(true))
            .catch(() => {});
        }}
      >
        {copied ? '已复制' : '复制登录码'}
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          if (embedded && session?.child) selectChild(session.child);
          else if (session?.child) window.location.assign('/');
          else {
            setLoginCode(undefined);
            setCopied(false);
          }
        }}
      >
        {embedded ? '回到讲解' : '去问答'}
      </button>
    </section>
  );

  const childList = session?.guardian && (
    <section className={styles.panel}>
      <h2>孩子档案</h2>
      {children.length ? (
        <div className={styles.rows}>
          {children.map((child) => (
            <button
              type="button"
              key={child.id}
              className={styles.row}
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const result = await familyWrite<{ child: ChildProfile }>('switch-child', {
                    childId: child.id,
                  });
                  selectChild(result.child);
                })
              }
            >
              <div>
                <strong>{child.name}</strong>
                <span className={styles.muted}>
                  {child.grade}
                  {session.child?.id === child.id ? ' · 当前使用' : ''}
                </span>
              </div>
              <ChevronRight size={17} />
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.muted}>建立第一个孩子档案后，就能保存原题和重做记录。</p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void perform(async () => {
            const result = await familyWrite<{ child: ChildProfile; loginCode: string }>(
              'add-child',
              { name: data.get('name'), grade: data.get('grade') },
            );
            form.reset();
            setLoginCode({ code: result.loginCode, name: result.child.name });
            setCopied(false);
            await refresh();
          });
        }}
      >
        <label className={styles.field}>
          孩子姓名
          <input name="name" required maxLength={24} placeholder="可用昵称" />
        </label>
        <label className={styles.field}>
          年级
          <input name="grade" maxLength={24} placeholder="例如 小学五年级" />
        </label>
        <button className={styles.button} disabled={busy}>
          添加孩子
        </button>
      </form>
    </section>
  );

  const gate = session && !session.guardian && (
    <section className={styles.panel}>
      <h2>{session.needsSetup ? '设置家长密码' : '请输入家长密码'}</h2>
      <p className={styles.muted}>
        {session.needsSetup
          ? '家长用这个密码管理孩子档案和查看作答。'
          : '完成验证后，就能查看家庭学习记录。'}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void perform(async () => {
            await familyWrite(session.needsSetup ? 'setup' : 'guardian', {
              password: data.get('password'),
            });
            await refresh();
          });
        }}
      >
        <label className={styles.field}>
          家长密码
          <input
            name="password"
            type="password"
            minLength={8}
            maxLength={128}
            required
            autoComplete={session.needsSetup ? 'new-password' : 'current-password'}
          />
        </label>
        <button className={styles.button} disabled={busy}>
          {session.needsSetup ? '设置并继续' : '验证并查看'}
        </button>
      </form>
    </section>
  );

  let content;
  if (!session)
    content = !sessionError && (
      <p role="status" className={styles.muted}>
        正在读取家庭档案…
      </p>
    );
  else if (view === 'profiles')
    content = (
      <>
        {!embedded && (
          <div>
            <p className={styles.eyebrow}>家庭学习</p>
            <h1>家庭档案</h1>
          </div>
        )}
        {session.child && (
          <section className={styles.card}>
            <h2>当前使用 · {session.child.name}</h2>
            <p className={styles.muted}>{session.child.grade}</p>
            {chooseChild ? (
              <button className={styles.button} onClick={() => chooseChild(session.child!)}>
                用这个档案保存
              </button>
            ) : (
              <div className={styles.actions}>
                <Link href="/" className={styles.button}>
                  回到问答
                </Link>
                <button
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await familyWrite('child-logout', { childId: session.child!.id });
                      await refresh();
                    })
                  }
                >
                  退出孩子档案
                </button>
              </div>
            )}
          </section>
        )}
        {codePanel}
        {login}
        {childList}
        <button
          className={styles.secondary}
          onClick={() => {
            setView('records');
            setError('');
          }}
        >
          <LockKeyhole size={16} />
          进入家长记录
        </button>
      </>
    );
  else if (!session.guardian)
    content = (
      <>
        {gate}
        <button
          className={styles.textButton}
          onClick={() => {
            setView('profiles');
            setError('');
          }}
        >
          返回家庭档案
        </button>
      </>
    );
  else if (detail)
    content = (
      <>
        <button className={styles.textButton} onClick={backToRecords}>
          ← 返回家庭记录
        </button>
        <div>
          <p className={styles.eyebrow}>{current?.name} · 作答详情</p>
          <h1>{detail.problem}</h1>
        </div>
        <section className={styles.card}>
          <h2>每次作答</h2>
          {!detail.attemptsList.length && <p className={styles.muted}>这道题还没有重做记录。</p>}
          {detail.attemptsList.map((attempt) => (
            <div className={styles.row} key={attempt.id}>
              <div>
                <strong>
                  {outcomes[attempt.outcome]} · {familyTime(attempt.submittedAt)}
                </strong>
                <p>{attempt.answer}</p>
              </div>
            </div>
          ))}
        </section>
        {detail.photo ? (
          <img src={detail.photo} className={styles.photo} alt="保存的作业照片" />
        ) : (
          <p className={styles.muted}>错题记录只保留了题干。</p>
        )}
      </>
    );
  else
    content = (
      <>
        <div>
          <p className={styles.eyebrow}>家长视图</p>
          <h1>家庭记录</h1>
        </div>
        {codePanel}
        {!children.length && childList}
        {children.length > 0 && (
          <label className={styles.field}>
            查看哪个孩子
            <select
              value={target}
              disabled={busy}
              onChange={(event) => {
                setActivity(undefined);
                setDetail(undefined);
                setError('');
                setTarget(event.target.value);
              }}
            >
              {children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name}
                  {child.grade && ' · ' + child.grade}
                </option>
              ))}
            </select>
          </label>
        )}
        {activity && (
          <>
            <div className={styles.stats}>
              <div>
                <strong>{activity.counts.due}</strong>待重做
              </div>
              <div>
                <strong>{activity.counts.done}</strong>已完成
              </div>
            </div>
            <section className={styles.card}>
              <div className={styles.statusLine}>
                <h2>近期学习</h2>
                <span className={styles.muted}>北京时间</span>
              </div>
              {activity.events.length ? (
                <div className={styles.rows}>
                  {activity.events.map((record, index) => (
                    <button
                      type="button"
                      key={record.itemId + index}
                      className={styles.row}
                      disabled={busy}
                      onClick={() => showDetail(record.itemId)}
                    >
                      <div>
                        <strong>
                          {outcomes[record.outcome]} · {familyTime(record.time)}
                        </strong>
                        <span className={styles.muted}>{record.problem}</span>
                      </div>
                      {record.outcome === 'correct' ? (
                        <CircleCheck size={17} />
                      ) : (
                        <ChevronRight size={17} />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <p className={styles.muted}>{current?.name}还没有作答记录。</p>
              )}
            </section>
          </>
        )}
        <div className={styles.actions}>
          <button className={styles.secondary} onClick={() => setView('profiles')}>
            管理孩子档案
          </button>
          {current && (
            <button className={styles.textButton} onClick={() => setManage(!manage)}>
              管理登录码
            </button>
          )}
          <button
            className={styles.textButton}
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await familyWrite('guardian-logout');
                setActivity(undefined);
                setChildren([]);
                setDetail(undefined);
                setLoginCode(undefined);
                await refresh();
              })
            }
          >
            退出家长视图
          </button>
        </div>
        {manage && current && (
          <section className={styles.card}>
            <p className={styles.muted}>
              更新{current.name}的登录码会让该孩子在现有设备上退出，作答记录会保留。
            </p>
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const result = await familyWrite<{ code: string }>('reset-code', {
                    childId: current.id,
                  });
                  setLoginCode({ code: result.code, name: current.name });
                  setCopied(false);
                  setManage(false);
                  await refresh();
                })
              }
            >
              <RotateCcw size={16} />
              更新登录码
            </button>
          </section>
        )}
      </>
    );

  if (embedded)
    return (
      <div className={styles.stack}>
        {content}
        {errorBlock}
      </div>
    );
  return (
    <div className={styles.page} lang="zh-CN">
      <FamilyHeader
        title={view === 'profiles' ? '家庭档案' : detail ? '作答详情' : '家庭记录'}
        back="/"
        parent={view === 'records'}
      />
      <main className={styles.content}>
        {content}
        {errorBlock}
      </main>
    </div>
  );
}
