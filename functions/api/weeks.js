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

  const list = await kv.list({ prefix: 'expenses:' });
  const keys = (list.keys || []).map(k => k.name.replace(/^expenses:/,''));

  // Pull weekEnding metadata from each record so we can sort newest-first even if sync names are arbitrary.
  const entries = [];
  for (const sync of keys) {
    let data = null;
    try { data = await kv.get(`expenses:${sync}`, { type: 'json' }); } catch {}
    const we = (data && typeof data.weekEnding === 'string') ? data.weekEnding : '';
    entries.push({ sync, weekEnding: we });
  }

  // Sort by weekEnding (ISO) desc (newest first). If missing, sort by sync desc.
  entries.sort((a,b)=>{
    const aw=a.weekEnding||'';
    const bw=b.weekEnding||'';
    if (aw && bw) return bw.localeCompare(aw);
    if (bw) return 1;
    if (aw) return -1;
    return String(b.sync).localeCompare(String(a.sync));
  });

  return json({ entries });
}
