import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Queryable } from '@openmaic/storage/document/pg';
import { applySchemaMigrations } from '@openmaic/storage/pg-migrations';
import {
  compareHomeworkFractions,
  type ChildProfile,
  type HomeworkExchange,
  type ReviewAttempt,
  type ReviewItem,
  type ReviewSummary,
  type StudyThread,
} from '@/lib/tutor/family';

export const FAMILY_COOKIE = 'openmaic_family_child';
export const GUARDIAN_COOKIE = 'openmaic_family_guardian';
export const CHILD_SECONDS = 30 * 86400;
export const GUARDIAN_SECONDS = 8 * 3600;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = promisify(scrypt);

export function ensureFamilyLearningSchema(db: Queryable) {
  return applySchemaMigrations(db, {
    store: 'family-learning',
    migrations: [
      {
        version: 1,
        name: 'homework-review',
        transaction: true,
        up: `
CREATE TABLE family_guardians (
  owner_id TEXT PRIMARY KEY, password TEXT NOT NULL
);
CREATE TABLE family_children (
  owner_id TEXT NOT NULL REFERENCES family_guardians(owner_id) ON DELETE CASCADE,
  id UUID NOT NULL, name TEXT NOT NULL, grade TEXT NOT NULL, code_hash TEXT NOT NULL,
  PRIMARY KEY (owner_id,id), UNIQUE (owner_id,code_hash)
);
CREATE TABLE family_learning_sessions (
  owner_id TEXT NOT NULL REFERENCES family_guardians(owner_id) ON DELETE CASCADE,
  token_hash TEXT PRIMARY KEY, child_id UUID, expires_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (owner_id,child_id) REFERENCES family_children(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX family_learning_session_expiry ON family_learning_sessions(owner_id,expires_at);
CREATE TABLE family_learning_threads (
  owner_id TEXT NOT NULL, child_id UUID NOT NULL, id UUID NOT NULL, title TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (owner_id,child_id,id),
  FOREIGN KEY (owner_id,child_id) REFERENCES family_children(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX family_learning_thread_recent ON family_learning_threads(owner_id,child_id,updated_at DESC);
CREATE TABLE family_learning_exchanges (
  owner_id TEXT NOT NULL, child_id UUID NOT NULL, thread_id UUID NOT NULL, id UUID NOT NULL,
  exchange JSONB NOT NULL, position BIGINT GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (owner_id,child_id,thread_id,id),
  FOREIGN KEY (owner_id,child_id,thread_id) REFERENCES family_learning_threads(owner_id,child_id,id) ON DELETE CASCADE
);
CREATE INDEX family_learning_exchange_order ON family_learning_exchanges(owner_id,child_id,thread_id,position);
CREATE TABLE family_learning_reviews (
  owner_id TEXT NOT NULL, child_id UUID NOT NULL, id UUID NOT NULL,
  thread_id UUID, problem TEXT NOT NULL, explanation TEXT NOT NULL, photo TEXT,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ,
  PRIMARY KEY (owner_id,child_id,id),
  FOREIGN KEY (owner_id,child_id) REFERENCES family_children(owner_id,id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id,child_id,thread_id) REFERENCES family_learning_threads(owner_id,child_id,id)
);
CREATE INDEX family_learning_review_recent ON family_learning_reviews(owner_id,child_id,saved_at DESC);
CREATE TABLE family_learning_attempts (
  owner_id TEXT NOT NULL, child_id UUID NOT NULL, item_id UUID NOT NULL, id UUID NOT NULL,
  answer TEXT NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('correct','incorrect','self_correct','self_retry')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id,child_id,item_id,id),
  FOREIGN KEY (owner_id,child_id,item_id) REFERENCES family_learning_reviews(owner_id,child_id,id) ON DELETE CASCADE
);
CREATE INDEX family_learning_attempt_recent ON family_learning_attempts(owner_id,child_id,submitted_at DESC);
CREATE TABLE family_guardian_failures (
  owner_id TEXT PRIMARY KEY REFERENCES family_guardians(owner_id) ON DELETE CASCADE,
  count INTEGER NOT NULL, window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
      },
    ],
  });
}

export async function guardianExists(db: Queryable, owner: string) {
  return Boolean(
    (await db.query('SELECT 1 FROM family_guardians WHERE owner_id=$1', [owner])).rows.length,
  );
}

export async function createGuardian(db: Queryable, owner: string, password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await derive(password, salt, 64)) as Buffer;
  const result = await db.query(
    'INSERT INTO family_guardians(owner_id,password) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING owner_id',
    [owner, salt + ':' + key.toString('hex')],
  );
  return Boolean(result.rows.length);
}

export async function verifyGuardian(db: Queryable, owner: string, password: string) {
  // Serialize attempts for this owner, including failed attempts across devices.
  const { rows } = await db.query<{ password: string }>(
    'SELECT password FROM family_guardians WHERE owner_id=$1 FOR UPDATE',
    [owner],
  );
  if (!rows[0]) return 'invalid';
  const failures = await db.query(
    "SELECT 1 FROM family_guardian_failures WHERE owner_id=$1 AND count>=8 AND window_start>now()-interval '15 minutes'",
    [owner],
  );
  if (failures.rows.length) return 'limited';
  const [salt, key] = rows[0].password.split(':');
  const valid = timingSafeEqual(
    Buffer.from(key, 'hex'),
    (await derive(password, salt, 64)) as Buffer,
  );
  if (valid) await db.query('DELETE FROM family_guardian_failures WHERE owner_id=$1', [owner]);
  else
    await db.query(
      `INSERT INTO family_guardian_failures(owner_id,count) VALUES ($1,1)
      ON CONFLICT(owner_id) DO UPDATE SET
      count=CASE WHEN family_guardian_failures.window_start<=now()-interval '15 minutes' THEN 1 ELSE family_guardian_failures.count+1 END,
      window_start=CASE WHEN family_guardian_failures.window_start<=now()-interval '15 minutes' THEN now() ELSE family_guardian_failures.window_start END`,
      [owner],
    );
  return valid ? 'ok' : 'invalid';
}

export async function getChildren(db: Queryable, owner: string) {
  return (
    await db.query<ChildProfile>(
      'SELECT id,name,grade FROM family_children WHERE owner_id=$1 ORDER BY name,id',
      [owner],
    )
  ).rows;
}

export async function addChild(db: Queryable, owner: string, name: string, grade: string) {
  await db.query('SELECT 1 FROM family_guardians WHERE owner_id=$1 FOR UPDATE', [owner]);
  const child = { id: randomUUID(), name, grade };
  const code = randomBytes(12).toString('hex');
  const { rows } = await db.query(
    `INSERT INTO family_children(owner_id,id,name,grade,code_hash) SELECT $1,$2,$3,$4,$5
     WHERE (SELECT count(*) FROM family_children WHERE owner_id=$1)<16 RETURNING id`,
    [owner, child.id, name, grade, hash(code)],
  );
  return rows.length ? { child, code: code.match(/.{6}/g)?.join('-') ?? code } : null;
}

export async function resetChildCode(db: Queryable, owner: string, childId: string) {
  const code = randomBytes(12).toString('hex');
  const { rows } = await db.query(
    'UPDATE family_children SET code_hash=$3 WHERE owner_id=$1 AND id=$2 RETURNING id',
    [owner, childId, hash(code)],
  );
  if (!rows.length) return null;
  await db.query('DELETE FROM family_learning_sessions WHERE owner_id=$1 AND child_id=$2', [
    owner,
    childId,
  ]);
  return code.match(/.{6}/g)?.join('-') ?? code;
}

export async function childByCode(db: Queryable, owner: string, code: string) {
  return (
    await db.query<ChildProfile>(
      'SELECT id,name,grade FROM family_children WHERE owner_id=$1 AND code_hash=$2 FOR SHARE',
      [owner, hash(code)],
    )
  ).rows[0];
}

export async function newFamilySession(db: Queryable, owner: string, child: string | null) {
  const token = randomBytes(32).toString('hex');
  await db.query('DELETE FROM family_learning_sessions WHERE owner_id=$1 AND expires_at<=now()', [
    owner,
  ]);
  await db.query(
    "INSERT INTO family_learning_sessions(owner_id,child_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+$4*interval '1 second')",
    [owner, child, hash(token), child ? CHILD_SECONDS : GUARDIAN_SECONDS],
  );
  return token;
}

export async function removeFamilySession(db: Queryable, owner: string, token: string | undefined) {
  if (token)
    await db.query('DELETE FROM family_learning_sessions WHERE owner_id=$1 AND token_hash=$2', [
      owner,
      hash(token),
    ]);
}

export async function findChildSession(db: Queryable, owner: string, token: string | undefined) {
  if (!token) return null;
  return (
    (
      await db.query<ChildProfile>(
        `SELECT c.id,c.name,c.grade FROM family_learning_sessions s
     JOIN family_children c ON (c.owner_id,c.id)=(s.owner_id,s.child_id)
     WHERE s.owner_id=$1 AND s.token_hash=$2 AND s.expires_at>now()`,
        [owner, hash(token)],
      )
    ).rows[0] ?? null
  );
}

export async function hasGuardianSession(db: Queryable, owner: string, token: string | undefined) {
  if (!token) return false;
  return Boolean(
    (
      await db.query(
        'SELECT 1 FROM family_learning_sessions WHERE owner_id=$1 AND token_hash=$2 AND child_id IS NULL AND expires_at>now()',
        [owner, hash(token)],
      )
    ).rows.length,
  );
}

export function validFamilyToken(value?: string) {
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export async function latestStudyThreads(db: Queryable, owner: string, child: string) {
  return (
    await db.query<StudyThread>(
      `SELECT id,title,updated_at AS "updatedAt" FROM family_learning_threads
     WHERE owner_id=$1 AND child_id=$2 ORDER BY updated_at DESC,id DESC LIMIT 25`,
      [owner, child],
    )
  ).rows;
}

export async function getStudyThread(db: Queryable, owner: string, child: string, thread: string) {
  const { rows } = await db.query<{ exchange: HomeworkExchange }>(
    `SELECT exchange FROM (
       SELECT exchange,position FROM family_learning_exchanges WHERE owner_id=$1 AND child_id=$2 AND thread_id=$3
       ORDER BY position DESC LIMIT 80
     ) recent ORDER BY position`,
    [owner, child, thread],
  );
  return rows.map((row) => row.exchange);
}

export async function storeStudyExchange(
  db: Queryable,
  owner: string,
  child: string,
  thread: string,
  exchange: HomeworkExchange,
) {
  await db.query(
    `INSERT INTO family_learning_threads(owner_id,child_id,id,title) VALUES ($1,$2,$3,$4)
     ON CONFLICT(owner_id,child_id,id) DO UPDATE SET updated_at=now(),
     title=CASE WHEN family_learning_threads.title='照片作业' AND $5 THEN EXCLUDED.title ELSE family_learning_threads.title END`,
    [
      owner,
      child,
      thread,
      (exchange.problem || exchange.question || '照片作业').slice(0, 100),
      Boolean(exchange.problem),
    ],
  );
  await db.query(
    `INSERT INTO family_learning_exchanges(owner_id,child_id,thread_id,id,exchange) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT DO NOTHING`,
    [owner, child, thread, exchange.id, JSON.stringify(exchange)],
  );
}

const summaryFields = `r.id,r.problem,r.thread_id AS "threadId",r.saved_at AS "savedAt",
  r.completed_at AS "completedAt", (SELECT count(*)::int FROM family_learning_attempts a
    WHERE (a.owner_id,a.child_id,a.item_id)=(r.owner_id,r.child_id,r.id)) AS attempts`;

export async function listReviews(
  db: Queryable,
  owner: string,
  child: string,
  completed?: boolean,
) {
  return (
    await db.query<ReviewSummary>(
      `SELECT ${summaryFields} FROM family_learning_reviews r WHERE r.owner_id=$1 AND r.child_id=$2
     AND ($3::boolean IS NULL OR (r.completed_at IS NOT NULL)=$3)
     ORDER BY COALESCE(r.completed_at,r.saved_at) DESC,r.id DESC LIMIT 250`,
      [owner, child, completed ?? null],
    )
  ).rows;
}

export async function familyCounts(db: Queryable, owner: string, child: string) {
  return (
    await db.query<{ due: number; done: number }>(
      `SELECT count(*) FILTER (WHERE completed_at IS NULL)::int AS due,
            count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS done
     FROM family_learning_reviews WHERE owner_id=$1 AND child_id=$2`,
      [owner, child],
    )
  ).rows[0];
}

export async function reviewDetail(db: Queryable, owner: string, child: string, id: string) {
  const { rows } = await db.query<ReviewSummary & { photo: string | null; explanation: string }>(
    `SELECT ${summaryFields},r.photo,r.explanation FROM family_learning_reviews r
     WHERE (r.owner_id,r.child_id,r.id)=($1,$2,$3)`,
    [owner, child, id],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const { rows: attemptsList } = await db.query<ReviewAttempt>(
    `SELECT id,answer,outcome,submitted_at AS "submittedAt" FROM family_learning_attempts
     WHERE (owner_id,child_id,item_id)=($1,$2,$3) ORDER BY submitted_at DESC,id DESC LIMIT 100`,
    [owner, child, id],
  );
  return {
    ...row,
    attemptsList,
    checkable: compareHomeworkFractions(row.problem) !== null,
    explanation: attemptsList.length ? row.explanation : null,
  } satisfies ReviewItem;
}

export async function saveReview(
  db: Queryable,
  owner: string,
  child: string,
  input: {
    id: string;
    threadId?: string;
    problem: string;
    explanation: string;
    photo?: string;
  },
) {
  await db.query('SELECT 1 FROM family_children WHERE owner_id=$1 AND id=$2 FOR UPDATE', [
    owner,
    child,
  ]);
  const existing = await db.query(
    'SELECT 1 FROM family_learning_reviews WHERE owner_id=$1 AND child_id=$2 AND id=$3',
    [owner, child, input.id],
  );
  if (existing.rows.length) return true;
  const { rows } = await db.query(
    `INSERT INTO family_learning_reviews(owner_id,child_id,id,thread_id,problem,explanation,photo)
     SELECT $1,$2,$3, (SELECT id FROM family_learning_threads WHERE owner_id=$1 AND child_id=$2 AND id=$4),
     $5,$6,$7 WHERE (SELECT count(*) FROM family_learning_reviews WHERE owner_id=$1 AND child_id=$2)<250 RETURNING id`,
    [
      owner,
      child,
      input.id,
      input.threadId ?? null,
      input.problem,
      input.explanation,
      input.photo ?? null,
    ],
  );
  return Boolean(rows.length);
}

export async function submitReview(
  db: Queryable,
  owner: string,
  child: string,
  item: string,
  input: {
    id: string;
    answer: string;
    self?: 'correct' | 'retry';
  },
) {
  const {
    rows: [review],
  } = await db.query<{ problem: string; completed_at: Date | null }>(
    'SELECT problem,completed_at FROM family_learning_reviews WHERE (owner_id,child_id,id)=($1,$2,$3) FOR UPDATE',
    [owner, child, item],
  );
  if (!review) return 'missing';
  const old = await db.query<{ answer: string; outcome: ReviewAttempt['outcome'] }>(
    'SELECT answer,outcome FROM family_learning_attempts WHERE (owner_id,child_id,item_id,id)=($1,$2,$3,$4)',
    [owner, child, item, input.id],
  );
  const expected = compareHomeworkFractions(review.problem);
  let outcome: ReviewAttempt['outcome'];
  if (expected) {
    if (input.self || !['<', '=', '>'].includes(input.answer)) return 'invalid';
    outcome = input.answer === expected ? 'correct' : 'incorrect';
  } else {
    if (input.self) {
      if (
        !old.rows[0] ||
        old.rows[0].answer !== input.answer ||
        old.rows[0].outcome === 'self_correct'
      ) {
        return old.rows[0]?.outcome === 'self_correct' &&
          old.rows[0].answer === input.answer &&
          input.self === 'correct'
          ? 'ok'
          : 'invalid';
      }
      outcome = input.self === 'correct' ? 'self_correct' : 'self_retry';
      await db.query(
        'UPDATE family_learning_attempts SET outcome=$5 WHERE (owner_id,child_id,item_id,id)=($1,$2,$3,$4)',
        [owner, child, item, input.id, outcome],
      );
    } else outcome = 'self_retry';
  }
  if (!input.self && old.rows[0]) return old.rows[0].answer === input.answer ? 'ok' : 'invalid';
  if (!input.self) {
    if (review.completed_at) return 'completed';
    await db.query(
      'INSERT INTO family_learning_attempts(owner_id,child_id,item_id,id,answer,outcome) VALUES ($1,$2,$3,$4,$5,$6)',
      [owner, child, item, input.id, input.answer, outcome],
    );
  }
  if (outcome === 'correct' || outcome === 'self_correct')
    await db.query(
      'UPDATE family_learning_reviews SET completed_at=COALESCE(completed_at,now()) WHERE (owner_id,child_id,id)=($1,$2,$3)',
      [owner, child, item],
    );
  return 'ok';
}

export async function reviewActivity(db: Queryable, owner: string, child: string) {
  return (
    await db.query<{
      itemId: string;
      problem: string;
      time: string;
      outcome: ReviewAttempt['outcome'] | 'saved';
    }>(
      `SELECT * FROM (
       SELECT r.id AS "itemId",r.problem,r.saved_at AS time,'saved' AS outcome
         FROM family_learning_reviews r WHERE r.owner_id=$1 AND r.child_id=$2
       UNION ALL
       SELECT r.id,r.problem,a.submitted_at,a.outcome
         FROM family_learning_attempts a JOIN family_learning_reviews r
         ON (r.owner_id,r.child_id,r.id)=(a.owner_id,a.child_id,a.item_id)
         WHERE a.owner_id=$1 AND a.child_id=$2
     ) events ORDER BY time DESC,"itemId" DESC LIMIT 40`,
      [owner, child],
    )
  ).rows;
}
