import type { HomeworkExchange } from '@/lib/tutor/family';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_TUTOR_HISTORY,
  MAX_TUTOR_TEXT,
  type TutorError,
  type TutorEvent,
  type TutorTurn,
} from '@/lib/tutor/protocol';

type Notice = Extract<TutorEvent, { type: 'notice' }>['code'];
export type Exchange = HomeworkExchange & {
  photo?: string;
  notice?: Notice;
};

export const TUTOR_ERRORS: Record<TutorError, string> = {
  invalid: '问题或图片超出大小限制，请缩短后重试。',
  image: '这张图片读不了，可以重新拍一张。',
  model: '学习助手的模型还没设置好。请在「课堂」的模型设置中配置后重试。',
  auth: '当前模型需要重新登录。请在「课堂」的模型设置中检查授权。',
  timeout: '这次等待时间有点长，可以再试一次。',
  unavailable: '这次没有答完，可以再试一次。',
};

export function useTutor() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState<Exchange>();
  const [status, setStatus] = useState<'searching' | 'answering'>();
  const [error, setError] = useState<TutorError>();
  const active = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );

  const submit = useCallback(
    async (question: string, photo?: string, context?: { childId: string; threadId: string }) => {
      if (active.current || (!question.trim() && !photo)) return false;
      const controller = new AbortController();
      active.current = controller;
      let exchange: Exchange = {
        id: globalThis.crypto.randomUUID(),
        question: question.trim(),
        photo,
        answer: '',
        sources: [],
      };
      setPending(exchange);
      setError(undefined);
      setStatus('answering');

      try {
        const recent = exchanges.slice(-MAX_TUTOR_HISTORY / 2);
        const history = recent.flatMap<TutorTurn>((turn) => [
          {
            role: 'user',
            content: turn.problem
              ? [turn.question, '原题：' + turn.problem]
                  .filter(Boolean)
                  .join('\n')
                  .slice(0, MAX_TUTOR_TEXT)
              : turn.question || '请帮我看看这道题。',
          },
          { role: 'assistant', content: turn.answer.trim().slice(0, MAX_TUTOR_TEXT) },
        ]);
        const previousPhoto = recent.findLastIndex((turn) => Boolean(turn.photo));
        const response = await fetch('/api/tutor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: exchange.question,
            ...(context && { ...context, exchangeId: exchange.id }),
            history,
            photo: photo || recent[previousPhoto]?.photo,
            photoTurn: !photo && previousPhoto >= 0 ? previousPhoto * 2 : undefined,
          }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return false;
        if (!response.ok || !response.body) {
          const result = await response.json().catch(() => null);
          const code = result?.code;
          setError(
            response.status === 401 || result?.errorCode === 'PROVIDER_DISABLED'
              ? 'auth'
              : Object.hasOwn(TUTOR_ERRORS, code)
                ? code
                : 'unavailable',
          );
          return false;
        }

        let done = false;
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        try {
          while (!done) {
            const packet = await reader.read();
            if (packet.done || controller.signal.aborted) break;
            buffer += packet.value;
            let newline: number;
            while ((newline = buffer.indexOf('\n')) >= 0) {
              const event = JSON.parse(buffer.slice(0, newline)) as TutorEvent;
              buffer = buffer.slice(newline + 1);
              if (event.type === 'error') {
                setError(event.code);
                return false;
              }
              if (event.type === 'text')
                exchange = { ...exchange, answer: exchange.answer + event.delta };
              if (event.type === 'problem') exchange = { ...exchange, problem: event.problem };
              if (event.type === 'sources') exchange = { ...exchange, sources: event.sources };
              if (event.type === 'notice') exchange = { ...exchange, notice: event.code };
              if (event.type === 'status') setStatus(event.status);
              if (event.type === 'done') done = true;
            }
            setPending(exchange);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        if (!done || !exchange.answer.trim()) throw new Error('Incomplete tutor response');
        if (controller.signal.aborted) return false;
        setExchanges((previous) => [...previous, exchange]);
        return true;
      } catch {
        if (!controller.signal.aborted) setError('unavailable');
        return false;
      } finally {
        if (active.current === controller) {
          active.current = null;
          setPending(undefined);
          setStatus(undefined);
        }
      }
    },
    [exchanges],
  );

  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setPending(undefined);
    setStatus(undefined);
  }, []);

  const reset = useCallback(() => {
    cancel();
    setExchanges([]);
    setError(undefined);
  }, [cancel]);

  const restore = useCallback(
    (history: HomeworkExchange[]) => {
      cancel();
      setExchanges(history);
      setError(undefined);
    },
    [cancel],
  );

  return { exchanges, pending, status, error, submit, cancel, reset, restore };
}
