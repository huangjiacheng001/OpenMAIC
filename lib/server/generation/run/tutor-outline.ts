import { buildCompleteScene } from '@openmaic/generation';
import { nanoid } from 'nanoid';
import type { SceneActionsResult } from '@/lib/server/generation/steps/scene-actions';
import type { SceneContentResult } from '@/lib/server/generation/steps/scene-content';
import type { SceneOutline } from '@/lib/types/generation';

export function assembleTutorShortScene(
  outline: SceneOutline,
  content: SceneContentResult['content'],
  stageId: string,
): SceneActionsResult {
  const narration =
    outline.type === 'slide' && 'elements' in content
      ? content.remark?.trim() || outline.keyPoints.join('。')
      : '';
  const scene = buildCompleteScene(
    outline,
    content,
    narration ? [{ id: nanoid(), type: 'speech', text: narration }] : [],
    stageId,
  );
  if (!scene) throw new Error('Short course scene could not be assembled');
  return { scene, previousSpeeches: narration ? [narration] : [] };
}

/** Keep the short course playable even when the model proposes an oversized outline. */
export function tutorShortOutlines(outlines: SceneOutline[]): SceneOutline[] {
  const base = (
    type: SceneOutline['type'],
    order: number,
    fallback: Partial<SceneOutline>,
  ): SceneOutline => {
    const found = outlines.find((item) => item.type === type);
    const result = { ...found, ...fallback, type, id: 'short-' + type, order };
    delete result.mediaGenerations;
    delete result.suggestedImageIds;
    return result as SceneOutline;
  };
  const first = outlines.find((item) => item.type === 'slide') ?? outlines[0];
  const interactive = outlines.find((item) => item.type === 'interactive');
  const quiz = outlines.find((item) => item.type === 'quiz');
  return [
    base('slide', 0, {
      title: first.title || '先弄懂这道题',
      description: first.description || '从原问题解释一个核心概念。',
      keyPoints: first.keyPoints.slice(0, 4),
      estimatedDuration: 100,
    }),
    base('interactive', 1, {
      title: interactive?.title || '动手试一试',
      description: interactive?.description || '用一个可改变的条件观察结果。',
      keyPoints: interactive?.keyPoints.slice(0, 3) ?? first.keyPoints.slice(0, 2),
      widgetType: interactive?.widgetType || 'simulation',
      widgetOutline: interactive?.widgetOutline || {
        concept: first.title,
        designIdea: '给一个可观察或可拖动的条件，变化时立即反馈，用中文给出操作提示。',
      },
      estimatedDuration: 100,
    }),
    base('quiz', 2, {
      title: quiz?.title || '用一道题检查',
      description: quiz?.description || '用不同于原题的例子检验相同概念。',
      keyPoints: quiz?.keyPoints.slice(0, 3) ?? first.keyPoints.slice(0, 2),
      quizConfig: { questionCount: 1, difficulty: 'easy', questionTypes: ['single'] },
      estimatedDuration: 60,
    }),
  ];
}
