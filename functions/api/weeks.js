function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function bad(msg, status=400){ return json({ error: msg }, status); }

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.EXPENSES_KV;
  if (!kv) return bad('Missing KV binding EXPENSES_KV', 500);

  const url = new URL(request.url);
  const sync = (url.searchParams.get('sync') || '').trim();
  if (!sync) return bad('Missing sync');

  const prefix = `expenses:${sync}:`;
  let cursor = undefined;
  const keys = [];

  // paginate through all keys
  for (let i=0; i<50; i++){
    const res = await kv.list({ prefix, cursor });
    for (const k of (res.keys || [])) keys.push(k.name);
    if (!res.list_complete && res.cursor) {
      cursor = res.cursor;
    } else {
      break;
    }
  }

  const entries = [];
  for (const name of keys){
    const weekEnding = name.slice(prefix.length); // YYYY-MM-DD
    let data = null;
    try { data = await kv.get(name, { type: 'json' }); } catch {}
    const bp = (data && typeof data.businessPurpose === 'string') ? data.businessPurpose : '';
    const updatedAt = (data && typeof data.updatedAt === 'string') ? data.updatedAt : '';
    entries.push({ weekEnding, businessPurpose: bp, updatedAt });
  }

  // Sort newest week ending first; tie-break by updatedAt desc
  entries.sort((a,b)=>{
    const aw=a.weekEnding||'';
    const bw=b.weekEnding||'';
    if (aw && bw && aw !== bw) return bw.localeCompare(aw);
    const au=a.updatedAt||'';
    const bu=b.updatedAt||'';
    return (bu||'').localeCompare(au||'');
  });

  return json({ sync, entries });
}
