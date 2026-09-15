import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const AADHAAR_KEY_HEX =
  process.env.AADHAAR_ENC_KEY ||
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'officer' | 'police' | 'admin';
  name: string;
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

// SHA-256 hash-chain: record_hash = sha256(prev_hash + canonical(payload))
export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function chainHash(prevHash: string, canonicalPayload: string): string {
  return sha256Hex(`${prevHash}::${canonicalPayload}`);
}

export function canonicalize(obj: unknown): string {
  // stable stringify: sorted keys recursively
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(',')}]`;
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(rec[k])}`).join(',')}}`;
}

// AES-256-GCM for Aadhaar at rest. Stored blob: iv:authTag:ciphertext (base64)
export function encryptAadhaar(plain: string): string {
  const key = Buffer.from(AADHAAR_KEY_HEX, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptAadhaar(blob: string): string {
  const key = Buffer.from(AADHAAR_KEY_HEX, 'hex');
  const [ivB64, tagB64, dataB64] = blob.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

// Hash identifiers for UNIQUE dedupe without storing raw PII in index
export function identityHash(idType: string, normalizedValue: string): string {
  return sha256Hex(`${idType.toLowerCase()}::${normalizedValue.trim().toLowerCase()}`);
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, '');
}
