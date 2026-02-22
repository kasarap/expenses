import { requireAuth } from './_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return new Response(auth.msg, { status: auth.status });

  const url = new URL(request.url);
  const weekEnding = (url.searchParams.get('weekEnding') || '').trim();
  if (!weekEnding) return new Response('Missing weekEnding', { status: 400 });

  const key = `expenses:${weekEnding}`;
  const val = await env.EXPENSES_KV.get(key);
  if (!val) return new Response('Not found', { status: 404 });

  return new Response(val, { headers: { 'Content-Type': 'application/json' }});
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return new Response(auth.msg, { status: auth.status });

  const body = await request.json().catch(() => null);
  if (!body || !body.weekEnding) return new Response('Bad body', { status: 400 });

  const weekEnding = String(body.weekEnding).trim();
  const key = `expenses:${weekEnding}`;

  // Store only what we need
  const out = {
    weekEnding,
    businessPurpose: String(body.businessPurpose || ''),
    entries: body.entries || {},
    updatedAt: new Date().toISOString()
  };

  await env.EXPENSES_KV.put(key, JSON.stringify(out));
  return new Response('OK', { status: 200 });
}
