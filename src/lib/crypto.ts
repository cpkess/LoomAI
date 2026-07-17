import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM encryption for secrets at rest (provider API keys).
// Key is derived from LOOMAI_SECRET.

function key(): Buffer {
  const secret = process.env.LOOMAI_SECRET;
  if (!secret || secret === "change-me-generate-a-real-secret") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("LOOMAI_SECRET must be set to a real secret in production");
    }
  }
  return createHash("sha256").update(secret ?? "loomai-dev-secret").digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [iv, tag, data] = payload.split(".");
  if (!iv || !tag || !data) throw new Error("Malformed encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
