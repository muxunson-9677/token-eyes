import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('uses the public official profile when third-party discovery requires authentication', async () => {
  const { collectResetAnnouncements } = await import('./codex-reset-collector');
  const id = '2098685367058612394';
  const url = `https://x.com/thsottiaux/status/${id}`;
  const text = 'Codex usage limits have been reset.';
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (init?.redirect === 'error') throw new Error('Worker does not support redirect:error');
    const target = String(input);
    if (target.startsWith('https://api.fxtwitter.com/')) return new Response('auth required', {status:401});
    if (target === 'https://x.com/thsottiaux') return new Response(`<link rel="canonical" href="https://x.com/thsottiaux"><a href="/thsottiaux/status/${id}">post</a>`);
    if (target.startsWith('https://publish.x.com/')) return Response.json({url,author_url:'https://x.com/thsottiaux',provider_name:'X',html:`<p>${text}</p>`});
    if (target === url) return new Response(`<link rel="canonical" href="${url}"><div dir="auto"><span>${text}</span></div>`);
    throw new Error('unexpected URL');
  }));
  const rows = await collectResetAnnouncements([], Date.parse('2026-09-12T14:00:00Z'));
  expect(rows[0]?.source_post_id).toBe(id);
});

it('restores the credential-free collector and recognizes propagated confirmations', async () => {
  const module = await import('./codex-reset-collector');
  const candidate = module.tiboCandidate({
    url: 'https://x.com/thsottiaux/status/2098685367058612394',
    text: 'Reset all propagated. Sweet dreams.',
    author: { screen_name: 'thsottiaux', url: 'https://x.com/thsottiaux' },
  }, Date.parse('2026-09-12T14:00:00Z'));
  expect(candidate?.state).toBe('confirmed');
  expect(candidate?.hasCodexContext).toBe(false);
  expect(module.correlateTiboResetPosts([candidate!])).toEqual([]);
});

it('rejects discovery failures instead of returning a freshly dated old feed', async () => {
  const { collectResetAnnouncements } = await import('./codex-reset-collector');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));
  await expect(collectResetAnnouncements([], Date.now())).rejects.toThrow();
});

it('continues past four ordinary posts on the next scan without marking the first scan complete', async () => {
  const { collectResetAnnouncements } = await import('./codex-reset-collector');
  const ids = ['2098685367058612399','2098685367058612398','2098685367058612397','2098685367058612396','2098685367058612394'];
  const scan = {checkedPostIds:[] as string[],complete:true};
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const target = String(input);
    if (target.startsWith('https://api.fxtwitter.com/')) return new Response('auth',{status:401});
    if (target === 'https://x.com/thsottiaux') return new Response('<link rel="canonical" href="https://x.com/thsottiaux">' + ids.map(id=>`<a href="/thsottiaux/status/${id}">post</a>`).join(''));
    const url = target.startsWith('https://publish.x.com/') ? new URL(target).searchParams.get('url')! : target;
    const text = url.endsWith(ids[4]) ? 'Codex usage limits have been reset.' : 'Ordinary update.';
    if (target.startsWith('https://publish.x.com/')) return Response.json({url,author_url:'https://x.com/thsottiaux',provider_name:'X',html:`<p>${text}</p>`});
    return new Response(`<link rel="canonical" href="${url}"><div dir="auto"><span>${text}</span></div>`);
  }));
  expect(await collectResetAnnouncements([], Date.parse('2026-09-12T14:00:00Z'), scan)).toEqual([]);
  expect(scan.complete).toBe(false);
  const rows = await collectResetAnnouncements([], Date.parse('2026-09-12T14:00:00Z'), scan);
  expect(rows[0]?.source_post_id).toBe(ids[4]);
  expect(scan.complete).toBe(true);
});

it('correlates the current quoted rollout without treating a scheduled reset as completed', async () => {
  const { tiboCandidate, correlateTiboResetPosts, extractXPagePostText } = await import('./codex-reset-collector');
  const now = Date.parse('2026-09-12T14:00:00Z');
  const post = (id: string, text: string, quote?: string) => tiboCandidate({
    url: `https://x.com/thsottiaux/status/${id}`, text,
    author: { screen_name: 'thsottiaux', url: 'https://x.com/thsottiaux' },
    quote: quote ? { id: quote } : null,
  }, now)!;
  const scheduled = post('2098612714704891959', 'Hi Astra users. A reset is also landing by midnight today.');
  const confirmed = post('2098685367058612394', 'Reset all propagated. Sweet dreams.', '2098612714704891959');
  expect(correlateTiboResetPosts([scheduled, confirmed])).toHaveLength(1);
  const url = 'https://x.com/thsottiaux/status/2098685367058612394';
  const html = `<link rel="canonical" href="${url}"><div dir="auto"><span>Reset all propagated. Sweet dreams.</span></div>`;
  expect(extractXPagePostText(html, url)).toBe('Reset all propagated. Sweet dreams.');
  expect(extractXPagePostText(html, url + '1')).toBeNull();
});
