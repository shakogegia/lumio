import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const KEY_LEN = 64;

/** A high-entropy, URL-safe share token (~192 bits). */
export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}

/** scrypt hash, stored as "<saltHex>:<keyHex>". */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEY_LEN)) as Buffer;
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(keyHex, "hex");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const test = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
  return expected.length === test.length && timingSafeEqual(expected, test);
}

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return s;
}

/** HMAC proving "the password for <token> was entered". Stored as the cookie value. */
export function signUnlock(token: string): string {
  return createHmac("sha256", secret()).update(`share-unlock:${token}`).digest("hex");
}

export function verifyUnlock(token: string, signature: string): boolean {
  if (!signature) return false;
  const expected = signUnlock(token);
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return a.length === b.length && timingSafeEqual(a, b);
}
