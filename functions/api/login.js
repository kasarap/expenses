export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    const username = (body.username || '').toString();
    const password = (body.password || '').toString();

    const okUser = env.APP_USER && username === env.APP_USER;
    const okPass = env.APP_PASS && password === env.APP_PASS;

    if (!okUser || !okPass) {
      return new Response('Unauthorized', { status: 401 });
    }

    const exp = Date.now() + 1000 * 60 * 60 * 24 * 14; // 14 days
    const payload = { u: username, exp };
    const payloadB64 = b64urlEncode(JSON.stringify(payload));
    const sig = await hmac(payloadB64, env.TOKEN_SECRET || 'change-me');
    const token = `${payloadB64}.${sig}`;
    return json({ token });
  } catch (e) {
    return new Response('Bad Request', { status: 400 });
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return b64;
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sigBuf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
