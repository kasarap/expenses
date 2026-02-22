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

  // Use ?id= for the record key. Back-compat: accept ?sync= too.
  const id = (url.searchParams.get('id') || url.searchParams.get('sync') || '').trim();
  if (!id) return json({ error: 'Missing id' }, 400);

  const key = `expenses:${id}`;
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    const data = await kv.get(key, { type: 'json' });
    return json({ id, data: data || null });
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
