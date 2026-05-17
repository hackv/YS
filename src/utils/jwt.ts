export interface JwtPayload {
  id: number;
  username: string;
  role?: number;
  exp?: number;
}

export async function signToken(payload: JwtPayload, secret: string, expiresIn: string = '7d'): Promise<string> {
  const expSeconds = parseExpiresIn(expiresIn);
  const payloadWithExp = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + expSeconds
  };

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadB64 = base64UrlEncode(JSON.stringify(payloadWithExp));
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC', key, encoder.encode(`${header}.${payloadB64}`)
  );
  
  const signatureB64 = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
  
  return `${header}.${payloadB64}.${signatureB64}`;
}

export async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify']
    );

    const signature = Uint8Array.from(
      atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    );
    
    const isValid = await crypto.subtle.verify(
      'HMAC', key, signature,
      encoder.encode(`${headerB64}.${payloadB64}`)
    );
    
    if (!isValid) return null;

    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))) as JwtPayload;
    
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    
    return payload;
  } catch (error) {
    console.error('JWT verification error:', error);
    return null;
  }
}

function base64UrlEncode(str: string): string {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60;
  
  const [, num, unit] = match;
  const n = parseInt(num);
  
  switch (unit) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 60 * 60;
    case 'd': return n * 24 * 60 * 60;
    default: return 7 * 24 * 60 * 60;
  }
}