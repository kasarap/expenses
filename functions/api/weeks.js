function json(data, status = 200) {
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

  // KV list is paginated; iterate through all pages.
  let cursor = undefined;
  const keys = [];
  do {
    const out = await kv.list({ prefix, cursor });
    (out.keys || []).forEach(k => keys.push(k.name));
    cursor = out.list_complete ? undefined : out.cursor;
  } while (cursor);

  const entries = [];
  for (const key of keys) {
    // key format: expenses:<sync>:<weekEnding>
    const weekEnding = key.slice(prefix.length);
    let data = null;
    try { data = await kv.get(key, { type: 'json' }); } catch {}
    const bp = (data && typeof data.businessPurpose === 'string') ? data.businessPurpose : '';
    const updatedAt = (data && typeof data.updatedAt === 'string') ? data.updatedAt : '';
    entries.push({ sync, weekEnding, businessPurpose: bp, updatedAt });
  }

  // Sort newest week ending first; if same, most recently edited first.
  entries.sort((a, b) => {
    const aw = a.weekEnding || '';
    const bw = b.weekEnding || '';
    if (aw && bw && aw !== bw) return bw.localeCompare(aw); // ISO dates sort lexicographically
    const au = a.updatedAt || '';
    const bu = b.updatedAt || '';
    if (au && bu) return bu.localeCompare(au);
    if (bu) return 1;
    if (au) return -1;
    return 0;
  });

  return json({ entries });
}
