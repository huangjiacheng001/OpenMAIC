'use client';

import { Button } from '@/components/ui/button';
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
          <Button asChild size="touch" variant="ghost" className="text-primary-text">
            <Link href="/practice">去错题本 →</Link>
          </Button>
        </div>
      </div>
    );
  if (!child)
    return (
      <Button
        type="button"
        size="touch"
        variant="ghost"
        className="text-primary-text"
        onClick={onSignIn}
      >
        <Bookmark size={17} />
        存为错题
      </Button>
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="touch" variant="ghost" className="text-primary-text">
          <Bookmark size={17} />
          存为错题
        </Button>
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
          <Button size="touch" disabled={saving || !problem.trim()}>
            {saving ? '正在保存…' : error ? '重试保存' : '确认保存'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
