import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { capBodyStream } from '@/lib/server/capped-stream';
import { cookiesAreSecure } from '@/lib/server/cookie-secure';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { fenceOwnerWrite, ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import * as family from '@/lib/persistence/family-learning';
import { MAX_TUTOR_PHOTO } from '@/lib/tutor/protocol';

export const runtime = 'nodejs';

const uuid = z.string().uuid();
const password = z.string().min(8).max(128);
const photo = z
  .string()
  .max(MAX_TUTOR_PHOTO)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/);
const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setup'), password }),
  z.object({ action: z.literal('guardian'), password }),
  z.object({ action: z.literal('guardian-logout') }),
  z.object({
    action: z.literal('add-child'),
    name: z.string().trim().min(1).max(24),
    grade: z.string().trim().max(24),
  }),
  z.object({ action: z.literal('reset-code'), childId: uuid }),
  z.object({ action: z.literal('switch-child'), childId: uuid }),
  z.object({
    action: z.literal('child-login'),
    code: z
      .string()
      .max(64)
      .transform((v) => v.toLowerCase().replace(/[-\s]/g, ''))
      .pipe(z.string().regex(/^[a-f0-9]{24}$/)),
  }),
  z.object({ action: z.literal('child-logout'), childId: uuid }),
  z.object({
    action: z.literal('attach-thread'),
    childId: uuid,
    threadId: uuid,
    exchanges: z
      .array(
        z.object({
          id: uuid,
          question: z.string().max(4000),
          answer: z.string().min(1).max(12000),
          problem: z.string().max(2400).optional(),
        }),
      )
      .min(1)
      .max(20),
  }),
  z.object({
    action: z.literal('save'),
    childId: uuid,
    item: z.object({
      id: uuid,
      threadId: uuid.optional(),
      problem: z.string().trim().min(1).max(2400),
      explanation: z.string().trim().min(1).max(12000),
      photo: photo.optional(),
    }),
  }),
  z.object({
    action: z.literal('attempt'),
    childId: uuid,
    itemId: uuid,
    id: uuid,
    answer: z.string().trim().min(1).max(2400),
    self: z.enum(['correct', 'retry']).optional(),
  }),
]);

function response(
  headers: Headers,
  body: unknown,
  status = 200,
  cookie?: {
    key: string;
    value: string;
    maxAge: number;
  },
) {
  headers.set('Cache-Control', 'private, no-store');
  const reply = NextResponse.json(body, { headers, status });
  if (cookie)
    reply.cookies.set(cookie.key, cookie.value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookiesAreSecure(),
      path: '/api',
      maxAge: cookie.maxAge,
    });
  return reply;
}

function getToken(req: NextRequest, name: string) {
  return family.validFamilyToken(req.cookies.get(name)?.value);
}

export async function GET(req: NextRequest) {
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    if (!process.env.DATABASE_URL?.trim()) return response(headers, { code: 'unavailable' }, 503);
    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL);
    const child = await family.findChildSession(pool, ownerId, getToken(req, family.FAMILY_COOKIE));
    const guardian = await family.hasGuardianSession(
      pool,
      ownerId,
      getToken(req, family.GUARDIAN_COOKIE),
    );
    const mode = req.nextUrl.searchParams.get('view') || 'session';
    const id = req.nextUrl.searchParams.get('id');
    if (id !== null && !uuid.safeParse(id).success)
      return response(headers, { code: 'invalid' }, 400);

    if (mode === 'session') {
      return response(headers, {
        child,
        guardian,
        needsSetup: !(await family.guardianExists(pool, ownerId)),
      });
    }
    if (mode === 'children') {
      return guardian
        ? response(headers, { children: await family.getChildren(pool, ownerId) })
        : response(headers, { code: 'guardian_required' }, 403);
    }
    if (mode === 'activity' || mode === 'parent-item') {
      if (!guardian) return response(headers, { code: 'guardian_required' }, 403);
      const target = req.nextUrl.searchParams.get('child');
      if (!uuid.safeParse(target).success) return response(headers, { code: 'invalid' }, 400);
      const children = await family.getChildren(pool, ownerId);
      if (!children.some((record) => record.id === target))
        return response(headers, { code: 'missing' }, 404);
      if (mode === 'activity') {
        const [counts, events] = await Promise.all([
          family.familyCounts(pool, ownerId, target!),
          family.reviewActivity(pool, ownerId, target!),
        ]);
        return response(headers, { counts, events });
      }
      const item = id && (await family.reviewDetail(pool, ownerId, target!, id));
      return item ? response(headers, { item }) : response(headers, { code: 'missing' }, 404);
    }

    if (!child) return response(headers, { code: 'child_required' }, 401);
    const expected = req.nextUrl.searchParams.get('child');
    if (expected !== child.id) return response(headers, { code: 'session_changed' }, 409);
    if (mode === 'threads')
      return response(headers, {
        threads: await family.latestStudyThreads(pool, ownerId, child.id),
      });
    if (mode === 'thread' && id) {
      const exchanges = await family.getStudyThread(pool, ownerId, child.id, id);
      return exchanges.length
        ? response(headers, { exchanges })
        : response(headers, { code: 'missing' }, 404);
    }
    if (mode === 'reviews') {
      const [counts, items] = await Promise.all([
        family.familyCounts(pool, ownerId, child.id),
        family.listReviews(pool, ownerId, child.id, req.nextUrl.searchParams.get('done') === '1'),
      ]);
      return response(headers, { counts, items });
    }
    if (mode === 'item' && id) {
      const item = await family.reviewDetail(pool, ownerId, child.id, id);
      return item ? response(headers, { item }) : response(headers, { code: 'missing' }, 404);
    }
    return response(headers, { code: 'invalid' }, 400);
  });
}

export async function POST(req: NextRequest) {
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    if (!req.body || !isSameOriginJsonRequest(req))
      return response(headers, { code: 'invalid' }, 400);
    const capped = capBodyStream(req.body, MAX_TUTOR_PHOTO + 300_000);
    const parsed = actions.safeParse(await new Response(capped.stream).json().catch(() => null));
    if (!parsed.success)
      return response(headers, { code: 'invalid' }, capped.exceeded() ? 413 : 400);
    if (!process.env.DATABASE_URL?.trim()) return response(headers, { code: 'unavailable' }, 503);
    const { withTransaction } = await getServerPersistenceProvider(process.env.DATABASE_URL);
    const action = parsed.data;
    const guardianToken = getToken(req, family.GUARDIAN_COOKIE);
    const childToken = getToken(req, family.FAMILY_COOKIE);
    const fail = (code: string, status: number) => response(headers, { code }, status);
    try {
      return await withTransaction(async (tx) => {
        await fenceOwnerWrite(tx, ownerId);
        if (action.action === 'setup' || action.action === 'guardian') {
          if (action.action === 'setup') {
            if (!(await family.createGuardian(tx, ownerId, action.password)))
              return fail('already_setup', 409);
          } else {
            const result = await family.verifyGuardian(tx, ownerId, action.password);
            if (result !== 'ok')
              return fail(
                result === 'limited' ? 'limited' : 'password',
                result === 'limited' ? 429 : 401,
              );
          }
          await family.removeFamilySession(tx, ownerId, guardianToken);
          const value = await family.newFamilySession(tx, ownerId, null);
          return response(headers, { guardian: true }, 200, {
            key: family.GUARDIAN_COOKIE,
            value,
            maxAge: family.GUARDIAN_SECONDS,
          });
        }
        if (action.action === 'guardian-logout') {
          await family.removeFamilySession(tx, ownerId, guardianToken);
          return response(headers, { guardian: false }, 200, {
            key: family.GUARDIAN_COOKIE,
            value: '',
            maxAge: 0,
          });
        }
        if (
          action.action === 'add-child' ||
          action.action === 'switch-child' ||
          action.action === 'reset-code' ||
          action.action === 'child-login'
        ) {
          const isGuardian = await family.hasGuardianSession(tx, ownerId, guardianToken);
          if (action.action !== 'child-login' && !isGuardian) return fail('guardian_required', 403);
          if (action.action === 'reset-code') {
            const code = await family.resetChildCode(tx, ownerId, action.childId);
            return code ? response(headers, { code }) : fail('missing', 404);
          }
          const created =
            action.action === 'add-child'
              ? await family.addChild(tx, ownerId, action.name, action.grade)
              : null;
          if (action.action === 'add-child' && !created) return fail('child_limit', 409);
          const child =
            created?.child ??
            (action.action === 'child-login'
              ? await family.childByCode(tx, ownerId, action.code)
              : action.action === 'switch-child'
                ? (await family.getChildren(tx, ownerId)).find(
                    (record) => record.id === action.childId,
                  )
                : null);
          if (!child)
            return fail(
              action.action === 'child-login' ? 'login_code' : 'missing',
              action.action === 'child-login' ? 401 : 404,
            );
          await family.removeFamilySession(tx, ownerId, childToken);
          const value = await family.newFamilySession(tx, ownerId, child.id);
          return response(headers, { child, loginCode: created?.code }, 200, {
            key: family.FAMILY_COOKIE,
            value,
            maxAge: family.CHILD_SECONDS,
          });
        }

        const child = await family.findChildSession(tx, ownerId, childToken);
        if (!child || child.id !== action.childId) return fail('session_changed', 409);
        if (action.action === 'child-logout') {
          await family.removeFamilySession(tx, ownerId, childToken);
          return response(headers, { child: null }, 200, {
            key: family.FAMILY_COOKIE,
            value: '',
            maxAge: 0,
          });
        }
        if (action.action === 'attach-thread') {
          for (const exchange of action.exchanges) {
            await family.storeStudyExchange(tx, ownerId, child.id, action.threadId, {
              ...exchange,
              sources: [],
            });
          }
          return response(headers, { attached: true });
        }
        if (action.action === 'save') {
          return (await family.saveReview(tx, ownerId, child.id, action.item))
            ? response(headers, { saved: true })
            : fail('review_limit', 409);
        }
        const result = await family.submitReview(tx, ownerId, child.id, action.itemId, action);
        if (result !== 'ok')
          return fail(result, result === 'missing' ? 404 : result === 'completed' ? 409 : 400);
        return response(headers, {
          item: await family.reviewDetail(tx, ownerId, child.id, action.itemId),
        });
      });
    } catch (error) {
      const known = ownerWriteErrorResponse(error, headers);
      if (known) return known;
      throw error;
    }
  });
}
