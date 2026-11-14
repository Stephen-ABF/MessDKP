import { HttpError, constantTimeEqual } from "./http.mjs";
export const PASSWORD_ITERATIONS = 600000;
const encoder = new TextEncoder();
export const bytesHex = (bytes) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export const randomSecret = () =>
  bytesHex(crypto.getRandomValues(new Uint8Array(32)));
export const secretHash = async (value) =>
  bytesHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
export function validatePassword(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw new HttpError(
      400,
      "validation",
      "Password must contain 12-128 characters.",
    );
  return value;
}
export async function passwordHash(
  password,
  salt,
  iterations = PASSWORD_ITERATIONS,
) {
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 100000 ||
    iterations > 2000000
  )
    throw new HttpError(
      500,
      "password_configuration",
      "Password settings require administrator review.",
    );
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return bytesHex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: encoder.encode(salt),
        iterations,
        hash: "SHA-256",
      },
      key,
      256,
    ),
  );
}
export async function verifyPassword(value, account) {
  return constantTimeEqual(
    await passwordHash(
      value,
      account?.salt || "0123456789abcdef".repeat(4),
      account?.password_iterations ?? PASSWORD_ITERATIONS,
    ),
    account?.password_hash,
  );
}
export async function authRateLimit(
  db,
  request,
  email,
  action,
  { maximum = 15, milliseconds = 900000, ipOnly = false } = {},
) {
  const at = Date.now(),
    address = request.headers.get("cf-connecting-ip") || "private",
    key =
      action +
      ":" +
      (await secretHash(ipOnly ? address : email + ":" + address));
  await db
    .prepare("DELETE FROM auth_limits WHERE expires_at<=?")
    .bind(at)
    .run();
  const result = await db
    .prepare(
      "INSERT INTO auth_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count",
    )
    .bind(key, at + milliseconds, at, at)
    .first();
  if (result.count > maximum)
    throw new HttpError(
      429,
      "rate_limit",
      "Too many attempts. Please try again later.",
    );
}
