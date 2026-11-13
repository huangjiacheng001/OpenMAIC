'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, FormEvent, KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Camera,
  ImagePlus,
  Mic,
  Plus,
  Sparkles,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import { Streamdown } from 'streamdown';
import { createSafeMathPlugin } from '@/lib/markdown/safe-math-plugin';
import { useAudioRecorder, ASR_NOT_CONFIGURED_MESSAGE } from '@/lib/hooks/use-audio-recorder';
import { MAX_TUTOR_TEXT } from '@/lib/tutor/protocol';
import { prepareTutorPhoto } from './photo';
import { TUTOR_ERRORS, useTutor, type Exchange } from './use-tutor';
import styles from './family-tutor.module.css';

const markdownPlugins = { math: createSafeMathPlugin() };
const samples = [
  { title: '问个问题', example: '为什么月亮有时圆、有时弯？', icon: Sparkles },
  { title: '拍照问作业', example: '先给我一点提示', icon: Camera },
  { title: '查找资料', example: '帮我查候鸟迁徙的资料', icon: BookOpen },
] as const;

function TutorExchange({ exchange, streaming }: { exchange: Exchange; streaming?: boolean }) {
  return (
    <article className={styles.exchange}>
      <div className={styles.question}>
        {exchange.photo && <img src={exchange.photo} alt="本轮题目照片" />}
        {exchange.question && <span>{exchange.question}</span>}
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
                      {source.title}
                    </a>
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

export function FamilyTutor() {
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState<string>();
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [inputError, setInputError] = useState('');
  const [voice, setVoice] = useState<'listening' | 'finishing'>();
  const [voiceText, setVoiceText] = useState('');
  const voiceIntent = useRef<'listening' | 'finishing' | undefined>(undefined);
  const voiceBase = useRef('');
  const transcript = useRef('');
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const keepAtBottom = useRef(true);
  const preparingPhoto = useRef(false);
  const { exchanges, pending, status, error, submit, cancel, reset } = useTutor();

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
      if (preparingPhoto.current) return;
      setInputError('');
      keepAtBottom.current = true;
      if (await submit(question, image)) {
        setDraft('');
        setPhoto(undefined);
      }
    },
    [submit],
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
    if (feed.current && keepAtBottom.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [exchanges, pending, status]);

  async function addPhoto(file?: File) {
    if (!file || pending || voiceIntent.current || preparingPhoto.current) return;
    preparingPhoto.current = true;
    setLoadingPhoto(true);
    setInputError('');
    try {
      setPhoto(await prepareTutorPhoto(file));
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
    if (voiceIntent.current || pending || preparingPhoto.current) return;
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

  function focusWith(text: string) {
    setDraft(text);
    box.current?.focus();
  }

  function readAloud(text: string) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = /[\p{Script=Han}]/u.test(text) ? 'zh-CN' : 'en-US';
    window.speechSynthesis.speak(speech);
  }

  const chat = exchanges.length > 0 || Boolean(pending);
  const canSend = !voice && !loadingPhoto && Boolean(draft.trim() || photo);
  const last = exchanges.at(-1);

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
          {chat && (
            <button
              type="button"
              onClick={() => {
                cancelVoice();
                reset();
                setDraft('');
                setPhoto(undefined);
                setInputError('');
              }}
            >
              <Plus size={16} />
              新对话
            </button>
          )}
          <Link href="/courses" prefetch={false}>
            <BookOpen size={16} />
            课堂
            <ArrowRight size={14} />
          </Link>
        </nav>
      </header>

      {!chat ? (
        <section className={styles.hero}>
          <div className={styles.heroIcon}>
            <Sparkles size={27} strokeWidth={1.6} />
          </div>
          <h1>今天想学点什么？</h1>
          <p>打字、拍照，或者说给我听。</p>
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
            {exchanges.map((exchange, index) => (
              <TutorExchange key={index} exchange={exchange} />
            ))}
            {pending && <TutorExchange exchange={pending} streaming />}
            {pending && !pending.answer && (
              <p role="status" className={styles.progress}>
                <span />
                {status === 'searching' ? '正在找资料' : '正在准备回答'}
              </p>
            )}
            {!pending && last && (
              <div className={styles.followups}>
                <button type="button" onClick={() => focusWith('再提示一点')}>
                  再提示一点
                </button>
                <button type="button" onClick={() => focusWith('再练一道类似的题')}>
                  再练一道
                </button>
                <button type="button" aria-label="朗读回答" onClick={() => readAloud(last.answer)}>
                  <Volume2 size={16} />
                </button>
              </div>
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
              void addPhoto(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
          {photo && (
            <div className={styles.preview}>
              <img src={photo} alt="待发送的照片" />
              <button
                type="button"
                disabled={Boolean(pending)}
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
                    : '在这里问问题，也可以发照片或语音…'
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
                  <button
                    type="button"
                    onClick={startVoice}
                    disabled={Boolean(pending) || loadingPhoto}
                  >
                    <Mic size={19} />
                    语音
                  </button>
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
              <button
                key="send"
                type="submit"
                className={styles.send}
                disabled={!canSend}
                aria-label="发送"
              >
                <ArrowUp size={21} />
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

      {!chat && (
        <div className={styles.examples} aria-label="试试这样问">
          {samples.map(({ title, example, icon: Icon }, index) => (
            <button
              type="button"
              key={title}
              disabled={Boolean(voice)}
              onClick={() => {
                if (index === 1) camera.current?.click();
                else focusWith(example);
              }}
            >
              <Icon size={18} />
              <span>
                <strong>{title}</strong>
                <small>{example}</small>
              </span>
              <ArrowDown className={styles.exampleArrow} size={15} />
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
