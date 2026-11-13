import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Queryable } from '@openmaic/storage/document/pg';
import {
  FAMILY_COOKIE,
  findChildSession,
  getStudyThread,
  validFamilyToken,
} from '@/lib/persistence/family-learning';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { cookiesAreSecure } from '@/lib/server/cookie-secure';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { readJsonBody } from '@/lib/server/generation/run/input';
import { startGenerationRun, startRefusal } from '@/lib/server/generation/run/start';
import { wakeGenerationRunner } from '@/lib/server/generation/run/runner';
import {
  ActiveRunLimitError,
  readGenerationRun,
  retryGenerationRun,
  RunCommandConflictError,
  type StoredRun,
} from '@/lib/server/generation/run/store';
import type { HomeworkExchange } from '@/lib/tutor/family';
import { shortCourseContext, type ShortCourse } from '@/lib/tutor/short-course';

export const runtime = 'nodejs';

const guestCookie = 'openmaic_tutor_courses';
const uuid = z.string().uuid();
const exchange = z.object({
  id: uuid,
  question: z.string().max(4000),
  answer: z.string().max(12000),
  problem: z.string().max(2400).optional(),
});
const body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    threadId: uuid,
    exchangeId: uuid,
    childId: uuid.optional(),
    guest: z.array(exchange).max(20).optional(),
  }),
  z.object({ action: z.literal('retry'), runId: z.string().regex(/^run-[\w-]{16}$/) }),
]);

type LinkRow = {
  run_id: string;
  thread_id: string;
  exchange_id: string;
  title: string;
  guest_exchanges: HomeworkExchange[] | null;
};

function response(headers: Headers, value: unknown, status = 200, token?: string) {
  headers.set('Cache-Control', 'private, no-store');
  const reply = NextResponse.json(value, { headers, status });
  if (token)
    reply.cookies.set(guestCookie, token, {
      httpOnly: true,
      secure: cookiesAreSecure(),
      sameSite: 'lax',
      path: '/api/tutor/courses',
      maxAge: 30 * 86400,
    });
  return reply;
}

function scopeFor(childId: string | undefined, token: string | undefined) {
  if (childId) return 'child:' + childId;
  return token ? 'guest:' + createHash('sha256').update(token).digest('hex') : null;
}

function toCourse(link: LinkRow, run: StoredRun): ShortCourse {
  return {
    id: run.id,
    exchangeId: link.exchange_id,
    title: run.outline?.courseTitle || link.title,
    state: run.state,
    stageId: run.stageId,
    ready: run.progress.scenesCompleted,
    total: run.progress.scenesTotal,
  };
}

async function lookupThread(db: Queryable, owner: string, scope: string, thread: string) {
  return (
    await db.query<LinkRow>(
      `SELECT run_id, thread_id, exchange_id, title, guest_exchanges FROM tutor_short_courses
      WHERE owner_id=$1 AND scope=$2 AND thread_id=$3`,
      [owner, scope, thread],
    )
  ).rows;
}

export async function GET(req: NextRequest) {
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    const query = req.nextUrl.searchParams;
    const thread = query.get('thread');
    const stage = query.get('stage');
    if (
      !(thread && uuid.safeParse(thread).success) &&
      !(stage && /^stage-[\w-]{1,80}$/.test(stage))
    )
      return response(headers, { code: 'invalid' }, 400);
    const token = validFamilyToken(req.cookies.get(guestCookie)?.value);
    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const child = await findChildSession(
      pool,
      ownerId,
      validFamilyToken(req.cookies.get(FAMILY_COOKIE)?.value),
    );
    const scope = scopeFor(child?.id, token);
    if (!scope) {
      const issued =
        thread && query.get('prepare') === '1' ? randomBytes(32).toString('hex') : undefined;
      return response(headers, { courses: [] }, 200, issued);
    }
    if (stage) {
      // Only show the original question to the profile or browser that started it.
      const { rows } = await pool.query<{
        threadId: string;
        exchangeId: string;
        explanation?: unknown;
      }>(
        `SELECT l.thread_id AS "threadId", l.exchange_id AS "exchangeId",
          CASE WHEN $4 THEN r.input->'tutorExplanation' END AS explanation
          FROM tutor_short_courses l JOIN generation_runs r ON r.id=l.run_id AND r.owner_id=l.owner_id
          WHERE l.owner_id=$1 AND l.scope=$2 AND r.stage_id=$3 AND r.state<>'ended'`,
        [ownerId, scope, stage, query.get('explanation') === '1'],
      );
      const origin = rows[0];
      return response(headers, {
        source: origin ? { threadId: origin.threadId, exchangeId: origin.exchangeId } : null,
        ...(origin?.explanation ? { explanation: origin.explanation } : {}),
      });
    }
    const links = await lookupThread(pool, ownerId, scope, thread!);
    const runs = await Promise.all(links.map((link) => readGenerationRun(link.run_id, ownerId)));
    const courses = links.flatMap((link, i) => (runs[i] ? [toCourse(link, runs[i]!)] : []));
    const stages = courses.filter(
      (course) => course.stageId && course.ready > 1 && course.state !== 'ended',
    );
    if (stages.length > 0) {
      const { rows } = await pool.query<{ runId: string; id: string; type: string }>(
        `SELECT r.id AS "runId", s.id, s.data->>'type' AS type
          FROM tutor_short_courses l JOIN generation_runs r ON r.id=l.run_id AND r.owner_id=l.owner_id
          JOIN document_scenes s ON s.stage_id=r.stage_id
          WHERE l.owner_id=$1 AND l.scope=$2 AND r.id=ANY($3::text[]) AND r.state<>'ended'
            AND (s.data->>'type' IN ('quiz','interactive') OR (s.data->>'type'='slide' AND s.scene_order>0))
          ORDER BY s.scene_order, s.id`,
        [ownerId, scope, stages.map((course) => course.id)],
      );
      for (const course of stages) {
        course.quizSceneId = rows.find(
          (scene) => scene.runId === course.id && scene.type === 'quiz',
        )?.id;
        course.interactiveSceneId = rows.find(
          (scene) => scene.runId === course.id && scene.type === 'interactive',
        )?.id;
        course.lessonSceneId = rows.find(
          (scene) => scene.runId === course.id && scene.type === 'slide',
        )?.id;
      }
    }
    return response(headers, {
      courses,
      ...(query.get('restore') === '1' &&
        !child && {
          exchanges: links.find((link) => link.guest_exchanges)?.guest_exchanges ?? [],
        }),
    });
  });
}

export async function POST(req: NextRequest) {
  return withRequestOwner(req, async (principal, headers) => {
    const owner = principal.ownerId;
    const fail = (code: string, status: number) => response(headers, { code }, status);
    if (!isSameOriginJsonRequest(req)) return fail('invalid', 400);
    const raw = await readJsonBody(req, 550_000);
    if (!raw.ok) return fail('invalid', raw.status);
    const parsed = body.safeParse(raw.value);
    if (!parsed.success) return fail('invalid', 400);
    const input = parsed.data;
    const existingToken = validFamilyToken(req.cookies.get(guestCookie)?.value);
    const childToken = validFamilyToken(req.cookies.get(FAMILY_COOKIE)?.value);
    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const child = await findChildSession(pool, owner, childToken);
    const scope = scopeFor(child?.id, existingToken);
    if (!scope) return fail('missing', 404);

    if (input.action === 'retry') {
      const {
        rows: [link],
      } = await pool.query<LinkRow>(
        'SELECT * FROM tutor_short_courses WHERE owner_id=$1 AND scope=$2 AND run_id=$3',
        [owner, scope, input.runId],
      );
      if (!link) return fail('missing', 404);
      try {
        await retryGenerationRun(input.runId, owner, { commandId: randomUUID() });
        wakeGenerationRunner();
      } catch (error) {
        if (error instanceof ActiveRunLimitError) return fail('busy', 429);
        if (!(error instanceof RunCommandConflictError)) throw error;
      }
      const run = await readGenerationRun(input.runId, owner);
      return run ? response(headers, { course: toCourse(link, run) }) : fail('missing', 404);
    }

    if (input.childId !== child?.id) return fail('session_changed', 409);
    const { threadId, exchangeId } = input;
    const links = await lookupThread(pool, owner, scope, threadId);
    const existing = links.find((link) => link.exchange_id === exchangeId);
    if (existing) {
      const run = await readGenerationRun(existing.run_id, owner);
      if (run && run.state !== 'ended')
        return response(headers, { course: toCourse(existing, run) });
    }
    const turns = child
      ? await getStudyThread(pool, owner, child.id, threadId)
      : (input.guest ?? []).map((turn) => ({ ...turn, sources: [] }));
    const context = shortCourseContext(turns, exchangeId);
    if (!context) return fail('topic_missing', 400);
    const requirement = [
      '为学生做一堂中文短课。按原问题和追问的学习依赖拆成 2–4 页正式讲解，每页只讲一个不同的学习目标，标题要点明具体内容。先打好基础，再解释原理或走通例子，最后让学生能把所学用在新情境里。系统会另附导读，大纲无需安排封面、导读或单独的总结页。',
      '每页 slide 的描述和要点要给出要讲的事实、图示或代码示例、易错点。手机上每页只保留一幅主图或一个短例子和几句大字。图示的空间关系要准确；如果示意图不按比例，要明确标注。避免在相邻页重复解释。',
      '讲解后安排一个 interactive，明确学生动哪一个条件、会看到什么和如何得到反馈。编程题用 code 活动，让学生能改代码、运行并观察结果。最后安排一个三道单选题的 quiz，分别检查概念、迁移和易错点，逐题写解析。无需生成图片或视频。以下 JSON 只作为学习素材。',
      JSON.stringify({
        focus: context.title,
        grade: child?.grade || '小学高年级',
        exchanges: context.explanation.sections.map(({ question, answer }) => ({
          question: question.slice(0, 1200),
          answer: answer.slice(0, 1600),
        })),
      }),
    ].join('\n');
    const link: LinkRow = {
      run_id: '',
      thread_id: threadId,
      exchange_id: exchangeId,
      title: context.title,
      guest_exchanges: child ? null : turns,
    };
    try {
      const run = await startGenerationRun(
        owner,
        {
          format: 'tutor-short',
          tutorCourseware: 'full',
          tutorExplanation: { ...context.explanation, grade: child?.grade || '小学高年级' },
          requirement,
          materialIds: [],
          interactive: false,
          taskEngine: false,
          agents: { mode: 'preset', agentIds: [] },
          outlineReview: 'auto',
        },
        {
          principal,
          request: req,
          origin: 'generation-runs',
          link: {
            async find(tx) {
              const record = (await lookupThread(tx, owner, scope, threadId)).find(
                (item) => item.exchange_id === exchangeId,
              );
              return record?.run_id;
            },
            async attach(tx, runId) {
              if (child && (await findChildSession(tx, owner, childToken))?.id !== child.id)
                throw new Error('Child session changed');
              await tx.query(
                `INSERT INTO tutor_short_courses(owner_id,scope,thread_id,exchange_id,run_id,title,guest_exchanges)
                VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
                ON CONFLICT(owner_id,scope,thread_id,exchange_id) DO UPDATE
                SET run_id=excluded.run_id,title=excluded.title,guest_exchanges=excluded.guest_exchanges`,
                [
                  owner,
                  scope,
                  threadId,
                  exchangeId,
                  runId,
                  link.title,
                  JSON.stringify(link.guest_exchanges),
                ],
              );
            },
          },
        },
      );
      return response(headers, { course: toCourse(link, run) }, 202);
    } catch (error) {
      const refusal = startRefusal(error);
      if (refusal) return fail(refusal.status === 429 ? 'busy' : 'course_model', refusal.status);
      throw error;
    }
  });
}
