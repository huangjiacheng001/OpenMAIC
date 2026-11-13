'use client';

import Link from 'next/link';
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  LibraryBig,
  MessagesSquare,
  NotebookPen,
} from 'lucide-react';
import type { ChildProfile } from '@/lib/tutor/family';
import styles from './family-workspace.module.css';

export function FamilyHeader({
  child,
  title,
  back,
  parent = false,
}: {
  child?: ChildProfile | null;
  title?: string;
  back?: string;
  parent?: boolean;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerTitle}>
        {back && (
          <Link className={styles.iconButton} href={back} aria-label="返回">
            <ChevronLeft size={22} />
          </Link>
        )}
        {title ? (
          <strong>{title}</strong>
        ) : (
          <Link href="/" className={styles.brand}>
            <span>
              <BookOpen size={17} />
            </span>
            OpenMAIC
          </Link>
        )}
      </div>
      {parent ? (
        <span className={styles.muted}>家长视图</span>
      ) : (
        <Link href="/family?view=profiles" className={styles.profile}>
          <span>{child?.name.slice(0, 1) || '家'}</span>
          {child?.name || '家庭档案'}
          <ChevronDown size={14} />
        </Link>
      )}
    </header>
  );
}

const links = [
  ['/', '问答', MessagesSquare],
  ['/practice', '错题本', NotebookPen],
  ['/courses', '课堂', BookOpen],
  ['/materials', '资料', LibraryBig],
] as const;

export function FamilyNav({ active }: { active: '/' | '/practice' | '/materials' }) {
  return (
    <nav className={styles.nav} aria-label="学习导航">
      {links.map(([href, title, Icon]) => (
        <Link
          key={href}
          href={href}
          aria-current={active === href ? 'page' : undefined}
          prefetch={false}
        >
          <Icon size={20} />
          <span>{title}</span>
        </Link>
      ))}
    </nav>
  );
}
