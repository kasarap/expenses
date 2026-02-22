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
  const entries = [];
  while (true) {
    const res = await kv.list({ prefix, cursor, limit: 1000 });
    for (const k of res.keys) {
      const name = k.name; // expenses:sync:YYYY-MM-DD
      const weekEnding = name.substring(prefix.length);
      // read minimal metadata
      let obj = null;
      try { obj = await kv.get(name, { type:'json' }); } catch {}
      entries.push({
        key: name,
        weekEnding,
        updatedAt: obj?.updatedAt || null,
        businessPurpose: obj?.businessPurpose || obj?.businessPurposeOfExpenses || '',
      });
    }
    cursor = res.cursor;
    if (!res.list_complete) continue;
    break;
  }

  // sort newest weekEnding first
  entries.sort((a,b)=> (b.weekEnding || '').localeCompare(a.weekEnding || ''));
  return json({ ok:true, sync, entries });
}
