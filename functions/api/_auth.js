export async function requireAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, status: 401, msg: 'Missing token' };

  const token = m[1].trim();
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, status: 401, msg: 'Bad token' };

  const [payloadB64, sig] = parts;
  const expected = await hmac(payloadB64, env.TOKEN_SECRET || 'change-me');
  if (sig !== expected) return { ok: false, status: 401, msg: 'Bad signature' };

  const payloadJson = b64urlDecode(payloadB64);
  let payload;
  try { payload = JSON.parse(payloadJson); } catch { return { ok:false, status:401, msg:'Bad payload' }; }

  if (!payload.exp || Date.now() > payload.exp) return { ok:false, status:401, msg:'Expired' };
  return { ok: true, user: payload.u || 'user' };
}

function b64urlDecode(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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
