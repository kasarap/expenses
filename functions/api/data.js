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
  // Manual sync name (like test-entry-log). If not provided, fall back to weekEnding.
  const sync = (url.searchParams.get('sync') || '').trim();
  const weekEnding = (url.searchParams.get('weekEnding') || '').trim();
  const syncKey = sync || weekEnding;
  if (!syncKey) return json({ error: 'Missing sync' }, 400);

  const key = `expenses:${syncKey}`;
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    const data = await kv.get(key, { type: 'json' });
    return json({ sync: syncKey, data: data || null });
  }

  if (method === 'PUT' || method === 'POST') {
    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400); }
    const now = new Date().toISOString();
    // Preserve createdAt if it already exists.
    let existing = null;
    try { existing = await kv.get(key, { type: 'json' }); } catch {}
    const createdAt = (existing && typeof existing.createdAt === 'string' && existing.createdAt) ? existing.createdAt : now;
    const merged = {
      ...(body || {}),
      createdAt,
      updatedAt: now,
    };
    await kv.put(key, JSON.stringify(merged));
    return json({ ok: true });
  }

  if (method === 'DELETE') {
    await kv.delete(key);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
