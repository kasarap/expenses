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
  const weekEnding = (url.searchParams.get('weekEnding') || '').trim(); // YYYY-MM-DD
  if (!sync) return bad('Missing sync');
  if (!weekEnding) return bad('Missing weekEnding');

  const key = `expenses:${sync}:${weekEnding}`;
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    const data = await kv.get(key, { type: 'json' });
    return json({ ok:true, sync, weekEnding, data: data || null });
  }

  if (method === 'PUT' || method === 'POST') {
    let body;
    try { body = await request.json(); }
    catch { return bad('Invalid JSON'); }
    const now = new Date().toISOString();

    let existing = null;
    try { existing = await kv.get(key, { type: 'json' }); } catch {}

    const createdAt = existing?.createdAt || now;
    const payload = {
      ...(body || {}),
      syncName: sync,
      weekEnding,
      createdAt,
      updatedAt: now,
    };

    await kv.put(key, JSON.stringify(payload));
    return json({ ok:true });
  }

  if (method === 'DELETE') {
    await kv.delete(key);
    return json({ ok:true });
  }

  return bad('Method not allowed', 405);
}
