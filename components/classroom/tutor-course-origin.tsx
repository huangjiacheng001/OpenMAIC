'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { shortCourseRequest } from '@/components/tutor/short-course-client';

type Source = { threadId: string; exchangeId: string };

export function TutorCourseOrigin({ stageId }: { stageId: string }) {
  const [source, setSource] = useState<Source>();
  useEffect(() => {
    const controller = new AbortController();
    shortCourseRequest<{ source?: Source }>({ stage: stageId }, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setSource(result.source);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [stageId]);
  if (!source) return null;
  const href = '/?' + new URLSearchParams({ thread: source.threadId, exchange: source.exchangeId });
  return (
    <div className="flex shrink-0 items-center border-b border-[#dbe4dc] bg-[#f8faf7] px-3 text-sm text-[#185542]">
      <Link className="inline-flex min-h-11 items-center gap-1 px-2 font-semibold" href={href}>
        <ChevronLeft size={18} aria-hidden="true" /> 回原问答
      </Link>
    </div>
  );
}
