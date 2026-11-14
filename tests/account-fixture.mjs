import { readFileSync } from "node:fs";
// Existing feature tests need approved synthetic members. Approval is explicit
// fixture setup, never a production environment flag or registration bypass.
export function activeFixtureWorker(real) {
  return {
    ...real,
    async fetch(request, env, context) {
      const registering = new URL(request.url).pathname === "/api/register",
        input = registering ? await request.clone().json() : null;
      const response = await real.fetch(request, env, context);
      if (!registering || response.status !== 202) return response;
      env.DB.raw
        .prepare(
          "UPDATE users SET account_status='active',credential_revision=credential_revision+1 WHERE email=? AND account_status='pending'",
        )
        .run(input.email.trim().toLowerCase());
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      const login = await real.fetch(
        new Request(new URL("/api/login", request.url), {
          method: "POST",
          headers,
          body: JSON.stringify({
            email: input.email,
            password: input.password,
          }),
        }),
        env,
        context,
      );
      if (!login.ok)
        throw new Error("Approved synthetic account could not sign in.");
      return new Response(login.body, { status: 201, headers: login.headers });
    },
  };
}
export function legacyAccountColumns(db) {
  // Isolated pre-access API unit fixtures intentionally omit later module schemas.
  const fields = db.raw.prepare("PRAGMA table_info(users)").all();
  if (!fields.some((f) => f.name === "password_iterations"))
    db.raw.exec(
      readFileSync(
        new URL("../worker/account-safety.sql", import.meta.url),
        "utf8",
      )
        .split(";")
        .slice(0, 5)
        .join(";") + ";",
    );
}
