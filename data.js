
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sync = (url.searchParams.get('sync') || '').trim();
  const weekEnding = (url.searchParams.get('weekEnding') || '').trim(); // YYYY-MM-DD
  if (!sync) return json({ error: 'Missing sync' }, 400);

  const prefix = `expenses:${sync}:`;

  if (request.method === 'GET') {
    // If weekEnding not provided, return most recent for this sync
    if (!weekEnding) {
      const most = await findMostRecent(env.EXPENSES_KV, prefix);
      if (!most) return json({ data: null }, 200);
      const val = await env.EXPENSES_KV.get(most.name, 'json');
      return json({ data: val?.data || val || null }, 200);
    }
    const key = `${prefix}${weekEnding}`;
    const val = await env.EXPENSES_KV.get(key, 'json');
    return json({ data: val?.data || val || null }, 200);
  }

  if (request.method === 'PUT') {
    if (!weekEnding) return json({ error: 'Missing weekEnding' }, 400);
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON' }, 400);

    const record = {
      sync,
      weekEnding,
      businessPurpose: body.businessPurpose || '',
      updatedAt: new Date().toISOString(),
      data: {
        syncName: sync,
        weekEnding,
        businessPurpose: body.businessPurpose || '',
        entries: body.entries || {}
      }
    };

    const key = `${prefix}${weekEnding}`;
    await env.EXPENSES_KV.put(key, JSON.stringify(record));
    return json({ ok: true }, 200);
  }

  if (request.method === 'DELETE') {
    if (!weekEnding) return json({ error: 'Missing weekEnding' }, 400);
    const key = `${prefix}${weekEnding}`;
    await env.EXPENSES_KV.delete(key);
    return json({ ok: true }, 200);
  }

  return json({ error: 'Method not allowed' }, 405);
}

async function findMostRecent(kv, prefix) {
  let cursor = undefined;
  let best = null; // {name, metadata}
  while (true) {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    for (const k of page.keys) {
      // weekEnding is suffix after prefix
      const we = k.name.slice(prefix.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(we)) continue;
      if (!best || we > best.weekEnding) best = { name: k.name, weekEnding: we };
    }
    if (page.list_complete) break;
    cursor = page.cursor;
    if (!cursor) break;
  }
  return best;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
