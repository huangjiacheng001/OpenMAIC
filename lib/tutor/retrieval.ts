import 'server-only';
import { listOwnerLibrary } from '@/lib/persistence/session-material-links';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { readOwnerMaterialText } from '@/lib/server/materials/owner-material-text';
import { searchEncyclopedia } from './encyclopedia';
import type { TutorSource } from './protocol';

type Evidence = TutorSource & { excerpt: string };

const BOOK = /教材|课本|讲义|我的资料|这[本份篇]书|材料库|textbook|my (?:notes|materials)/i;
const WEB =
  /联网|网上查|上网查|搜索|帮我查|查(?:一下|资料|一查)|搜(?:一下|一搜|一查)|找(?:一下|一找)?(?:资料|来源|出处)|核实|来源|出处|最新|现在.{0,12}(?:多少|怎么样|如何|价格)|今年.{0,8}(?:多少|新|变化)|今日新闻|今天.{0,6}(?:天气|新闻|比赛|汇率)|近[几一两三]年|look up|search (?:for|the web)|latest|current (?:news|weather)|cite (?:your|the) sources/i;

export function sourceIntent(question: string): 'material' | 'web' | null {
  if (BOOK.test(question)) return 'material';
  return WEB.test(question) ? 'web' : null;
}

export function bestExcerpt(text: string, question: string): { excerpt: string; score: number } {
  const subject = question
    .slice(0, 200)
    .replace(BOOK, '')
    .replace(/第[一二三四五六七八九十\d]+[课章节页]/g, '');
  const chunks = subject.toLowerCase().match(/[a-z0-9]{2,}|[\p{Script=Han}]+/gu) ?? [];
  const terms = new Set<string>();
  for (const chunk of chunks) {
    if (!/\p{Script=Han}/u.test(chunk)) {
      terms.add(chunk);
      continue;
    }
    for (let index = 0; index < chunk.length - 1; index++) {
      const term = chunk.slice(index, index + 2);
      if (
        !/^(帮我|我的|什么|怎么|如何|一下|请问|里面|上面|这道|这题|一下|用的|一讲|能不|不能|以帮)$/.test(
          term,
        )
      )
        terms.add(term);
    }
  }
  let best = { excerpt: '', score: 0 };
  for (let offset = 0; offset < Math.min(text.length, 400_000); offset += 500) {
    const excerpt = text.slice(offset, offset + 850);
    const lower = excerpt.toLowerCase();
    let score = 0;
    for (const term of terms) if (lower.includes(term)) score++;
    if (score > best.score) best = { excerpt: excerpt.trim(), score };
  }
  return best;
}

export async function findMaterial(
  workspaceId: string,
  question: string,
  signal: AbortSignal,
): Promise<Evidence[]> {
  const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  const materials = await listOwnerLibrary(pool, workspaceId, {
    withTextOnly: true,
    sourcesOnly: true,
    limit: 6,
  });
  signal.throwIfAborted();
  const candidates = await Promise.allSettled(
    materials.map(async (material) => {
      const document = await readOwnerMaterialText(material, signal);
      if (!document) return null;
      const title = material.displayName || material.originalName || '学习资料';
      const best = bestExcerpt(document.text, question);
      const named = title.length >= 2 && question.includes(title.replace(/\.[\da-z]+$/i, ''));
      if (!named && best.score < 2) return null;
      return {
        ...best,
        score: best.score + (named ? 10 : 0),
        excerpt: best.excerpt || document.text.trim().slice(0, 850),
        title,
        kind: 'material' as const,
        href: `/api/materials/${encodeURIComponent(material.id)}/original`,
      };
    }),
  );
  return candidates
    .flatMap((item) => (item.status === 'fulfilled' && item.value?.excerpt ? [item.value] : []))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

export async function findWeb(
  workspaceId: string | null,
  question: string,
  signal: AbortSignal,
): Promise<Evidence[]> {
  const [{ resolveClassroomWebSearchConfig }, { searchWeb }] = await Promise.all([
    import('@/lib/server/web-search-config'),
    import('@/lib/web-search'),
  ]);
  const config = await resolveClassroomWebSearchConfig(workspaceId);
  if (!config) return searchEncyclopedia(question, signal);
  signal.throwIfAborted();
  const result = await searchWeb({
    ...config,
    query: question.slice(0, 400),
    signal,
    maxResults: 4,
  });
  return result.sources.flatMap(({ title, url, content }) => {
    if (!title || !content || !URL.canParse(url)) return [];
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      return [];
    return [
      {
        title: title.slice(0, 160),
        href: parsed.href,
        kind: 'web',
        excerpt: content.slice(0, 850),
      },
    ];
  });
}
