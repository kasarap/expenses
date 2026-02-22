
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
  if (!sync) return json({ error: 'Missing sync' }, 400);

  const prefix = `expenses:${sync}:`;
  let cursor = undefined;
  const keys = [];

  // paginate
  for (let i=0; i<50; i++){
    const res = await kv.list({ prefix, cursor });
    for (const k of (res.keys || [])) keys.push(k.name);
    if (!res.list_complete && res.cursor){
      cursor = res.cursor;
    } else {
      break;
    }
  }

  const entries = [];
  for (const name of keys){
    const weekEnding = name.slice(prefix.length);
    let rec = null;
    try { rec = await kv.get(name, { type: 'json' }); } catch {}
    const updatedAt = rec && typeof rec.updatedAt === 'string' ? rec.updatedAt : '';
    const businessPurpose = rec && typeof rec.businessPurpose === 'string' ? rec.businessPurpose : '';
    const fileBase = rec && typeof rec.fileBase === 'string' ? rec.fileBase : '';
    entries.push({ weekEnding, updatedAt, businessPurpose, fileBase, sync });
  }

  // sort newest week ending first; tiebreaker updatedAt desc
  entries.sort((a,b)=>{
    const aw = a.weekEnding || '';
    const bw = b.weekEnding || '';
    if (aw && bw && aw !== bw) return bw.localeCompare(aw);
    const au = a.updatedAt || '';
    const bu = b.updatedAt || '';
    return (bu || '').localeCompare(au || '');
  });

  return json({ entries });
}
