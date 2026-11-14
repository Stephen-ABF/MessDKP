import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  readJson,
  requireCsrf,
  isReadOnlySql,
  HttpError,
} from "../worker/http.mjs";
import { createDevServer } from "../dev-server.mjs";
test("shared request parser bounds actual UTF8 bytes, rejects invalid JSON shapes and preserves explicit error contracts", async () => {
  const request = (value) =>
    new Request("https://fixture.invalid/api/example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: value,
    });
  assert.deepEqual(await readJson(request('{"hello":"world"}')), {
    hello: "world",
  });
  await assert.rejects(
    readJson(request('{"name":"' + "\u00e9".repeat(100) + '"}'), {
      limit: 150,
    }),
    (e) => e instanceof HttpError && e.status === 413,
  );
  for (const text of ["null", "[]", "broken"])
    await assert.rejects(readJson(request(text)), (e) => e.status === 400);
  await assert.rejects(
    readJson(request("[]"), { objectCode: "validation" }),
    (e) => e.code === "validation",
  );
  await assert.rejects(
    readJson(
      new Request("https://fixture.invalid", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "9000",
        },
        body: "{}",
      }),
      { limit: 8192 },
    ),
    (e) => e.status === 413,
  );
});
test("shared CSRF guard rejects a missing token, foreign origin and mismatched token", () => {
  const request = (origin, token) =>
    new Request("https://fixture.invalid/api/example", {
      method: "POST",
      headers: { Origin: origin, ...(token ? { "X-CSRF-Token": token } : {}) },
    });
  assert.doesNotThrow(() =>
    requireCsrf(request("https://fixture.invalid", "csrf"), "csrf"),
  );
  for (const [origin, token] of [
    ["https://foreign.invalid", "csrf"],
    ["https://fixture.invalid", "wrong"],
    ["https://fixture.invalid", null],
  ])
    assert.throws(
      () => requireCsrf(request(origin, token), "csrf"),
      (e) => e.status === 403,
    );
});
test("read-only SQL classification handles comments, quoted values and WITH reads, and treats unknown/mutating SQL conservatively", () => {
  for (const query of [
    "SELECT 'UPDATE users' AS label",
    "-- comment\nSELECT id FROM users",
    "WITH x AS (SELECT id FROM users) SELECT * FROM x",
  ])
    assert.equal(isReadOnlySql(query), true, query);
  for (const query of [
    "INSERT INTO audit VALUES(1)",
    "WITH x AS (SELECT 1) DELETE FROM audit RETURNING id",
    "UPDATE users SET name='x' RETURNING id",
    "PRAGMA user_version",
    "SELECT 1; DELETE FROM users",
  ])
    assert.equal(isReadOnlySql(query), false, query);
});
test("temporary dev server rejects arbitrary Host and foreign-origin request targets before handling an API request", async (t) => {
  const app = await createDevServer();
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(() => app.close());
  const port = app.server.address().port;
  const request = (host, path = "/api/health") =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path, headers: { Host: host } },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      req.on("error", reject);
      req.end();
    });
  assert.equal(await request("evil.invalid:" + port), 400);
  assert.equal(
    await request("localhost:" + port, "//evil.invalid/api/health"),
    400,
  );
  assert.equal(
    await request("localhost:" + port, "/\\evil.invalid/api/health"),
    400,
  );
  assert.equal(await request("localhost:" + port), 200);
  assert.equal(await request("127.0.0.1:" + port), 200);
});
