// /api/data
// Key shape (v2): expenses:{sync}:{weekEnding}:{reportId}
// Back-compat:    expenses:{sync}:{weekEnding}           (legacy, single report per week)
//
// GET    ?sync=&weekEnding=&reportId=     -> load one report
// GET    ?sync=&weekEnding=               -> load legacy key for that week (if present)
// GET    ?sync=                           -> load most recent (any week, any report)
// PUT    ?sync=&weekEnding=&reportId=     -> upsert one report
// DELETE ?sync=&weekEnding=&reportId=     -> delete one report
// DELETE ?sync=&weekEnding=               -> delete legacy key for that week

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sync = (url.searchParams.get('sync') || '').trim();
  const weekEnding = (url.searchParams.get('weekEnding') || '').trim();
  const reportId = (url.searchParams.get('reportId') || '').trim();
  if (!sync) return json({ error: 'Missing sync' }, 400);

  const prefix = `expenses:${sync}:`;

  if (request.method === 'GET') {
    if (!weekEnding) {
      const most = await findMostRecent(env.EXPENSES_KV, prefix);
      if (!most) return json({ data: null }, 200);
      const val = await env.EXPENSES_KV.get(most.name, 'json');
      return json({ data: unwrap(val) }, 200);
    }
    const key = reportId
      ? `${prefix}${weekEnding}:${reportId}`
      : `${prefix}${weekEnding}`;
    const val = await env.EXPENSES_KV.get(key, 'json');
    return json({ data: unwrap(val) }, 200);
  }

  if (request.method === 'PUT') {
    if (!weekEnding) return json({ error: 'Missing weekEnding' }, 400);
    if (!reportId)   return json({ error: 'Missing reportId' }, 400);
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON' }, 400);

    const record = {
      sync,
      weekEnding,
      reportId,
      businessPurpose: body.businessPurpose || '',
      updatedAt: new Date().toISOString(),
      data: {
        syncName: sync,
        weekEnding,
        reportId,
        businessPurpose: body.businessPurpose || '',
        entries: body.entries || {}
      }
    };

    const key = `${prefix}${weekEnding}:${reportId}`;
    await env.EXPENSES_KV.put(key, JSON.stringify(record));
    return json({ ok: true }, 200);
  }

  if (request.method === 'DELETE') {
    if (!weekEnding) return json({ error: 'Missing weekEnding' }, 400);
    const key = reportId
      ? `${prefix}${weekEnding}:${reportId}`
      : `${prefix}${weekEnding}`;
    await env.EXPENSES_KV.delete(key);
    return json({ ok: true }, 200);
  }

  return json({ error: 'Method not allowed' }, 405);
}

function unwrap(val) {
  if (!val) return null;
  return val.data || val;
}

async function findMostRecent(kv, prefix) {
  let cursor = undefined;
  let best = null;
  while (true) {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    for (const k of page.keys) {
      const suffix = k.name.slice(prefix.length);
      const m = /^(\d{4}-\d{2}-\d{2})(?::(.+))?$/.exec(suffix);
      if (!m) continue;
      const weekEnding = m[1];
      if (!best
          || weekEnding > best.weekEnding
          || (weekEnding === best.weekEnding && k.name > best.name)) {
        best = { name: k.name, weekEnding };
      }
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
