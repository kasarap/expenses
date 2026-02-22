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

  const list = await kv.list({ prefix: 'expenses:' });
  const weeks = (list.keys || []).map(k => k.name.replace(/^expenses:/,''));
  weeks.sort(); // ISO dates sort naturally
  return json({ weeks });
}
