function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function parseId(id) {
  // Preferred format: YYYY-MM-DD__Sync Name
  const m = id.match(/^(\d{4}-\d{2}-\d{2})__(.+)$/);
  if (m) return { weekEnding: m[1], syncName: m[2] };
  return { weekEnding: '', syncName: id };
}

export async function onRequest(context) {
  const { env } = context;
  const kv = env.EXPENSES_KV;
  if (!kv) return json({ error: 'Missing KV binding EXPENSES_KV' }, 500);

  // KV list() paginates
  let cursor = undefined;
  const ids = [];
  while (true) {
    const page = await kv.list({ prefix: 'expenses:', cursor });
    for (const k of (page.keys || [])) ids.push(k.name.replace(/^expenses:/,''));
    if (!page.list_complete && page.cursor) cursor = page.cursor;
    else break;
  }

  const entries = [];
  for (const id of ids) {
    let data = null;
    try { data = await kv.get(`expenses:${id}`, { type: 'json' }); } catch {}
    const parsed = parseId(id);
    const weekEnding = (data && typeof data.weekEnding === 'string' && data.weekEnding) ? data.weekEnding : parsed.weekEnding;
    const syncName = (data && typeof data.syncName === 'string' && data.syncName) ? data.syncName : parsed.syncName;
    const businessPurpose = (data && typeof data.businessPurpose === 'string') ? data.businessPurpose : '';
    const updatedAt = (data && typeof data.updatedAt === 'string') ? data.updatedAt : '';
    entries.push({ id, weekEnding, syncName, businessPurpose, updatedAt });
  }

  // Sort by weekEnding desc (newest week at top). Tie-break by updatedAt desc.
  entries.sort((a,b)=>{
    const aw=a.weekEnding||'';
    const bw=b.weekEnding||'';
    if (aw && bw && aw !== bw) return bw.localeCompare(aw);
    if (bw && !aw) return 1;
    if (aw && !bw) return -1;
    const au=a.updatedAt||'';
    const bu=b.updatedAt||'';
    if (au && bu && au !== bu) return bu.localeCompare(au);
    if (bu && !au) return 1;
    if (au && !bu) return -1;
    return String(a.id).localeCompare(String(b.id));
  });

  return json({ entries });
}
