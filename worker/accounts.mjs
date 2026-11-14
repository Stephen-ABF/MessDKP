import { HttpError, readJson, requireCsrf, jsonResponse } from "./http.mjs";
import {
  verifyPassword,
  randomSecret,
  secretHash,
  authRateLimit,
} from "./passwords.mjs";
const clock =
  "(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
const sql = (db, query, ...params) => db.prepare(query).bind(...params);
const fail = (status, code, message) => {
  throw new HttpError(status, code, message);
};
function reason(value) {
  if (
    typeof value !== "string" ||
    value.trim().length < 3 ||
    value.trim().length > 500
  )
    fail(400, "validation", "Enter an officer reason of 3-500 characters.");
  return value.trim();
}
export function createAccountApi({ resolveAccess } = {}) {
  return async function (request, env, auth = {}) {
    const url = new URL(request.url),
      match = /^\/api\/accounts\/([^/]+)\/(approve|reset)$/.exec(url.pathname);
    if (url.pathname !== "/api/accounts" && !match) return null;
    try {
      const minimum = request.method === "GET" ? 2 : 3;
      if (!auth.user?.id) fail(401, "unauthorized", "Sign in first.");
      if ((auth.access?.permissions?.accounts ?? 0) < minimum)
        fail(403, "forbidden", "Account management access is required.");
      const db = env.DB,
        officer = await sql(
          db,
          "SELECT * FROM users WHERE id=?",
          auth.user.id,
        ).first();
      if (
        !officer ||
        officer.account_status !== "active" ||
        officer.reset_required
      )
        fail(403, "forbidden", "An active officer account is required.");
      const privileged = async (user) => {
        const access = await resolveAccess(db, user);
        return (
          user.role === "admin" ||
          (access?.permissions?.accounts ?? 0) >= 3 ||
          (access?.permissions?.access ?? 0) >= 3
        );
      };
      if (url.pathname === "/api/accounts" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        if (q.length > 120)
          fail(
            400,
            "validation",
            "Keep account searches under 121 characters.",
          );
        const rawOffset = url.searchParams.get("offset") || "0";
        if (!/^\d+$/.test(rawOffset) || Number(rawOffset) > 1000000)
          fail(400, "validation", "Choose a valid account page.");
        const offset = Number(rawOffset),
          rows = await sql(
            db,
            "SELECT id,name,email,role,account_status,reset_required,created_at FROM users WHERE instr(lower(name||' '||email),lower(?))>0 ORDER BY CASE WHEN account_status='pending' THEN 0 ELSE 1 END,name COLLATE NOCASE,id LIMIT 50 OFFSET ?",
            q,
            offset,
          ).all();
        const accounts = [];
        for (const row of rows.results)
          accounts.push({
            id: row.id,
            name: row.name,
            email: row.email,
            status: row.account_status,
            resetRequired: !!row.reset_required,
            createdAt: row.created_at,
            canReset:
              row.id !== officer.id &&
              row.account_status === "active" &&
              (officer.role === "admin" || !(await privileged(row))),
          });
        const total = (
          await sql(
            db,
            "SELECT COUNT(*) n FROM users WHERE instr(lower(name||' '||email),lower(?))>0",
            q,
          ).first()
        ).n;
        return jsonResponse({ accounts, total, offset, limit: 50 });
      }
      if (!match || request.method !== "POST")
        fail(405, "method_not_allowed", "Method not allowed.");
      requireCsrf(request, auth.csrfToken);
      const input = await readJson(request, { limit: 4096 }),
        why = reason(input.reason),
        target = await sql(
          db,
          "SELECT * FROM users WHERE id=?",
          match[1],
        ).first();
      if (!target) fail(404, "not_found", "Account not found.");
      const operation = crypto.randomUUID();
      if (match[2] === "approve") {
        if (target.account_status !== "pending")
          return jsonResponse({ approved: true, alreadyApproved: true });
        const result = await db.batch([
          sql(
            db,
            "UPDATE users SET account_status='active',credential_revision=credential_revision+1,credential_operation=? WHERE id=? AND account_status='pending' AND credential_revision=?",
            operation,
            target.id,
            target.credential_revision,
          ),
          sql(
            db,
            "INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'account_approved',json_object('subjectUserId',id,'reason',?),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM users WHERE id=? AND credential_operation=?",
            operation,
            officer.id,
            why,
            target.id,
            operation,
          ),
        ]);
        if (!result[0].meta.changes)
          fail(
            409,
            "account_changed",
            "The account changed. Refresh before approving.",
          );
        return jsonResponse({ approved: true });
      }
      if (input.confirm !== true)
        fail(400, "confirmation_required", "Confirm the password reset.");
      if (target.id === officer.id)
        fail(400, "self_reset", "Use Change password for your own account.");
      if (target.account_status !== "active")
        fail(409, "account_pending", "Approve the account first.");
      if (officer.role !== "admin" && (await privileged(target)))
        fail(
          403,
          "protected_account",
          "Only an administrator can reset a privileged account.",
        );
      await authRateLimit(db, request, officer.email, "officer-reset", {
        maximum: 5,
      });
      if (
        typeof input.currentPassword !== "string" ||
        input.currentPassword.length > 128 ||
        !(await verifyPassword(input.currentPassword, officer))
      )
        fail(
          403,
          "reauthentication_required",
          "Your current officer password is incorrect.",
        );
      const token = randomSecret(),
        digest = await secretHash(token);
      // Re-read delegated rights inside the guarded batch, not just at preflight.
      const result = await db.batch([
        sql(
          db,
          `UPDATE users SET reset_required=1,credential_revision=credential_revision+1,credential_operation=? WHERE id=? AND account_status='active' AND credential_revision=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=? AND credential_revision=?) AND (?='admin' OR (role<>'admin' AND NOT EXISTS(SELECT 1 FROM access_effective_permissions e WHERE e.user_id=users.id AND (COALESCE(json_extract(e.permissions_json,'$.accounts'),0)>=3 OR COALESCE(json_extract(e.permissions_json,'$.access'),0)>=3))))`,
          operation,
          target.id,
          target.credential_revision,
          officer.id,
          officer.password_hash,
          officer.credential_revision,
          officer.role,
        ),
        sql(
          db,
          "DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND credential_operation=?)",
          target.id,
          target.id,
          operation,
        ),
        sql(
          db,
          `INSERT INTO account_password_resets(user_id,token_hash,expires_at,created_by,created_at,credential_revision) SELECT id,?,${clock}+1800000,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),credential_revision FROM users WHERE id=? AND credential_operation=? ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_by=excluded.created_by,created_at=excluded.created_at,credential_revision=excluded.credential_revision`,
          digest,
          officer.id,
          target.id,
          operation,
        ),
        sql(
          db,
          "INSERT INTO audit(id,actor_id,action,details,created_at) SELECT ?,?,'password_reset_requested',json_object('subjectUserId',id,'reason',?),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM users WHERE id=? AND credential_operation=?",
          operation,
          officer.id,
          why,
          target.id,
          operation,
        ),
      ]);
      if (!result[0].meta.changes)
        fail(
          409,
          "account_changed",
          "The account or officer credentials changed. Refresh before resetting.",
        );
      return jsonResponse({
        resetUrl: url.origin + "/#reset-password?token=" + token,
        expiresInMinutes: 30,
      });
    } catch (error) {
      return jsonResponse(
        {
          error: error.status
            ? error.message
            : "Account management could not be completed.",
          code: error.code || "accounts_error",
        },
        error.status || 500,
      );
    }
  };
}
