import { describe, expect, it, vi } from "vitest";
import {
  READ_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  studentApi,
  roleApi,
} from "../src/api/client";
import { page, ticket } from "./fixtures";

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("complete current-owner ticket list", () => {
  it("loads the second page and retains tickets beyond 20", async () => {
    const tickets = Array.from({ length: 21 }, (_, i) => ticket(i + 1));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(page(tickets.slice(0, 20), 1, 21)))
      .mockResolvedValueOnce(json(page(tickets.slice(20), 2, 21)));
    vi.stubGlobal("fetch", fetch);
    const result = await studentApi.allTickets("token");
    expect(result).toHaveLength(21);
    expect(result[20].id).toBe(tickets[20].id);
    expect(fetch.mock.calls[1][0]).toContain("page=2");
  });

  it("does not return a misleading partial list if a later page fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json(
            page(
              Array.from({ length: 20 }, (_, i) => ticket(i + 1)),
              1,
              21,
            ),
          ),
        )
        .mockRejectedValueOnce(new Error("offline")),
    );
    await expect(studentApi.allTickets("token")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("stops on an empty wallet without requesting another page", async () => {
    const fetch = vi.fn().mockResolvedValue(json(page([])));
    vi.stubGlobal("fetch", fetch);
    expect(await studentApi.allTickets("token")).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("transaction confirmation wait", () => {
  function pendingFetch() {
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("keeps a write alive after 12 seconds and labels eventual timeout uncertain", async () => {
    vi.useFakeTimers();
    const fetch = pendingFetch();
    const pending = studentApi
      .claim("token", "event-1")
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 1);
    expect(fetch.mock.calls[0][1].signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
    const error = await pending;
    expect(error.code).toBe("TIMEOUT");
    expect(error.message).toContain("结果尚未确定");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("still times out read requests promptly", async () => {
    vi.useFakeTimers();
    pendingFetch();
    const pending = studentApi.me("token").catch((error) => error);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect((await pending).code).toBe("TIMEOUT");
  });

  it("accepts a delayed confirmed write without automatically resubmitting", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(json({ data: ticket() })), 20_000);
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const pending = studentApi.claim("token", "event-1");
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await pending).id).toBe(ticket().id);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats a disconnected write as uncertain, rather than a definitive rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(roleApi.redeem("token", ticket().id)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: expect.stringContaining("交易结果尚未确定"),
    });
  });
});

it("submits a recipient username rather than a public list or an internal UUID", async () => {
  const fetch = vi.fn().mockResolvedValue(json({ data: ticket() }));
  vi.stubGlobal("fetch", fetch);
  await studentApi.transfer("token", ticket().id, "jamie");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    toAccount: "jamie",
  });
});
