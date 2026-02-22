function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function listAllKeys(kv, prefix) {
  const out = [];
  let cursor = undefined;
  while (true) {
    const res = await kv.list({ prefix, cursor });
    if (res?.keys?.length) out.push(...res.keys);
    if (res?.list_complete) break;
    cursor = res?.cursor;
    if (!cursor) break;
  }
  return out;
}

export async function onRequest(context) {
  const { env } = context;
  const kv = env.EXPENSES_KV;
  if (!kv) return json({ error: 'Missing KV binding EXPENSES_KV' }, 500);

  const keys = await listAllKeys(kv, 'expenses:');
  const syncs = keys.map(k => k.name.replace(/^expenses:/,''));

  // Pull metadata from each record so we can sort and label.
  const entries = [];
  for (const sync of syncs) {
    let data = null;
    try { data = await kv.get(`expenses:${sync}`, { type: 'json' }); } catch {}
    const we = (data && typeof data.weekEnding === 'string') ? data.weekEnding : '';
    const bp = (data && typeof data.businessPurpose === 'string') ? data.businessPurpose : '';
    const updatedAt = (data && typeof data.updatedAt === 'string') ? data.updatedAt : '';
    entries.push({ sync, weekEnding: we, businessPurpose: bp, updatedAt });
  }

  // Sort: newest week ending first; fallback to updatedAt desc; then sync.
  entries.sort((a,b)=>{
    const aw=a.weekEnding||'';
    const bw=b.weekEnding||'';
    if (aw && bw && aw !== bw) return bw.localeCompare(aw); // ISO yyyy-mm-dd sorts lexicographically
    const au=a.updatedAt||'';
    const bu=b.updatedAt||'';
    if (au && bu && au !== bu) return bu.localeCompare(au);
    if (bu && !au) return 1;
    if (au && !bu) return -1;
    return String(b.sync).localeCompare(String(a.sync));
  });

  return json({ entries });
}
