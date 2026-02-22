function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.EXPENSES_KV;
  if (!kv) return json({ error: 'Missing KV binding EXPENSES_KV' }, 500);

  const url = new URL(request.url);
  const sync = (url.searchParams.get('sync') || '').trim();
  if (!sync) return json({ entries: [] });

  // List all entries for this sync (paginate KV list)
  let cursor = undefined;
  const keys = [];
  const prefix = `expenses:${sync}:`;
  while (true) {
    const page = await kv.list({ prefix, cursor });
    for (const k of (page.keys || [])) keys.push(k.name);
    if (!page.list_complete) {
      cursor = page.cursor;
      if (!cursor) break;
    } else {
      break;
    }
  }

  const entries = [];
  for (const fullKey of keys) {
    const weekEnding = fullKey.slice(prefix.length);
    let data = null;
    try { data = await kv.get(fullKey, { type: 'json' }); } catch {}
    const bp = (data && typeof data.businessPurpose === 'string') ? data.businessPurpose : '';
    const updatedAt = (data && typeof data.updatedAt === 'string') ? data.updatedAt : '';
    entries.push({ weekEnding, businessPurpose: bp, updatedAt });
  }

  // Sort: most recently edited first; fallback to weekEnding desc
  entries.sort((a,b)=>{
    const au=a.updatedAt||'';
    const bu=b.updatedAt||'';
    if (au && bu) return bu.localeCompare(au);
    if (bu) return 1;
    if (au) return -1;
    const aw=a.weekEnding||'';
    const bw=b.weekEnding||'';
    return bw.localeCompare(aw);
  });

  return json({ entries });
}
