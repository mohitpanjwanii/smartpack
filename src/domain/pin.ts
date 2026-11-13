/**
 * PINs are never stored. We store a salted PBKDF2-SHA256 hash, so someone
 * who copies the database file cannot read staff PINs.
 */
const ITERATIONS = 120_000;

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const PIN_RULE = 'PIN must be 4 to 6 digits';

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS },
    key,
    256,
  );
  return toHex(bits);
}

export async function hashPin(pin: string): Promise<{ hash: string; salt: string }> {
  if (!isValidPin(pin)) throw new Error(PIN_RULE);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await derive(pin, salt), salt: toHex(salt) };
}

export async function checkPin(pin: string, hash: string, salt: string): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  const candidate = await derive(pin, fromHex(salt));
  // constant-time comparison
  let diff = candidate.length ^ hash.length;
  for (let i = 0; i < Math.min(candidate.length, hash.length); i++) {
    diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}
