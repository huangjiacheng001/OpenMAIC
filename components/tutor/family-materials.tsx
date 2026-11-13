'use client';

import { useEffect, useState } from 'react';
import { BookOpen, ChevronRight } from 'lucide-react';
import { FamilyHeader, FamilyNav } from './family-shell';
import { useFamilySession } from './use-family-session';
import styles from './family-workspace.module.css';

type Material = { materialId: string; name: string; originalName?: string };

export function FamilyMaterials() {
  const { session } = useFamilySession();
  const [items, setItems] = useState<Material[]>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/materials/library?sources=1&limits=0', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Material library unavailable');
        const result = (await response.json()) as { materials: Material[] };
        setItems(result.materials);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);
  return (
    <div className={styles.page} lang="zh-CN">
      <FamilyHeader title="资料" child={session?.child} />
      <main className={styles.content}>
        <div>
          <h1>学习资料</h1>
          <p className={styles.copy}>与题目相关的教材和网页出处会显示在回答里。</p>
        </div>
        <section className={styles.card}>
          <h2>家庭资料</h2>
          {error ? (
            <p className={styles.muted}>暂时无法打开资料库。</p>
          ) : !items ? (
            <p role="status">正在打开资料…</p>
          ) : items.length === 0 ? (
            <p className={styles.muted}>资料库里还没有资料。</p>
          ) : (
            <div className={styles.rows}>
              {items.map((item) => (
                <a
                  className={styles.row}
                  key={item.materialId}
                  href={'/api/materials/' + encodeURIComponent(item.materialId) + '/original'}
                  target="_blank"
                  rel="noreferrer"
                >
                  <BookOpen size={17} />
                  <div style={{ flex: 1 }}>
                    <strong>{item.name || item.originalName || '学习资料'}</strong>
                  </div>
                  <ChevronRight size={17} />
                </a>
              ))}
            </div>
          )}
        </section>
      </main>
      <FamilyNav active="/materials" />
    </div>
  );
}
