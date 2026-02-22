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
  const weekEnding = (url.searchParams.get('weekEnding') || '').trim();
  if (!sync) return json({ error: 'Missing sync' }, 400);
  if (!weekEnding) return json({ error: 'Missing weekEnding' }, 400);

  const key = `expenses:${sync}:${weekEnding}`;
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    const data = await kv.get(key, { type: 'json' });
    return json({ sync, weekEnding, data: data || null });
  }

  if (method === 'PUT' || method === 'POST') {
    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400); }
    const now = new Date().toISOString();
    let existing = null;
    try { existing = await kv.get(key, { type: 'json' }); } catch {}
    const createdAt = (existing && typeof existing.createdAt === 'string' && existing.createdAt) ? existing.createdAt : now;

    const merged = {
      ...(body || {}),
      syncName: sync,
      weekEnding,
      createdAt,
      updatedAt: now,
    };

    await kv.put(key, JSON.stringify(merged));
    return json({ ok: true, sync, weekEnding });
  }

  if (method === 'DELETE') {
    await kv.delete(key);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}