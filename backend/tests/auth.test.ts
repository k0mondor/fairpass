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
import { createApiRouter } from "../src/routes/index.js";
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

  const createAuthApp = () =>
    createApp({
      config: httpConfig,
      apiRouter: createApiRouter({ auth }),
      logSink: silentLog,
    });

  const login = async (account: string) => {
    const response = await request(createAuthApp())
      .post("/api/v1/auth/demo-login")
      .send({ account });
    expect(response.status).toBe(200);
    return response.body.data as {
      token: string;
      user: { id: string; displayName: string; role: string };
    };
  };

  it("logs in a seeded account and returns the current user", async () => {
    const result = await login("student1");
    expect(result.user).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "学生一",
      role: "STUDENT",
    });

    const me = await request(createAuthApp())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${result.token}`);
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual(result.user);
  });

  it("rejects unknown accounts and invalid request bodies", async () => {
    const missing = await request(createAuthApp())
      .post("/api/v1/auth/demo-login")
      .send({ account: "missing" });
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe("UNAUTHENTICATED");

    const invalid = await request(createAuthApp())
      .post("/api/v1/auth/demo-login")
      .send({ account: "student1", role: "ORGANIZER" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing, tampered, and expired tokens", async () => {
    const app = createAuthApp();
    const missing = await request(app).get("/api/v1/auth/me");
    expect(missing.status).toBe(401);

    const result = await login("student1");
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
    const student = await login("student1");
    const organizer = await login("organizer1");

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
