'use client';
import { useCallback, useEffect, useState } from 'react';
import type { FamilySession } from '@/lib/tutor/family';
import { familyMessage, familyRead } from './family-client';

export function useFamilySession() {
  const [session, setSession] = useState<FamilySession>();
  const [error, setError] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await familyRead<FamilySession>('session', {}, signal);
      if (!signal?.aborted) {
        setSession(result);
        setError('');
      }
      return result;
    } catch (cause) {
      if (!signal?.aborted) setError(familyMessage(cause));
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    familyRead<FamilySession>('session', {}, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSession(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(familyMessage(cause));
      });
    return () => controller.abort();
  }, [refresh]);
  return { session, error, refresh };
}
