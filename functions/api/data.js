function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function keyFor(sync, weekEnding) {
  return `expenses:${sync}:${weekEnding}`;
}

async function listAll(kv, opts) {
  const out = [];
  let cursor;
  do {
    const res = await kv.list({ ...opts, cursor });
    out.push(...(res.keys || []));
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.EXPENSES_KV;
  if (!kv) return json({ error: 'Missing KV binding EXPENSES_KV' }, 500);

  const url = new URL(request.url);
  const sync = (url.searchParams.get('sync') || '').trim();
  const weekEnding = (url.searchParams.get('weekEnding') || '').trim();
  if (!sync) return json({ error: 'Missing sync' }, 400);

  const method = request.method.toUpperCase();

  // If weekEnding is omitted on GET, return most recent entry for this sync.
  if (method === 'GET' && !weekEnding) {
    const keys = await listAll(kv, { prefix: `expenses:${sync}:` });
    const weekEndings = keys
      .map((k) => String(k.name).split(':').slice(-1)[0])
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a));
    const latest = weekEndings[0];
    if (!latest) return json({ sync, weekEnding: '', data: null });
    const data = await kv.get(keyFor(sync, latest), { type: 'json' });
    return json({ sync, weekEnding: latest, data: data || null });
  }

  if (!weekEnding) return json({ error: 'Missing weekEnding' }, 400);

  const key = keyFor(sync, weekEnding);

  if (method === 'GET') {
    const data = await kv.get(key, { type: 'json' });
    return json({ sync, weekEnding, data: data || null });
  }

  if (method === 'PUT' || method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const now = new Date().toISOString();
    let existing = null;
    try {
      existing = await kv.get(key, { type: 'json' });
    } catch {}
    const createdAt =
      existing && typeof existing.createdAt === 'string' && existing.createdAt
        ? existing.createdAt
        : now;

    const merged = {
      ...(body || {}),
      syncName: sync,
      weekEnding,
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
