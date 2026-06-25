import {
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from "node:crypto";

const KEY_LEN = 64;
// Pinned scrypt cost parameters (Node defaults, made explicit + deliberate).
const SCRYPT_PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1 };

// Promise wrapper around the callback scrypt that keeps the cost-options
// argument. `util.promisify(scrypt)` resolves to the 3-arg overload in the type
// system, so passing options would fail to typecheck — this wrapper avoids that.
function scrypt(password: BinaryLike, salt: BinaryLike, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** A high-entropy, URL-safe share token (~192 bits). */
export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}

/** scrypt hash, stored as "<saltHex>:<keyHex>". */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  // Pin verification to the canonical key length: reject any stored hash whose
  // key isn't KEY_LEN bytes, closing a scrypt-downgrade path on a tampered DB.
  if (expected.length !== KEY_LEN) return false;
  const test = await scrypt(password, Buffer.from(saltHex, "hex"), KEY_LEN, SCRYPT_PARAMS);
  return timingSafeEqual(expected, test);
}

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return s;
}

/** HMAC proving "the password for <token> was entered". Stored as the cookie value.
 *  Throws if BETTER_AUTH_SECRET is unset (the write/sign path must fail loudly). */
export function signUnlock(token: string): string {
  return createHmac("sha256", secret()).update(`share-unlock:${token}`).digest("hex");
}

/** Verify an unlock signature. Fail-closed (returns false) on any bad/empty input
 *  or missing secret — never throws (the read path is attacker-facing). */
export function verifyUnlock(token: string, signature: string): boolean {
  if (!signature) return false;
  let expectedHex: string;
  try {
    expectedHex = signUnlock(token);
  } catch {
    return false;
  }
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
