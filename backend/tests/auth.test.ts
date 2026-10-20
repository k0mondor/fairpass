import { Router } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { AuthConfig } from "../src/config/auth.js";
import { openDatabase, type DatabaseConnection } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { seedDemoUsers } from "../src/db/seed.js";
import { requireAuth, requireRole } from "../src/middleware/auth.js";
import { createAuthRouter } from "../src/routes/auth.js";
import { AuthService } from "../src/services/auth-service.js";
import { DemoTokenService } from "../src/services/demo-token-service.js";
import { sendData } from "../src/utils/http-response.js";

const httpConfig = {
  corsOrigins: ["http://127.0.0.1:5173"],
  jsonBodyLimit: "100kb",
};
const authConfig: AuthConfig = {
  secret: new TextEncoder().encode("test-secret-with-at-least-32-characters"),
  ttlSeconds: 60,
  issuer: "fairpass-backend",
  audience: "fairpass-demo",
};
const silentLog = () => undefined;

describe("demo authentication", () => {
  let database: DatabaseConnection;
  let now: number;
  let auth: AuthService;

  beforeEach(() => {
    database = openDatabase(":memory:");
    runMigrations(database);
    seedDemoUsers(database);
    now = Math.floor(Date.parse("2026-09-29T00:00:00.000Z") / 1000);
    auth = new AuthService(
      new UserRepository(database),
      new DemoTokenService(authConfig, () => now),
    );
  });

  afterEach(() => database.close());

  const createAuthApp = () => {
    const router = Router();
    router.use("/auth", createAuthRouter(auth));
    return createApp({
      config: httpConfig,
      apiRouter: router,
      logSink: silentLog,
    });
  };

  const login = async (account: string) => {
    const response = await request(createAuthApp())
      .post("/api/v1/auth/demo-login")
      .send({
        account,
        password: "123456",
        role:
          account === "morgan"
            ? "ORGANIZER"
            : account === "taylor"
              ? "INSPECTOR"
              : "STUDENT",
      });
    expect(response.status).toBe(200);
    return response.body.data as {
      token: string;
      user: { id: string; displayName: string; role: string };
    };
  };

  it("logs in a seeded account and returns the current user", async () => {
    const result = await login("alex");
    expect(result.user).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "alex",
      role: "STUDENT",
    });

    const me = await request(createAuthApp())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${result.token}`);
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual(result.user);
  });

  it("requires a password and rejects a wrong password or mismatched role", async () => {
    const app = createAuthApp();
    expect(
      (
        await request(app)
          .post("/api/v1/auth/demo-login")
          .send({ account: "alex" })
      ).status,
    ).toBe(400);
    for (const body of [
      { account: "alex", password: "wrong", role: "STUDENT" },
      { account: "alex", password: "123456", role: "ORGANIZER" },
      { account: "morgan", password: "123456", role: "STUDENT" },
    ]) {
      const rejected = await request(app)
        .post("/api/v1/auth/demo-login")
        .send(body);
      expect(rejected.status).toBe(401);
      expect(rejected.body.error.message).toBe("账号、密码或登录身份不正确");
      expect(rejected.body.data).toBeUndefined();
    }
  });

  it("authenticates the four presentation accounts without changing their user IDs", async () => {
    for (const [account, role, id] of [
      ["alex", "STUDENT", "11111111-1111-4111-8111-111111111111"],
      ["jamie", "STUDENT", "22222222-2222-4222-8222-222222222222"],
      ["morgan", "ORGANIZER", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      ["taylor", "INSPECTOR", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ]) {
      const response = await request(createAuthApp())
        .post("/api/v1/auth/demo-login")
        .send({ account, password: "123456", role });
      expect(response.status).toBe(200);
      expect(response.body.data.user).toEqual({
        id,
        displayName: account,
        role,
      });
    }
  });

  it("rejects unknown accounts and invalid request bodies", async () => {
    const missing = await request(createAuthApp())
      .post("/api/v1/auth/demo-login")
      .send({ account: "missing", password: "123456", role: "STUDENT" });
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe("UNAUTHENTICATED");

    const invalid = await request(createAuthApp())
      .post("/api/v1/auth/demo-login")
      .send({ account: "alex", role: "ORGANIZER" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing, tampered, and expired tokens", async () => {
    const app = createAuthApp();
    const missing = await request(app).get("/api/v1/auth/me");
    expect(missing.status).toBe(401);

    const result = await login("alex");
    const tampered = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${result.token}x`);
    expect(tampered.status).toBe(401);

    now += 61;
    const expired = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${result.token}`);
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("enforces role guards from the signed token identity", async () => {
    const router = Router();
    router.get(
      "/organizer-only",
      requireAuth(auth),
      requireRole("ORGANIZER"),
      (req, res) => sendData(res, { actorId: req.actor?.id }),
    );
    const guardedApp = createApp({
      config: httpConfig,
      apiRouter: router,
      logSink: silentLog,
    });
    const student = await login("alex");
    const organizer = await login("morgan");

    const forbidden = await request(guardedApp)
      .get("/api/v1/organizer-only")
      .set("Authorization", `Bearer ${student.token}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");

    const allowed = await request(guardedApp)
      .get("/api/v1/organizer-only")
      .set("Authorization", `Bearer ${organizer.token}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.actorId).toBe(organizer.user.id);
  });
});
