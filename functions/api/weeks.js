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

  const prefix = `expenses:${sync}:`;

  // KV list is paginated — walk all pages.
  let cursor = undefined;
  const keys = [];
  for (let i=0; i<100; i++){ // hard cap safety
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    (page.keys || []).forEach(k => keys.push(k.name));
    cursor = page.cursor;
    if (!cursor) break;
  }

  const entries = [];
  for (const key of keys) {
    // key = expenses:<sync>:<weekEnding>
    const weekEnding = key.slice(prefix.length);
    let data = null;
    try { data = await kv.get(key, { type: 'json' }); } catch {}
    const bp = (data && typeof data.businessPurpose === 'string') ? data.businessPurpose : '';
    const updatedAt = (data && typeof data.updatedAt === 'string') ? data.updatedAt : '';
    entries.push({ weekEnding, businessPurpose: bp, updatedAt });
  }

  // Sort newest week ending first (YYYY-MM-DD sorts lexicographically).
  entries.sort((a,b)=> String(b.weekEnding||'').localeCompare(String(a.weekEnding||'')));

  return json({ sync, entries });
}