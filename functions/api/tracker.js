// /api/tracker
// Stores Payment Tracker sent/paid dates + prev-year amounts in KV.
// Key: tracker:{sync}
// Value: { data: {...}, updatedAt }
//
// GET  ?sync=  -> { data, updatedAt }
// PUT  ?sync=  -> body: { data }  -> { ok:true, updatedAt }

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sync = (url.searchParams.get('sync') || '').trim();
  if (!sync) return json({ error: 'Missing sync' }, 400);

  const key = `tracker:${sync}`;

  if (request.method === 'GET') {
    const val = await env.EXPENSES_KV.get(key, 'json');
    return json({ data: val?.data || null, updatedAt: val?.updatedAt || null }, 200);
  }

  if (request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.data !== 'object') return json({ error: 'Invalid body' }, 400);
    const updatedAt = new Date().toISOString();
    await env.EXPENSES_KV.put(key, JSON.stringify({ data: body.data, updatedAt }));
    return json({ ok: true, updatedAt }, 200);
  }

  return json({ error: 'Method not allowed' }, 405);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
