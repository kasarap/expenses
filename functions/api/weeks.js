function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
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
  if (!sync) return json({ entries: [] });

  const keys = await listAll(kv, { prefix: `expenses:${sync}:` });
  const weekEndings = keys
    .map((k) => String(k.name).split(':').slice(-1)[0])
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));

  const entries = [];
  for (const we of weekEndings) {
    let data = null;
    try {
      data = await kv.get(`expenses:${sync}:${we}`, { type: 'json' });
    } catch {}
    const bp = data && typeof data.businessPurpose === 'string' ? data.businessPurpose : '';
    const updatedAt = data && typeof data.updatedAt === 'string' ? data.updatedAt : '';
    entries.push({ weekEnding: we, businessPurpose: bp, updatedAt });
  }

  return json({ sync, entries });
}
