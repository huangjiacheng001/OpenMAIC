'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    <div className="flex shrink-0 items-center border-b bg-workspace px-3">
      <Button asChild size="touch" variant="ghost" className="text-primary-text">
        <Link href={href}>
          <ChevronLeft aria-hidden="true" /> 回原问答
        </Link>
      </Button>
    </div>
  );
}
