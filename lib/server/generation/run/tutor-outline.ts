import { buildCompleteScene } from '@openmaic/generation';
import { nanoid } from 'nanoid';
import type { SceneActionsResult } from '@/lib/server/generation/steps/scene-actions';
import type { SceneContentResult } from '@/lib/server/generation/steps/scene-content';
import type { SceneOutline } from '@/lib/types/generation';
import type { ShortCourseExplanation } from '@/lib/tutor/short-course';
import { escapeHtmlText } from '@/lib/export/standalone-html/assemble';

export function tutorExplanationOutline(
  explanation: ShortCourseExplanation,
  withCourseware = false,
): SceneOutline[] {
  const questions = explanation.sections.map(({ question }) => question.slice(0, 240));
  const title = '先弄懂这道题';
  const audience = explanation.grade ? '按' + explanation.grade + '的理解水平组织内容。' : '';
  const coding =
    withCourseware && /python|javascript|编程|写代码|代码运行/i.test(questions.join(' '));
  const topic = explanation.title;
  const outlines: SceneOutline[] = [
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
      title: coding ? '改一行代码，观察输出' : withCourseware ? '改变条件，验证解释' : '动手试一试',
      description:
        '围绕原问题设计活动。先请学生预测，再改变一个条件，显示实际结果、解释为什么，以及一个可比较的反例。' +
        audience,
      keyPoints: questions,
      widgetType: coding ? 'code' : 'simulation',
      widgetOutline: {
        concept: topic,
        ...(coding ? { language: /javascript/i.test(topic) ? 'javascript' : 'python' } : {}),
        designIdea:
          '从可观察的任务开始，提供正常情形和反例。操作后立即比较改变前后的结果，并解释与原题及追问的关系。',
      },
      estimatedDuration: 100,
    },
    {
      id: 'short-quiz',
      type: 'quiz',
      order: 2,
      title: withCourseware ? '用三道题检查理解' : '用一道题检查',
      description:
        '用不同于原题的场景检验迁移。若有多题，分别检查核心因果、在新场景应用和辨析常见误区。干扰项应来自常见错误，题干不要泄露答案，逐题解释正确理由。' +
        audience,
      keyPoints: questions,
      quizConfig: {
        questionCount: withCourseware ? 3 : 1,
        difficulty: 'easy',
        questionTypes: ['single'],
      },
      estimatedDuration: 60,
    },
  ];
  if (withCourseware) {
    outlines.splice(1, 0, {
      id: 'short-worked-example',
      type: 'slide',
      order: 1,
      title: coding ? '跟着例子学会第一步' : '用图和例子讲懂',
      description:
        '设计一页可独立教学的正式课件。先点出常见误解，再用带标注的图或代码逐步说明，最后用新例子检查理解。文字适合手机阅读。' +
        audience,
      keyPoints: questions,
      estimatedDuration: 75,
    });
  }
  return outlines.map((item, order) => ({ ...item, order }));
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
