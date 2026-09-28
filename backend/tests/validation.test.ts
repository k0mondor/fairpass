import { describe, expect, it } from "vitest";

import { ApiError } from "../src/errors/api-error.js";
import { parseInput } from "../src/validation/parse.js";
import {
  createEventBodySchema,
  demoLoginBodySchema,
  eventListQuerySchema,
  ticketIdSchema,
  uuidSchema,
} from "../src/validation/schemas.js";

describe("request validation", () => {
  it("validates UUIDs and 64-character lowercase ticket IDs", () => {
    expect(uuidSchema.safeParse("11111111-1111-4111-8111-111111111111").success).toBe(true);
    expect(uuidSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(ticketIdSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(ticketIdSchema.safeParse("A".repeat(64)).success).toBe(false);
  });

  it("applies pagination defaults and limits", () => {
    expect(parseInput(eventListQuerySchema, {})).toEqual({ page: 1, pageSize: 20 });
    expect(parseInput(eventListQuerySchema, { page: "2", pageSize: "100", status: "OPEN" })).toEqual({
      page: 2,
      pageSize: 100,
      status: "OPEN",
    });
    expect(() => parseInput(eventListQuerySchema, { pageSize: "101" })).toThrow(ApiError);
  });

  it("rejects unknown login fields and unsafe account shapes", () => {
    expect(parseInput(demoLoginBodySchema, { account: " student1 " })).toEqual({ account: "student1" });
    expect(() => parseInput(demoLoginBodySchema, { account: "student 1" })).toThrow(ApiError);
    expect(() => parseInput(demoLoginBodySchema, { account: "student1", role: "ORGANIZER" })).toThrow(ApiError);
  });

  it("checks event strings, integers, timezone-aware dates, and ordering", () => {
    const valid = {
      title: "Campus Design Night",
      description: "Student projects",
      location: "Hall A",
      capacity: 120,
      registrationDeadline: "2026-10-01T10:00:00+08:00",
      startAt: "2026-10-02T10:00:00+08:00",
      endAt: "2026-10-02T12:00:00+08:00",
    };
    expect(parseInput(createEventBodySchema, valid).capacity).toBe(120);
    expect(() => parseInput(createEventBodySchema, { ...valid, capacity: 1.5 })).toThrow(ApiError);
    expect(() => parseInput(createEventBodySchema, { ...valid, startAt: valid.registrationDeadline })).toThrow(ApiError);
    expect(() => parseInput(createEventBodySchema, { ...valid, endAt: "not-a-date" })).toThrow(ApiError);
  });
});
