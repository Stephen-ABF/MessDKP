import test from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/server/index.js";
import { createD1 } from "./d1-adapter.mjs";
import { applicationSchema } from "./app-schema.mjs";
import { passwordHash, secretHash } from "../worker/passwords.mjs";
import { ACCESS_AREAS } from "../worker/access.mjs";
import { guardedDatabase } from "../worker/authorization.mjs";
const origin = "https://account-safety.test",
  password = "Disposable fixture password123!";
async function fixture(t) {
  const DB = createD1(await applicationSchema());
  t.after(() => DB.close());
  const call = async (path, method = "GET", body, auth, extra = {}) => {
    const headers = {
      Origin: origin,
      "Content-Type": "application/json",
      ...extra,
      ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrfToken } : {}),
    };
    const response = await worker.fetch(
      new Request(origin + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { DB },
      {},
    );
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
    };
  };
  const signUp = async (name) =>
    call("/api/register", "POST", {
      email: name + "@fixture.invalid",
      name,
      password,
    });
  const identity = (r) => ({ ...r.body, cookie: r.cookie });
  const admin = identity(await signUp("Owner"));
  const member = async (name = "Member") => {
    const pending = await signUp(name);
    assert.equal(pending.status, 202);
    const target = DB.raw
      .prepare("SELECT id FROM users WHERE email=?")
      .get(name.toLowerCase() + "@fixture.invalid");
    assert.equal(
      (
        await call(
          "/api/accounts/" + target.id + "/approve",
          "POST",
          { reason: "Synthetic guild approval" },
          admin,
        )
      ).status,
      200,
    );
    return identity(
      await call("/api/login", "POST", {
        email: name + "@fixture.invalid",
        password,
      }),
    );
  };
  const reset = async (target, actor = admin) =>
    call(
      "/api/accounts/" + target.user.id + "/reset",
      "POST",
      {
        reason: "Synthetic password recovery",
        currentPassword: password,
        confirm: true,
      },
      actor,
    );
  return { DB, call, signUp, identity, admin, member, reset };
}
test("registration is pending without a session until an authorized officer approves it", async (t) => {
  const h = await fixture(t),
    pending = await h.signUp("Recruit");
  assert.equal(pending.status, 202);
  assert.equal(pending.cookie, undefined);
  assert.equal(pending.body.user, undefined);
  const row = h.DB.raw
    .prepare("SELECT * FROM users WHERE email='recruit@fixture.invalid'")
    .get();
  assert.equal(row.role, "member");
  assert.equal(row.password_iterations, 600000);
  assert.equal(row.account_status, "pending");
  assert.equal(
    (await h.call("/api/login", "POST", { email: row.email, password })).body
      .code,
    "account_pending",
  );
  assert.equal(
    (
      await h.call("/api/accounts/" + row.id + "/approve", "POST", {
        reason: "Invalid unauthenticated approval",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await h.call(
        "/api/accounts/" + row.id + "/approve",
        "POST",
        { reason: "Approved recruit" },
        h.admin,
      )
    ).status,
    200,
  );
  const login = await h.call("/api/login", "POST", {
    email: row.email,
    password,
  });
  assert.equal(login.status, 200);
  assert.equal(
    (await h.call("/api/accounts", "GET", undefined, h.identity(login))).status,
    403,
  );
});
test("self password change requires current password, preserves this session and revokes all others", async (t) => {
  const h = await fixture(t),
    member = await h.member(),
    other = h.identity(
      await h.call("/api/login", "POST", {
        email: member.user.email,
        password,
      }),
    ),
    next = "Another disposable password456!";
  assert.equal(
    (
      await h.call(
        "/api/password/change",
        "POST",
        { currentPassword: "Incorrect password123", newPassword: next },
        member,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await h.call(
        "/api/password/change",
        "POST",
        { currentPassword: password, newPassword: next },
        member,
      )
    ).status,
    200,
  );
  assert.equal(
    (await h.call("/api/me", "GET", undefined, member)).body.user.id,
    member.user.id,
  );
  assert.equal(
    (await h.call("/api/me", "GET", undefined, other)).body.user,
    null,
  );
  assert.equal(
    (await h.call("/api/login", "POST", { email: member.user.email, password }))
      .status,
    401,
  );
  assert.equal(
    (
      await h.call("/api/login", "POST", {
        email: member.user.email,
        password: next,
      })
    ).status,
    200,
  );
  assert.equal(
    h.DB.raw
      .prepare("SELECT password_iterations FROM users WHERE id=?")
      .get(member.user.id).password_iterations,
    600000,
  );
});
test("officer reset signs out all sessions and issues a hashed single-use token without auditing secrets", async (t) => {
  const h = await fixture(t),
    member = await h.member();
  const bad = await h.call(
    "/api/accounts/" + member.user.id + "/reset",
    "POST",
    {
      reason: "Synthetic recovery",
      currentPassword: "Wrong password123",
      confirm: true,
    },
    h.admin,
  );
  assert.equal(bad.status, 403);
  const reset = await h.reset(member);
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  const token = new URLSearchParams(
    new URL(reset.body.resetUrl).hash.split("?")[1],
  ).get("token");
  assert.match(token, /^[a-f0-9]{64}$/);
  const stored = h.DB.raw
    .prepare("SELECT * FROM account_password_resets")
    .get();
  assert.notEqual(stored.token_hash, token);
  assert.equal(stored.token_hash, await secretHash(token));
  assert.equal(
    (await h.call("/api/me", "GET", undefined, member)).body.user,
    null,
  );
  assert.equal(
    (await h.call("/api/login", "POST", { email: member.user.email, password }))
      .body.code,
    "password_reset_required",
  );
  const next = "New recovered fixture password456!";
  assert.equal(
    (await h.call("/api/password/reset", "POST", { token, newPassword: next }))
      .status,
    200,
  );
  assert.equal(
    (await h.call("/api/password/reset", "POST", { token, newPassword: next }))
      .status,
    400,
  );
  assert.equal(
    (
      await h.call("/api/login", "POST", {
        email: member.user.email,
        password: next,
      })
    ).status,
    200,
  );
  assert.equal(
    h.DB.raw.prepare("SELECT COUNT(*) n FROM account_password_resets").get().n,
    0,
  );
  assert.equal(
    JSON.stringify(
      h.DB.raw.prepare("SELECT details FROM audit").all(),
    ).includes(token),
    false,
  );
});
test("expired reset links and competing password resets cannot replace the latest credentials", async (t) => {
  const h = await fixture(t),
    member = await h.member(),
    r = await h.reset(member),
    token = new URLSearchParams(
      new URL(r.body.resetUrl).hash.split("?")[1],
    ).get("token");
  h.DB.raw.prepare("UPDATE account_password_resets SET expires_at=0").run();
  assert.equal(
    (
      await h.call("/api/password/reset", "POST", {
        token,
        newPassword: "Never accepted fixture password123",
      })
    ).status,
    400,
  );
  const r2 = await h.reset(member),
    token2 = new URLSearchParams(
      new URL(r2.body.resetUrl).hash.split("?")[1],
    ).get("token");
  const results = await Promise.all([
    h.call("/api/password/reset", "POST", {
      token: token2,
      newPassword: "First contender password123!",
    }),
    h.call("/api/password/reset", "POST", {
      token: token2,
      newPassword: "Second contender password123!",
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
});
test("login upgrades legacy 100000-iteration hashes and records the new work factor per user", async (t) => {
  const h = await fixture(t);
  const salt = "legacy-fixture-salt",
    old = await passwordHash(password, salt, 100000);
  h.DB.raw
    .prepare(
      "INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES('legacy','legacy@fixture.invalid','Legacy',?,?,'member','2026-11-13')",
    )
    .run(old, salt);
  const login = await h.call("/api/login", "POST", {
    email: "legacy@fixture.invalid",
    password,
  });
  assert.equal(login.status, 200);
  const row = h.DB.raw.prepare("SELECT * FROM users WHERE id='legacy'").get();
  assert.equal(row.password_iterations, 600000);
  assert.notEqual(row.salt, salt);
  assert.notEqual(row.password_hash, old);
  assert.equal(
    await passwordHash(password, row.salt, row.password_iterations),
    row.password_hash,
  );
});
test("per-IP registration bucket limits changing email addresses and expired rate-limit rows are cleaned", async (t) => {
  const h = await fixture(t);
  h.DB.raw
    .prepare("INSERT INTO auth_limits VALUES('expired-fixture',99,0)")
    .run();
  for (let n = 0; n < 10; n++) {
    const result = await h.call(
      "/api/register",
      "POST",
      {
        name: "Recruit " + n,
        email: "recruit" + n + "@fixture.invalid",
        password,
      },
      undefined,
      { "cf-connecting-ip": "203.0.113.7" },
    );
    assert.equal(result.status, 202);
  }
  const blocked = await h.call(
    "/api/register",
    "POST",
    { name: "Another", email: "another@fixture.invalid", password },
    undefined,
    { "cf-connecting-ip": "203.0.113.7" },
  );
  assert.equal(blocked.status, 429);
  assert.equal(
    h.DB.raw
      .prepare("SELECT COUNT(*) n FROM auth_limits WHERE key='expired-fixture'")
      .get().n,
    0,
  );
});
test("read-only scoped queries do not write guard rows, while a revoked session cannot write even after reset completion", async (t) => {
  const h = await fixture(t),
    member = await h.member(),
    token = member.cookie.split("=")[1],
    db = guardedDatabase(
      h.DB,
      member.user.id,
      [{ area: "characters", level: 3 }],
      {
        sessionTokenHash: await secretHash(token),
        credentialRevision: member.user.credentialRevision,
      },
    );
  const before = h.DB.raw.prepare("SELECT total_changes() n").get().n;
  await db
    .prepare("SELECT id FROM users WHERE id=?")
    .bind(member.user.id)
    .first();
  await db.batch([
    db.prepare("WITH ids AS (SELECT id FROM users) SELECT * FROM ids"),
  ]);
  assert.equal(h.DB.raw.prepare("SELECT total_changes() n").get().n, before);
  const reset = await h.reset(member),
    resetToken = new URLSearchParams(
      new URL(reset.body.resetUrl).hash.split("?")[1],
    ).get("token");
  assert.equal(
    (
      await h.call("/api/password/reset", "POST", {
        token: resetToken,
        newPassword: "Recovered ABA fixture password123!",
      })
    ).status,
    200,
  );
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO audit(id,actor_id,action,details,created_at) VALUES('revoked-write',?,'fixture','{}','now')",
      )
      .bind(member.user.id)
      .run(),
    /access changed/i,
  );
  assert.equal(
    h.DB.raw
      .prepare("SELECT COUNT(*) n FROM audit WHERE id='revoked-write'")
      .get().n,
    0,
  );
});
test("officers cannot reset their own or delegated privileged accounts and mutations require Origin/CSRF", async (t) => {
  const h = await fixture(t),
    officer = await h.member("Officer"),
    member = await h.member("Other");
  h.DB.raw
    .prepare(
      "INSERT INTO access_user_profiles(user_id,profile_id,overrides_json,revision,updated_by,updated_at,operation_id) VALUES(?,'officer','{}',1,?,'2026-11-13','fixture-officer')",
    )
    .run(officer.user.id, h.admin.user.id);
  assert.equal((await h.reset(h.admin, officer)).status, 403);
  assert.equal((await h.reset(officer, officer)).status, 400);
  const response = await h.call(
    "/api/accounts/" + member.user.id + "/reset",
    "POST",
    { reason: "Missing confirmation", currentPassword: password },
    officer,
  );
  assert.equal(response.status, 400);
  const foreign = await h.call(
    "/api/password/change",
    "POST",
    { currentPassword: password, newPassword: "Foreign origin password123!" },
    member,
    { Origin: "https://foreign.invalid" },
  );
  assert.equal(foreign.status, 403);
});

test("a paused access-management write cannot resume after password reset and token consumption", async (t) => {
  const h = await fixture(t),
    manager = await h.member("Manager");
  h.DB.raw
    .prepare(
      "INSERT INTO access_user_profiles(user_id,profile_id,overrides_json,revision,updated_by,updated_at,operation_id) VALUES(?,'admin','{}',1,?,'now','elevated')",
    )
    .run(manager.user.id, h.admin.user.id);
  const batch = h.DB.batch.bind(h.DB);
  let signal, release;
  const paused = new Promise((r) => (signal = r)),
    resume = new Promise((r) => (release = r));
  let armed = true;
  h.DB.batch = async (statements) => {
    if (
      armed &&
      statements.some((s) => /INSERT INTO access_profiles/.test(s.query))
    ) {
      armed = false;
      signal();
      await resume;
    }
    return batch(statements);
  };
  const request = h.call(
    "/api/access/profiles",
    "POST",
    {
      name: "Revoked stale profile",
      permissions: Object.fromEntries(ACCESS_AREAS.map((a) => [a.key, 0])),
    },
    manager,
  );
  await paused;
  const reset = await h.reset(manager);
  assert.equal(reset.status, 200);
  const token = new URLSearchParams(
    new URL(reset.body.resetUrl).hash.split("?")[1],
  ).get("token");
  assert.equal(
    (
      await h.call("/api/password/reset", "POST", {
        token,
        newPassword: "New manager recovered password123!",
      })
    ).status,
    200,
  );
  release();
  const result = await request;
  assert.equal(result.status, 403);
  assert.equal(
    h.DB.raw
      .prepare(
        "SELECT COUNT(*) n FROM access_profiles WHERE name='Revoked stale profile'",
      )
      .get().n,
    0,
  );
});
test("login verification paused before its session INSERT cannot revive a reset credential", async (t) => {
  const h = await fixture(t),
    member = await h.member("Racer");
  const batch = h.DB.batch.bind(h.DB);
  let signal, release;
  const paused = new Promise((r) => (signal = r)),
    resume = new Promise((r) => (release = r));
  let armed = true;
  h.DB.batch = async (statements) => {
    if (armed && statements.some((s) => /INSERT INTO sessions/.test(s.query))) {
      armed = false;
      signal();
      await resume;
    }
    return batch(statements);
  };
  const login = h.call("/api/login", "POST", {
    email: member.user.email,
    password,
  });
  await paused;
  const reset = await h.reset(member);
  assert.equal(reset.status, 200);
  release();
  assert.equal((await login).status, 409);
  assert.equal(
    h.DB.raw
      .prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?")
      .get(member.user.id).n,
    0,
  );
});
