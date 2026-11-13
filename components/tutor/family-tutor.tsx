'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ClipboardEvent, FormEvent, KeyboardEvent } from 'react';
import Link from 'next/link';
import { ArrowUp, Camera, ImagePlus, Mic, Plus, Square, X } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { HomeworkPhotoPreview } from './homework-photo-preview';
import { FamilyHeader, FamilyNav } from './family-shell';
import { FamilyProfile } from './family-profile';
import { ShortCourseCard } from './short-course-card';
import {
  prepareShortCourse,
  readShortCourses,
  shortCourseError,
  shortCourseIsActive,
  writeShortCourse,
} from './short-course-client';
import { canMakeShortCourse, shortCourseContext, type ShortCourse } from '@/lib/tutor/short-course';
import { SaveHomework } from './save-homework';
import { useFamilySession } from './use-family-session';
import { familyMessage, familyRead, familyWrite } from './family-client';
import {
  familyTime,
  type ChildProfile,
  type HomeworkExchange,
  type StudyThread,
} from '@/lib/tutor/family';
import familyStyles from './family-workspace.module.css';
import { createSafeMathPlugin } from '@/lib/markdown/safe-math-plugin';
import { useAudioRecorder, ASR_NOT_CONFIGURED_MESSAGE } from '@/lib/hooks/use-audio-recorder';
import { MAX_TUTOR_TEXT } from '@/lib/tutor/protocol';
import { createTutorId } from '@/lib/tutor/client-id';
import { prepareTutorPhoto } from './photo';
import { TUTOR_ERRORS, useTutor, type Exchange } from './use-tutor';
import styles from './family-tutor.module.css';

const markdownPlugins = { math: createSafeMathPlugin() };
const subscribeToSecureContext = () => () => {};
const getSecureContext = () => window.isSecureContext;
const getServerSecureContext = () => false;

function saveGuestConversation(thread: string, turns: HomeworkExchange[]) {
  try {
    if (!turns.length) return;
    sessionStorage.setItem(
      'tutor-course:' + thread,
      JSON.stringify(
        turns.slice(-80).map(({ id, question, answer, problem, sources }) => ({
          id,
          question,
          answer,
          problem,
          sources,
        })),
      ),
    );
  } catch {}
}
function loadGuestConversation(thread: string): HomeworkExchange[] | undefined {
  try {
    const raw = sessionStorage.getItem('tutor-course:' + thread);
    return raw ? (JSON.parse(raw) as HomeworkExchange[]) : undefined;
  } catch {}
}

function TutorExchange({ exchange, streaming }: { exchange: Exchange; streaming?: boolean }) {
  return (
    <article className={styles.exchange}>
      <div className={styles.question}>
        {exchange.photo && <img src={exchange.photo} alt="本轮题目照片" />}
        {exchange.question && <span>{exchange.question}</span>}
        {exchange.problem && (
          <div className={familyStyles.problem}>
            <span>原题</span>
            {exchange.problem}
          </div>
        )}
      </div>
      {(exchange.answer || exchange.notice || exchange.sources.length > 0) && (
        <div className={styles.answer}>
          {exchange.notice && (
            <p className={styles.notice}>
              {exchange.notice === 'material_missing'
                ? '这次没有找到相关的教材内容。'
                : '这次没有拿到网页资料，实时信息尚未核实。'}
            </p>
          )}
          {exchange.answer && (
            <Streamdown
              plugins={markdownPlugins}
              controls={false}
              skipHtml
              disallowedElements={['img', 'a']}
              unwrapDisallowed
              parseIncompleteMarkdown={streaming}
            >
              {exchange.answer}
            </Streamdown>
          )}
          {exchange.sources.length > 0 && (
            <details className={styles.sources}>
              <summary>查看参考资料（{exchange.sources.length}）</summary>
              <ol>
                {exchange.sources.map((source, index) => (
                  <li key={source.href + index}>
                    <a href={source.href} target="_blank" rel="noopener noreferrer">
                      {source.number && '[' + source.number + '] '}
                      {source.title}
                    </a>
                    {source.excerpt && <p>{source.excerpt}</p>}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </article>
  );
}

export function FamilyTutor({
  initialThread,
  initialExchange,
}: {
  initialThread?: string;
  initialExchange?: string;
}) {
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState<string>();
  const [photoPreview, setPhotoPreview] = useState(false);
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [inputError, setInputError] = useState('');
  const [voice, setVoice] = useState<'listening' | 'finishing'>();
  const [voiceText, setVoiceText] = useState('');
  const voiceAllowed = useSyncExternalStore(
    subscribeToSecureContext,
    getSecureContext,
    getServerSecureContext,
  );
  const voiceIntent = useRef<'listening' | 'finishing' | undefined>(undefined);
  const voiceBase = useRef('');
  const transcript = useRef('');
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const keepAtBottom = useRef(true);
  const preparingPhoto = useRef(false);
  const { exchanges, pending, status, error, submit, cancel, reset, restore } = useTutor();
  const { session, refresh, error: sessionError } = useFamilySession();
  const [child, setChild] = useState<ChildProfile>();
  const [history, setHistory] = useState<StudyThread[]>([]);
  const [thread, setThread] = useState(initialThread);
  const [opening, setOpening] = useState(Boolean(initialThread));
  const [profileOpen, setProfileOpen] = useState(false);
  const [queuedSave, setQueuedSave] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [courses, setCourses] = useState<ShortCourse[]>([]);
  const [courseBusy, setCourseBusy] = useState('');
  const [courseError, setCourseError] = useState<{ id: string; message: string }>();
  const courseAction = useRef(false);
  const restoreTarget = useRef(initialExchange);
  const activeChild = child || session?.child;
  const currentThread = useRef(initialThread);
  const guestExchanges = useRef<Exchange[]>([]);
  const started = useRef(false);
  const hasActiveCourse = courses.some(shortCourseIsActive);

  useEffect(() => {
    if (!thread) return;
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshCourses = async () => {
      try {
        const result = await readShortCourses(thread, ctl.signal);
        if (!ctl.signal.aborted) setCourses(result.courses);
      } catch {
        // A failed status request leaves the last known card in place.
      } finally {
        if (!ctl.signal.aborted && hasActiveCourse) timer = setTimeout(refreshCourses, 1800);
      }
    };
    void refreshCourses();
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, [thread, activeChild?.id, hasActiveCourse]);

  async function generateCourse(exchange: Exchange, retry?: ShortCourse) {
    if (courseAction.current) return;
    courseAction.current = true;
    setCourseBusy(exchange.id);
    setCourseError(undefined);
    const id = currentThread.current || createTutorId();
    currentThread.current = id;
    try {
      if (activeChild) await attachGuestThread(activeChild.id, id);
      else if (!retry) await prepareShortCourse(id);
      const payload = retry
        ? { action: 'retry', runId: retry.id }
        : {
            action: 'start',
            threadId: id,
            exchangeId: exchange.id,
            ...(activeChild
              ? { childId: activeChild.id }
              : {
                  guest: exchanges.slice(-20).map(({ id, question, answer, problem }) => ({
                    id,
                    question,
                    answer: answer.slice(0, 12000),
                    problem,
                  })),
                }),
          };
      const { course } = await writeShortCourse(payload);
      if (currentThread.current !== id) return;
      setThread(id);
      setCourses((previous) => [
        ...previous.filter((item) => item.exchangeId !== exchange.id),
        course,
      ]);
      if (!activeChild) saveGuestConversation(id, exchanges);
    } catch (cause) {
      if (currentThread.current === id)
        setCourseError({ id: exchange.id, message: shortCourseError(cause) });
    } finally {
      courseAction.current = false;
      setCourseBusy('');
    }
  }

  useEffect(() => {
    if (!activeChild?.id) return;
    const ctl = new AbortController();
    familyRead<{ threads: StudyThread[] }>('threads', { child: activeChild.id }, ctl.signal)
      .then((result) => {
        if (!ctl.signal.aborted) setHistory(result.threads);
      })
      .catch((cause) => {
        if (!ctl.signal.aborted) setLoadError(familyMessage(cause));
      });
    return () => ctl.abort();
  }, [activeChild?.id, thread, exchanges.length]);

  useEffect(() => {
    if (!initialThread || started.current || !session) return;
    const ctl = new AbortController();
    const restoreRequest = activeChild
      ? familyRead<{ exchanges: HomeworkExchange[] }>(
          'thread',
          { child: activeChild.id, id: initialThread },
          ctl.signal,
        )
      : readShortCourses(initialThread, ctl.signal, true).then(({ exchanges }) => {
          const turns = new Map(
            (exchanges ?? []).map((exchange) => [exchange.id, exchange] as const),
          );
          for (const exchange of loadGuestConversation(initialThread) ?? [])
            turns.set(exchange.id, exchange);
          return { exchanges: [...turns.values()] };
        });
    restoreRequest
      .then((result) => {
        if (ctl.signal.aborted) return;
        if (!result.exchanges.length) throw new Error('Conversation unavailable');
        started.current = true;
        restore(result.exchanges);
      })
      .catch((cause) => {
        if (!ctl.signal.aborted) {
          setLoadError(familyMessage(cause));
          started.current = true;
          currentThread.current = undefined;
          setThread(undefined);
        }
      })
      .finally(() => {
        if (!ctl.signal.aborted) setOpening(false);
      });
    return () => ctl.abort();
  }, [activeChild, initialThread, restore, session]);

  useEffect(() => {
    if (!activeChild && thread && courses.length && exchanges.length)
      saveGuestConversation(thread, exchanges);
  }, [activeChild, thread, courses.length, exchanges]);

  async function adoptChild(selected: ChildProfile) {
    const previous = activeChild?.id;
    const snapshot = !previous ? exchanges : [];
    if (previous && previous !== selected.id) {
      reset();
      setPhoto(undefined);
      setDraft('');
      currentThread.current = undefined;
      setThread(undefined);
      setHistory([]);
      setCourses([]);
      setCourseError(undefined);
    }
    setChild(selected);
    setProfileOpen(false);
    if (snapshot.length) {
      setRestorePending(true);
      guestExchanges.current = snapshot;
      const id = currentThread.current || createTutorId();
      currentThread.current = id;
      setThread(id);
      try {
        await attachGuestThread(selected.id, id);
      } catch (cause) {
        setLoadError(familyMessage(cause));
      } finally {
        setRestorePending(false);
      }
    }
    await refresh();
  }

  async function attachGuestThread(childId: string, threadId: string) {
    if (!guestExchanges.current.length) return;
    await familyWrite('attach-thread', {
      childId,
      threadId,
      exchanges: guestExchanges.current.slice(-20).map(({ id, question, answer, problem }) => ({
        id,
        question,
        answer: answer.slice(0, 12000),
        problem,
      })),
    });
    guestExchanges.current = [];
  }

  const onFinal = useCallback((text: string) => {
    if (!voiceIntent.current) return;
    transcript.current += text;
    setVoiceText(transcript.current);
  }, []);
  const onInterim = useCallback((text: string) => {
    if (voiceIntent.current) setVoiceText(transcript.current + text);
  }, []);
  const onVoiceError = useCallback((message: string) => {
    if (!voiceIntent.current) return;
    if (transcript.current.trim()) {
      setDraft(
        [voiceBase.current, transcript.current.trim()]
          .filter(Boolean)
          .join(' ')
          .slice(0, MAX_TUTOR_TEXT),
      );
    }
    voiceIntent.current = undefined;
    setVoice(undefined);
    setInputError(
      message === ASR_NOT_CONFIGURED_MESSAGE
        ? '当前浏览器无法使用语音识别，试试 Chrome 或直接打字。'
        : '语音没有识别成功。请检查麦克风权限，或直接打字。',
    );
  }, []);
  const recorder = useAudioRecorder({
    continuous: true,
    onTranscription: onFinal,
    onInterimTranscription: onInterim,
    onError: onVoiceError,
  });
  const recordingBusy = recorder.isStarting || recorder.isRecording || recorder.isProcessing;

  const send = useCallback(
    async (question: string, image?: string) => {
      if (preparingPhoto.current || opening) return;
      setInputError('');
      keepAtBottom.current = true;
      let context;
      if (activeChild) {
        const id = currentThread.current || createTutorId();
        currentThread.current = id;
        setThread(id);
        try {
          await attachGuestThread(activeChild.id, id);
        } catch (cause) {
          setLoadError(familyMessage(cause));
          return;
        }
        context = { threadId: id, childId: activeChild.id };
      }
      if (await submit(question, image, context)) {
        setDraft('');
        setPhoto(undefined);
      }
    },
    [activeChild, opening, submit],
  );

  useEffect(() => {
    if (!voice || recordingBusy || voiceIntent.current !== voice) return;
    voiceIntent.current = undefined;
    setVoice(undefined);
    const recognized = transcript.current.trim();
    if (!recognized) {
      setInputError('没听清，请再说一次。');
      return;
    }
    const question = [voiceBase.current, recognized]
      .filter(Boolean)
      .join(' ')
      .slice(0, MAX_TUTOR_TEXT);
    setDraft(question);
    if (voice === 'finishing') void send(question, photo);
  }, [recordingBusy, voice, send, photo]);

  useEffect(() => {
    if (!opening && restoreTarget.current && feed.current) {
      const target = document.getElementById('tutor-turn-' + restoreTarget.current);
      if (target) {
        restoreTarget.current = undefined;
        keepAtBottom.current = false;
        target.scrollIntoView({ block: 'nearest' });
        return;
      }
    }
    if (feed.current && keepAtBottom.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [exchanges, pending, status, opening]);

  async function addPhoto(file?: File, preview = false) {
    if (!file || pending || voiceIntent.current || preparingPhoto.current) return;
    preparingPhoto.current = true;
    setLoadingPhoto(true);
    setInputError('');
    try {
      setPhoto(await prepareTutorPhoto(file));
      if (preview) setPhotoPreview(true);
      if (!window.matchMedia('(pointer: coarse)').matches) box.current?.focus();
    } catch {
      setInputError('这张图没法打开。可以试试 JPEG、PNG 或截图。');
    } finally {
      preparingPhoto.current = false;
      setLoadingPhoto(false);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(event.clipboardData.files).find((item) =>
      item.type.startsWith('image/'),
    );
    if (!file) return;
    event.preventDefault();
    void addPhoto(file);
  }

  function startVoice() {
    if (!voiceAllowed || voiceIntent.current || pending || preparingPhoto.current) return;
    voiceBase.current = draft;
    transcript.current = '';
    voiceIntent.current = 'listening';
    setVoiceText('');
    setInputError('');
    setVoice('listening');
    void recorder.startRecording();
  }

  function stopVoice() {
    if (voiceIntent.current !== 'listening' || !recorder.isRecording) return;
    voiceIntent.current = 'finishing';
    setVoice('finishing');
    recorder.stopRecording();
  }

  function cancelVoice() {
    voiceIntent.current = undefined;
    recorder.cancelRecording();
    setVoice(undefined);
    setVoiceText('');
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || voiceIntent.current) return;
    void send(draft, photo);
  }

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229 &&
      !window.matchMedia('(pointer: coarse)').matches
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const chat = exchanges.length > 0 || Boolean(pending) || opening;
  const canSend = !voice && !loadingPhoto && !opening && Boolean(draft.trim() || photo);
  const last = exchanges.at(-1);
  const original = exchanges.findLast((exchange) => exchange.problem || exchange.photo);

  return (
    <main className={styles.shell} lang="zh-CN">
      <FamilyHeader
        child={activeChild}
        title={chat ? '作业讲解' : undefined}
        back={chat ? '/' : undefined}
      />
      {chat && (
        <div className={styles.threadTools}>
          <button
            type="button"
            onClick={() => {
              cancelVoice();
              reset();
              setDraft('');
              setPhoto(undefined);
              setInputError('');
              setLoadError('');
              currentThread.current = undefined;
              guestExchanges.current = [];
              setThread(undefined);
              setCourses([]);
              setCourseError(undefined);
              if (initialThread) window.history.replaceState(null, '', '/');
            }}
          >
            <Plus size={16} />
            新对话
          </button>
        </div>
      )}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className={familyStyles.sheet}>
          <DialogTitle>选择学习档案</DialogTitle>
          <DialogDescription>登录后可以保存原题，换设备继续重做。</DialogDescription>
          <FamilyProfile start="profiles" chooseChild={(selected) => void adoptChild(selected)} />
        </DialogContent>
      </Dialog>

      {photo && photoPreview && (
        <HomeworkPhotoPreview
          photo={photo}
          onEdit={setPhoto}
          onClose={() => setPhotoPreview(false)}
          onRetake={() => {
            setPhotoPreview(false);
            camera.current?.click();
          }}
          onSend={() => {
            setPhotoPreview(false);
            void send(draft, photo);
          }}
        />
      )}
      {!chat ? (
        <section className={styles.hero}>
          <p className={familyStyles.eyebrow}>家庭学习</p>
          <h1>今天想弄懂什么？</h1>
          <p>发一道题，或说说你卡在哪一步。</p>
        </section>
      ) : (
        <div
          className={styles.feed}
          ref={feed}
          aria-label="学习对话"
          onScroll={(event) => {
            const element = event.currentTarget;
            keepAtBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 100;
          }}
        >
          <div className={styles.feedContent}>
            {opening && (
              <p className={styles.progress} role="status">
                正在打开原问答…
              </p>
            )}
            {exchanges.map((exchange, index) => {
              const course = courses.find((item) => item.exchangeId === exchange.id);
              const available = exchanges.length - index <= 20 && canMakeShortCourse(exchange);
              return (
                <div key={exchange.id} id={'tutor-turn-' + exchange.id}>
                  <TutorExchange exchange={exchange} />
                  {(course || available) && (
                    <ShortCourseCard
                      course={course}
                      busy={courseBusy === exchange.id}
                      error={courseError?.id === exchange.id ? courseError.message : undefined}
                      getExplanation={() => shortCourseContext(exchanges, exchange.id)?.explanation}
                      onStart={() => void generateCourse(exchange)}
                      onRetry={() => void generateCourse(exchange, course)}
                    />
                  )}
                </div>
              );
            })}
            {pending && <TutorExchange exchange={pending} streaming />}
            {pending && !pending.answer && (
              <p role="status" className={styles.progress}>
                <span />
                {status === 'searching'
                  ? '正在找资料'
                  : pending.photo
                    ? '正在读题'
                    : '正在准备回答'}
              </p>
            )}
            {!pending &&
              !restorePending &&
              last &&
              original &&
              (original.problem || last !== original || !original.photo) && (
                <SaveHomework
                  key={original.id + (activeChild?.id || '')}
                  child={activeChild}
                  threadId={thread}
                  exchange={{
                    ...original,
                    answer:
                      last === original ? original.answer : original.answer + '\n\n' + last.answer,
                  }}
                  photo={original.photo}
                  startOpen={queuedSave && Boolean(activeChild)}
                  beforeSave={
                    activeChild && thread
                      ? () => attachGuestThread(activeChild.id, thread)
                      : undefined
                  }
                  onSignIn={() => {
                    setQueuedSave(true);
                    setProfileOpen(true);
                  }}
                />
              )}
          </div>
        </div>
      )}

      <div className={chat ? styles.docked : styles.introComposer}>
        <form className={styles.composer} onSubmit={handleSubmit} aria-label="向学习助手提问">
          <input
            hidden
            type="file"
            ref={picker}
            accept="image/*"
            data-testid="tutor-photo-picker"
            onChange={(event) => {
              void addPhoto(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
          <input
            hidden
            type="file"
            ref={camera}
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              void addPhoto(event.currentTarget.files?.[0], true);
              event.currentTarget.value = '';
            }}
          />
          {photo && (
            <div className={styles.preview}>
              <button
                type="button"
                className={styles.photoThumb}
                onClick={() => setPhotoPreview(true)}
                aria-label="打开照片预览"
              >
                <img src={photo} alt="待发送的照片" />
              </button>
              <button
                type="button"
                disabled={Boolean(pending)}
                className={styles.photoRemove}
                aria-label="移除照片"
                onClick={() => setPhoto(undefined)}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {voice ? (
            <div className={styles.voice} role="status">
              <span className={styles.voiceDot} />
              <div>
                <strong>
                  {voice === 'finishing'
                    ? '正在识别语音…'
                    : recorder.isStarting
                      ? '正在打开麦克风…'
                      : '正在听'}
                </strong>
                {voiceText && <p>{voiceText}</p>}
              </div>
            </div>
          ) : (
            <textarea
              ref={box}
              rows={chat ? 2 : 3}
              maxLength={MAX_TUTOR_TEXT}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={handlePaste}
              onKeyDown={handleKey}
              readOnly={Boolean(pending)}
              aria-label="输入你的问题"
              placeholder={
                photo
                  ? '也可以写下你卡在哪里…'
                  : chat
                    ? '继续问…'
                    : voiceAllowed
                      ? '在这里问问题，也可以发照片或语音…'
                      : '在这里问问题，也可以发照片…'
              }
            />
          )}
          <div className={styles.toolbar}>
            <div className={styles.attachments}>
              {voice ? (
                <button type="button" onClick={cancelVoice}>
                  <X size={18} />
                  取消
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => camera.current?.click()}
                    disabled={Boolean(pending) || loadingPhoto}
                  >
                    <Camera size={19} />
                    拍照
                  </button>
                  <button
                    type="button"
                    onClick={() => picker.current?.click()}
                    disabled={Boolean(pending) || loadingPhoto}
                  >
                    <ImagePlus size={19} />
                    图片
                  </button>
                  {voiceAllowed && (
                    <button
                      type="button"
                      onClick={startVoice}
                      disabled={Boolean(pending) || loadingPhoto}
                    >
                      <Mic size={19} />
                      语音
                    </button>
                  )}
                </>
              )}
            </div>
            {voice ? (
              <button
                type="button"
                className={styles.finish}
                onClick={stopVoice}
                disabled={voice === 'finishing' || !recorder.isRecording}
              >
                说完了
                <ArrowUp size={17} />
              </button>
            ) : pending ? (
              <button
                key="stop"
                type="button"
                className={styles.send}
                aria-label="停止回答"
                onClick={(event) => {
                  event.preventDefault();
                  cancel();
                }}
              >
                <Square size={17} />
              </button>
            ) : (
              <button key="send" type="submit" className={styles.send} disabled={!canSend}>
                <ArrowUp size={21} aria-hidden="true" />
                发送
              </button>
            )}
          </div>
        </form>
        {loadingPhoto && (
          <p role="status" className={styles.feedback}>
            正在处理图片…
          </p>
        )}
        {(inputError || error) && !pending && (
          <p role="alert" className={styles.feedback}>
            {inputError || (error && TUTOR_ERRORS[error])}
            {error && canSend && (
              <button type="button" onClick={() => void send(draft, photo)}>
                重试
              </button>
            )}
          </p>
        )}
      </div>

      {(loadError || sessionError) && (
        <p className={styles.feedback} role="alert">
          {loadError || sessionError}
        </p>
      )}
      {!chat && (
        <>
          <section className={styles.continue}>
            <h2>接着学</h2>
            {history.length ? (
              <div className={familyStyles.rows}>
                {history.slice(0, 5).map((item) => (
                  <Link className={familyStyles.row} key={item.id} href={'/?thread=' + item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      <span className={familyStyles.muted}>{familyTime(item.updatedAt)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className={familyStyles.muted}>还没有学习记录</p>
            )}
          </section>
          <FamilyNav active="/" />
        </>
      )}
    </main>
  );
}
