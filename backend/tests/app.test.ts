import { Router } from "express";
import request, { type Response } from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ApiError } from "../src/errors/api-error.js";
import type { LogRecord } from "../src/middleware/request-logger.js";

const allowedOrigin = "http://127.0.0.1:5173";
const config = {
  corsOrigins: [allowedOrigin],
  jsonBodyLimit: "100kb",
};
const silentLog = () => undefined;
const app = createApp({ config, logSink: silentLog });

const expectRequestId = (response: Response) => {
  const header = response.headers["x-request-id"];
  expect(header).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  return header as string;
};

describe("HTTP application", () => {
  it("keeps the health check outside the API namespace", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expectRequestId(response);
  });

  it("mounts the API namespace and returns the common 404 shape", async () => {
    const response = await request(app).get("/api/v1/not-implemented");
    const requestId = expectRequestId(response);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: "NOT_FOUND", message: "资源不存在", requestId },
    });
  });

  it("allows the configured frontend origin", async () => {
    const response = await request(app).get("/health").set("Origin", allowedOrigin);

    expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
  });

  it("does not allow an unconfigured browser origin", async () => {
    const response = await request(app)
      .get("/health")
      .set("Origin", "https://untrusted.example");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers preflight without authentication", async () => {
    const response = await request(app)
      .options("/api/v1/events")
      .set("Origin", allowedOrigin)
      .set("Access-Control-Request-Method", "POST")
      .set(
        "Access-Control-Request-Headers",
        "Authorization, Content-Type, Idempotency-Key",
      );

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(response.headers["access-control-allow-headers"]).toBe(
      "Authorization,Content-Type,Idempotency-Key",
    );
    expectRequestId(response);
  });

  it("maps malformed JSON to a safe validation error", async () => {
    const response = await request(app)
      .post("/api/v1/events")
      .set("Content-Type", "application/json")
      .send('{"broken"');
    const requestId = expectRequestId(response);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "请求内容无效", requestId },
    });
    expect(JSON.stringify(response.body)).not.toContain("SyntaxError");
  });

  it("rejects JSON bodies over 100 KB", async () => {
    const response = await request(app)
      .post("/api/v1/events")
      .send({ description: "x".repeat(101 * 1024) });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.requestId).toBe(expectRequestId(response));
  });

  it("maps business errors and hides unexpected exception details", async () => {
    const router = Router();
    router.get("/conflict", () => {
      throw new ApiError("ALREADY_REGISTERED", "已报名");
    });
    router.get("/failure", () => {
      throw new Error("secret internal detail");
    });
    const errorApp = createApp({ config, apiRouter: router, logSink: silentLog });

    const conflict = await request(errorApp).get("/api/v1/conflict");
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatchObject({
      code: "ALREADY_REGISTERED",
      message: "已报名",
      requestId: expectRequestId(conflict),
    });

    const failure = await request(errorApp).get("/api/v1/failure");
    expect(failure.status).toBe(500);
    expect(failure.body.error).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "服务器内部错误",
      requestId: expectRequestId(failure),
    });
    expect(JSON.stringify(failure.body)).not.toContain("secret internal detail");
  });

  it("writes structured logs without headers, query strings, or tokens", async () => {
    const records: LogRecord[] = [];
    const loggedApp = createApp({
      config,
      logSink: (record) => records.push(record),
    });

    const response = await request(loggedApp)
      .get("/api/v1/events/event-123?token=query-secret")
      .set("Authorization", "Bearer header-secret");

    expect(response.status).toBe(404);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "info",
      message: "request_completed",
      requestId: response.headers["x-request-id"],
      method: "GET",
      path: "/api/v1/events/event-123",
      statusCode: 404,
      eventId: "event-123",
      errorCode: "NOT_FOUND",
    });
    expect(JSON.stringify(records[0])).not.toContain("header-secret");
    expect(JSON.stringify(records[0])).not.toContain("query-secret");
  });
});
