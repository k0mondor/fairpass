import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { sendData, sendPage } from "../src/utils/http-response.js";

describe("HTTP response helpers", () => {
  it("wraps a single result", async () => {
    const app = express();
    app.get("/item", (_request, response) =>
      sendData(response, { id: "event-1" }, 201),
    );

    const response = await request(app).get("/item");

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ data: { id: "event-1" } });
  });

  it("wraps a paginated result", async () => {
    const app = express();
    app.get("/items", (_request, response) =>
      sendPage(response, [{ id: "event-1" }], {
        page: 2,
        pageSize: 20,
        total: 21,
      }),
    );

    const response = await request(app).get("/items");

    expect(response.body).toEqual({
      data: [{ id: "event-1" }],
      page: 2,
      pageSize: 20,
      total: 21,
    });
  });
});
