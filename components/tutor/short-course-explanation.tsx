'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Streamdown } from 'streamdown';
import { createSafeMathPlugin } from '@/lib/markdown/safe-math-plugin';
import type { ShortCourseExplanation as Explanation } from '@/lib/tutor/short-course';

import { shortCourseRequest } from './short-course-client';

const plugins = { math: createSafeMathPlugin() };

export function ShortCourseExplanation({ explanation }: { explanation: Explanation }) {
  return (
    <section aria-label="课程导读" className="min-w-0 space-y-4 break-words text-card-foreground">
      <h2 className="text-lg font-semibold">课程导读</h2>
      {explanation.sections.map(({ question, answer }, index) => (
        <div key={index} className="space-y-2">
          <h3 className="text-sm font-semibold text-primary-text">{question}</h3>
          <div className="min-w-0 text-sm leading-relaxed">
            <Streamdown
              plugins={plugins}
              controls={false}
              skipHtml
              disallowedElements={['img', 'a']}
              unwrapDisallowed
              parseIncompleteMarkdown={false}
            >
              {answer}
            </Streamdown>
          </div>
        </div>
      ))}
    </section>
  );
}

export function ClassroomShortCourseExplanation({
  stageId,
  fallback,
}: {
  stageId: string;
  fallback: ReactNode;
}) {
  const [explanation, setExplanation] = useState<Explanation>();
  useEffect(() => {
    const controller = new AbortController();
    shortCourseRequest<{ explanation?: Explanation }>(
      { stage: stageId, explanation: '1' },
      { signal: controller.signal },
    )
      .then(({ explanation }) => {
        if (!controller.signal.aborted) setExplanation(explanation);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [stageId]);

  return explanation ? (
    <div className="h-full overflow-y-auto bg-card px-4 py-5 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <ShortCourseExplanation explanation={explanation} />
      </div>
    </div>
  ) : (
    fallback
  );
}
