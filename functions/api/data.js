// /api/data
// Key shape (v2): expenses:{sync}:{weekEnding}:{reportId}
// Back-compat:    expenses:{sync}:{weekEnding}           (legacy, single report per week)
//
// GET    ?sync=&weekEnding=&reportId=     -> { data, updatedAt }
// GET    ?sync=&weekEnding=               -> { data, updatedAt } from legacy key
// GET    ?sync=                           -> { data, updatedAt } most recent any week
// PUT    ?sync=&weekEnding=&reportId=     -> upsert one report
//        body: { businessPurpose, entries, clientKnownUpdatedAt?, force? }
//        Returns 409 if server has a newer updatedAt than clientKnownUpdatedAt
//        (unless force:true). On success returns { ok:true, updatedAt }.
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
      return json({ data: unwrap(val), updatedAt: val?.updatedAt || null }, 200);
    }
    const key = reportId
      ? `${prefix}${weekEnding}:${reportId}`
      : `${prefix}${weekEnding}`;
    const val = await env.EXPENSES_KV.get(key, 'json');
    return json({ data: unwrap(val), updatedAt: val?.updatedAt || null }, 200);
  }

  if (request.method === 'PUT') {
    if (!weekEnding) return json({ error: 'Missing weekEnding' }, 400);
    if (!reportId)   return json({ error: 'Missing reportId' }, 400);
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON' }, 400);

    const key = `${prefix}${weekEnding}:${reportId}`;

    // Optimistic concurrency: if the client tells us what version it last saw,
    // and the server has a newer one, refuse the write. This prevents a stale
    // tab (e.g. a phone left open with empty fields) from clobbering edits
    // made on another device.
    const clientKnownUpdatedAt = (body.clientKnownUpdatedAt || '').toString();
    if (body.force !== true) {
      const existing = await env.EXPENSES_KV.get(key, 'json');
      if (existing && existing.updatedAt) {
        // If the client didn't supply a baseline, treat that as "I don't know
        // about any version" — only safe to write if there's nothing there.
        if (!clientKnownUpdatedAt || existing.updatedAt > clientKnownUpdatedAt) {
          return json({
            error: 'conflict',
            serverUpdatedAt: existing.updatedAt,
            data: existing.data || existing
          }, 409);
        }
      }
    }

    const updatedAt = new Date().toISOString();
    const record = {
      sync,
      weekEnding,
      reportId,
      businessPurpose: body.businessPurpose || '',
      updatedAt,
      data: {
        syncName: sync,
        weekEnding,
        reportId,
        businessPurpose: body.businessPurpose || '',
        entries: body.entries || {}
      }
    };

    await env.EXPENSES_KV.put(key, JSON.stringify(record));
    return json({ ok: true, updatedAt }, 200);
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
