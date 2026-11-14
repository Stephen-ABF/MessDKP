// Shared HTTP boundary rules. Resource authorization remains with each API.
export class HttpError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length)
    return false;
  let difference = 0;
  for (let n = 0; n < a.length; n++)
    difference |= a.charCodeAt(n) ^ b.charCodeAt(n);
  return difference === 0;
}
export function jsonResponse(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
export function requireCsrf(
  request,
  token,
  { originCode = "origin", csrfCode = "csrf" } = {},
) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new HttpError(403, originCode, "A same-origin request is required.");
  if (!token || !constantTimeEqual(request.headers.get("x-csrf-token"), token))
    throw new HttpError(403, csrfCode, "Refresh your session and try again.");
}
// A conservative classifier: unknown statements are treated as mutations.
// Quoted values/identifiers and comments cannot supply misleading keywords.
export function isReadOnlySql(query) {
  const tokens = String(query).replace(
    /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\[[^\]]*\]/g,
    " ",
  );
  return (
    /^\s*(?:SELECT|WITH|EXPLAIN\s+QUERY\s+PLAN\s+SELECT)\b/i.test(tokens) &&
    !/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|VACUUM|ATTACH|DETACH|REINDEX|ANALYZE)\b/i.test(
      tokens,
    )
  );
}
export async function readText(
  request,
  {
    limit = 16384,
    sizeMessage = "The request is too large.",
    sizeCode = "too_large",
    fatalUtf8 = false,
  } = {},
) {
  const reader = request.body?.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: fatalUtf8 });
  let text = "",
    bytes = 0;
  try {
    if (reader)
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) {
          await reader.cancel().catch(() => {});
          throw new HttpError(413, sizeCode, sizeMessage);
        }
        text += decoder.decode(value, { stream: true });
      }
    text += decoder.decode();
  } finally {
    reader?.releaseLock();
  }
  return text;
}
export async function readJson(
  request,
  {
    limit = 16384,
    empty = false,
    contentMessage = "Send JSON data.",
    contentCode = "content_type",
    sizeMessage = "The request is too large.",
    sizeCode = "too_large",
    jsonMessage = "Invalid JSON request.",
    jsonCode = "invalid_json",
    objectCode = jsonCode,
  } = {},
) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json") &&
    !(empty && !request.body)
  )
    throw new HttpError(415, contentCode, contentMessage);
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new HttpError(413, sizeCode, sizeMessage);
  const text = await readText(request, { limit, sizeMessage, sizeCode });
  if (empty && !text.trim()) return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, jsonCode, jsonMessage);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, objectCode, jsonMessage);
  return value;
}
