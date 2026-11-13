'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bookmark } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { ChildProfile } from '@/lib/tutor/family';
import { familyMessage, familyWrite } from './family-client';
import type { Exchange } from './use-tutor';
import styles from './family-workspace.module.css';

export function SaveHomework({
  child,
  exchange,
  photo,
  threadId,
  onSignIn,
  startOpen,
  beforeSave,
}: {
  child?: ChildProfile | null;
  exchange: Exchange;
  photo?: string;
  threadId?: string;
  onSignIn: () => void;
  startOpen?: boolean;
  beforeSave?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(Boolean(startOpen));
  const [problem, setProblem] = useState((exchange.problem || exchange.question).slice(0, 2400));
  const [keep, setKeep] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!child || !problem.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await beforeSave?.();
      await familyWrite('save', {
        childId: child.id,
        item: {
          id: exchange.id,
          threadId,
          problem,
          explanation: exchange.answer.slice(0, 12000),
          photo: keep ? photo : undefined,
        },
      });
      setSaved(true);
      setOpen(false);
    } catch (cause) {
      setError(familyMessage(cause));
    } finally {
      setSaving(false);
    }
  }
  if (saved)
    return (
      <div className={styles.success} role="status">
        <div className={styles.statusLine}>
          已存到{child?.name}的错题本{' '}
          <Link href="/practice" className={styles.textButton}>
            去错题本 →
          </Link>
        </div>
      </div>
    );
  if (!child)
    return (
      <button type="button" className={styles.textButton} onClick={onSignIn}>
        <Bookmark size={17} />
        存为错题
      </button>
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className={styles.textButton}>
          <Bookmark size={17} />
          存为错题
        </button>
      </DialogTrigger>
      <DialogContent className={styles.sheet}>
        <DialogTitle>存为错题</DialogTitle>
        <DialogDescription>保存到{child.name}的错题本，下次可以独立重做。</DialogDescription>
        <form
          className={styles.stack}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className={styles.field}>
            题干
            <textarea
              value={problem}
              required
              maxLength={2400}
              onChange={(event) => setProblem(event.target.value)}
            />
          </label>
          {photo && (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={keep}
                onChange={(event) => setKeep(event.target.checked)}
              />
              同时保留原照片
            </label>
          )}
          {error && (
            <p className={styles.alert} role="alert">
              {error} 对话和题干仍在。
            </p>
          )}
          <button className={styles.button} disabled={saving || !problem.trim()}>
            {saving ? '正在保存…' : error ? '重试保存' : '确认保存'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
