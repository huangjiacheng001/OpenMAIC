import { buildCompleteScene } from '@openmaic/generation';
import { nanoid } from 'nanoid';
import type { SceneActionsResult } from '@/lib/server/generation/steps/scene-actions';
import type { SceneContentResult } from '@/lib/server/generation/steps/scene-content';
import type { SceneOutline } from '@/lib/types/generation';
import type { ShortCourseExplanation } from '@/lib/tutor/short-course';
import { escapeHtmlText } from '@/lib/export/standalone-html/assemble';

export function tutorExplanationOutline(explanation: ShortCourseExplanation): SceneOutline[] {
  const questions = explanation.sections.map(({ question }) => question.slice(0, 240));
  const title = '先弄懂这道题';
  const audience = explanation.grade ? '按' + explanation.grade + '的理解水平组织内容。' : '';
  return [
    {
      id: 'short-slide',
      type: 'slide',
      order: 0,
      title,
      description: explanation.title,
      keyPoints: questions,
      estimatedDuration: 100,
    },
    {
      id: 'short-interactive',
      type: 'interactive',
      order: 1,
      title: '动手试一试',
      description:
        '围绕原问题设计一个可操作的活动。让学生改变一个条件，观察结果并获得解释。' + audience,
      keyPoints: questions,
      widgetType: 'simulation',
      widgetOutline: {
        concept: explanation.title,
        designIdea:
          '选一个能体现核心原理的条件，让学生主动改变它。比较改变前后的结果，用中文即时反馈，并覆盖相关追问。',
      },
      estimatedDuration: 100,
    },
    {
      id: 'short-quiz',
      type: 'quiz',
      order: 2,
      title: '用一道题检查',
      description:
        '用一个不同于原题的新情境检查学生能否应用同一个概念。每个选项应清晰，并提供答案解析。' +
        audience,
      keyPoints: questions,
      quizConfig: { questionCount: 1, difficulty: 'easy', questionTypes: ['single'] },
      estimatedDuration: 60,
    },
  ];
}

export function tutorExplanationSlide(
  explanation: ShortCourseExplanation,
): SceneContentResult['content'] {
  // The ordinary slide preview stays available in the editor and PPT export.
  // Classroom playback renders the full Markdown explanation without canvas scaling.
  const text = explanation.sections[0].answer.replace(/[*#`]/g, '').replace(/\s+/g, ' ').trim();
  const excerpt = text.length > 190 ? text.slice(0, 190) + '…' : text;
  const element = (content: string, top: number, height: number) => ({
    type: 'text' as const,
    id: nanoid(),
    left: 65,
    top,
    height,
    width: 870,
    rotate: 0,
    defaultFontName: 'Microsoft YaHei',
    defaultColor: '#24203a',
    content,
  });
  return {
    elements: [
      element(
        '<p><strong><span style="font-size:36px">' +
          escapeHtmlText(explanation.title) +
          '</span></strong></p>',
        50,
        130,
      ),
      element(
        '<p><span style="font-size:28px">' + escapeHtmlText(excerpt) + '</span></p>',
        205,
        300,
      ),
    ],
    remark: excerpt,
  };
}

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
