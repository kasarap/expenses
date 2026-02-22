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

  // KV list() paginates. Walk all pages so older entries always show.
  let cursor = undefined;
  const keys = [];
  while (true) {
    const page = await kv.list({ prefix: 'expenses:', cursor });
    for (const k of (page.keys || [])) {
      keys.push(k.name.replace(/^expenses:/,''));
    }
    if (!page.list_complete) {
      cursor = page.cursor;
      if (!cursor) break;
    } else {
      break;
    }
  }

  // Pull metadata from each record so we can sort by most recently edited.
  const entries = [];
  for (const sync of keys) {
    let data = null;
    try { data = await kv.get(`expenses:${sync}`, { type: 'json' }); } catch {}
    const we = (data && typeof data.weekEnding === 'string') ? data.weekEnding : '';
    const bp = (data && typeof data.businessPurpose === 'string') ? data.businessPurpose : '';
    const updatedAt = (data && typeof data.updatedAt === 'string') ? data.updatedAt : '';
    entries.push({ sync, weekEnding: we, businessPurpose: bp, updatedAt });
  }

  // Sort by updatedAt desc (most recently edited first). Fallback to weekEnding desc, then sync.
  entries.sort((a,b)=>{
    const au=a.updatedAt||'';
    const bu=b.updatedAt||'';
    if (au && bu) return bu.localeCompare(au);
    if (bu) return 1;
    if (au) return -1;
    const aw=a.weekEnding||'';
    const bw=b.weekEnding||'';
    if (aw && bw) return bw.localeCompare(aw);
    if (bw) return 1;
    if (aw) return -1;
    return String(b.sync).localeCompare(String(a.sync));
  });

  return json({ entries });
}
