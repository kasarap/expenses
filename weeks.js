
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sync = (url.searchParams.get('sync') || '').trim();
  if (!sync) return json({ weeks: [] }, 200);

  const prefix = `expenses:${sync}:`;
  let cursor = undefined;
  const weeks = [];
  while (true) {
    const page = await env.EXPENSES_KV.list({ prefix, cursor, limit: 1000 });
    for (const k of page.keys) {
      const we = k.name.slice(prefix.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(we)) continue;
      // read minimal record to get businessPurpose + updatedAt
      const rec = await env.EXPENSES_KV.get(k.name, 'json');
      weeks.push({
        weekEnding: we,
        businessPurpose: rec?.businessPurpose || rec?.data?.businessPurpose || '',
        updatedAt: rec?.updatedAt || ''
      });
    }
    if (page.list_complete) break;
    cursor = page.cursor;
    if (!cursor) break;
  }

  // sort newest weekEnding first
  weeks.sort((a,b) => (b.weekEnding || '').localeCompare(a.weekEnding || ''));

  return json({ weeks }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
