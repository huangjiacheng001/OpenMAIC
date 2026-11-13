import 'server-only';

import type { TutorSource } from './protocol';

export function encyclopediaTopic(question: string): string {
  return question
    .replace(
      /^(?:请|能不能|可以|能|麻烦)?(?:帮我|给我|替我)?\s*(?:查找|查一查|查一下|查查|搜索|搜一下|找一下|找找|找|查)\s*/u,
      '',
    )
    .replace(/(?:的?(?:相关)?(?:资料|信息|百科|出处|来源)|[吗呀吧]|[？?。！!])+$/u, '')
    .trim()
    .slice(0, 100);
}

/** The public encyclopedia is a bounded fallback for general educational topics. */
export async function searchEncyclopedia(question: string, signal: AbortSignal) {
  const topic = encyclopediaTopic(question);
  if (
    !topic ||
    /最新|今年|新闻|天气|比赛|汇率|\b(?:latest|today|current|news|weather)\b/i.test(topic)
  )
    return [];
  const language = /\p{Script=Han}/u.test(topic) ? 'zh' : 'en';
  const origin = `https://${language}.wikipedia.org`;
  const url = new URL('/w/rest.php/v1/search/page', origin);
  url.searchParams.set('q', topic);
  url.searchParams.set('limit', '3');
  const response = await fetch(url, {
    headers: { 'User-Agent': 'OpenMAIC-FamilyTutor/1.0 (https://github.com/THU-MAIC/OpenMAIC)' },
    redirect: 'error',
    signal,
  });
  if (!response.ok) return [];
  const { pages } = await response.json();
  if (!Array.isArray(pages)) return [];
  return pages.slice(0, 3).flatMap((page): Array<TutorSource & { excerpt: string }> => {
    if (
      typeof page?.key !== 'string' ||
      typeof page.title !== 'string' ||
      typeof page.excerpt !== 'string'
    )
      return [];
    const excerpt = page.excerpt
      .replace(/<[^>]*>/g, '')
      .trim()
      .slice(0, 850);
    if (!excerpt) return [];
    return [
      {
        title: `${page.title.slice(0, 140)} · 维基百科`,
        href: origin + '/wiki/' + encodeURIComponent(page.key),
        kind: 'web',
        excerpt,
      },
    ];
  });
}
