import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { ApiError, studentApi } from "../src/api/client";
import { event, page, ticket } from "./fixtures";

// Keep application data flow and ticket back real; isolate the animation machinery.
vi.mock("../src/components/TicketStage", () => ({
  TicketStage: ({
    tickets,
    back,
    onOpen,
  }: {
    tickets: { id: string }[];
    back: (ticket: { id: string }, onClose: () => void) => ReactNode;
    onOpen: (ticket: { id: string }) => void;
  }) => (
    <div>
      <p>已加载 {tickets.length} 张门票</p>
      <button onClick={() => onOpen(tickets[0])}>打开票务历史</button>
      {back(tickets[0], () => {})}
    </div>
  ),
}));

beforeEach(() => {
  sessionStorage.setItem("fairpass.login.token.v2", "token");
  vi.spyOn(studentApi, "me").mockResolvedValue({
    id: "student-1",
    displayName: "学生一",
    role: "STUDENT",
  });
  vi.spyOn(studentApi, "events").mockResolvedValue(page([event]));
  vi.spyOn(studentApi, "registrations").mockResolvedValue(
    page([
      {
        id: "reg",
        eventId: event.id,
        userId: "student-1",
        status: "REGISTERED",
        createdAt: event.createdAt,
        event,
      },
    ]),
  );
  vi.spyOn(studentApi, "tickets").mockResolvedValue(page([]));
});

describe("student application wiring", () => {
  it("reconciles an interrupted claim and updates the open detail instead of offering another claim", async () => {
    const won = {
      ...event,
      status: "DRAWN" as const,
      myRegistration: {
        id: "reg",
        eventId: event.id,
        userId: "student-1",
        status: "WON" as const,
        createdAt: event.createdAt,
      },
    };
    vi.spyOn(studentApi, "event")
      .mockResolvedValueOnce(won)
      .mockResolvedValueOnce({ ...won, myTicket: ticket() });
    vi.spyOn(studentApi, "claim").mockRejectedValue(
      new ApiError("连接中断", "NETWORK_ERROR", 0),
    );
    vi.mocked(studentApi.tickets)
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([ticket()]));
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: /回归验证专场/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "领取门票" }));
    expect(
      await screen.findByRole("button", { name: /查看我的门票/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "领取门票" })).toBeNull();
    expect(studentApi.claim).toHaveBeenCalledTimes(1);
  });

  it("uses the new detail winner even while the cached registration is still waiting", async () => {
    vi.spyOn(studentApi, "event").mockResolvedValue({
      ...event,
      status: "DRAWN",
      myRegistration: {
        id: "reg",
        eventId: event.id,
        userId: "student-1",
        status: "WON",
        createdAt: event.createdAt,
      },
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: /回归验证专场/ }),
    );
    expect(
      await screen.findByRole("button", { name: "领取门票" }),
    ).toBeTruthy();
    expect(screen.queryByText("已报名，抽签后可在这里查看结果。")).toBeNull();
  });

  it("renders all 21 owned tickets through the real pagination loader", async () => {
    const tickets = Array.from({ length: 21 }, (_, i) => ticket(i + 1));
    vi.mocked(studentApi.tickets)
      .mockResolvedValueOnce(page(tickets.slice(0, 20), 1, 21))
      .mockResolvedValueOnce(page(tickets.slice(20), 2, 21));
    render(<App />);
    await screen.findByRole("button", { name: /回归验证专场/ });
    fireEvent.click(screen.getByRole("button", { name: "我的门票" }));
    expect(await screen.findByText("已加载 21 张门票")).toBeTruthy();
  });

  it("displays a history query failure and recovers through the retry button", async () => {
    vi.mocked(studentApi.tickets).mockResolvedValue(page([ticket()]));
    const operations = vi
      .spyOn(studentApi, "operations")
      .mockRejectedValueOnce(new Error("Fabric暂不可用"))
      .mockResolvedValueOnce(
        page([
          {
            id: "real-tx-id",
            txId: "real-tx-id",
            eventId: event.id,
            ticketId: ticket().id,
            type: "TICKET_CLAIMED",
            actorId: "student-1",
            fromUserId: null,
            toUserId: "student-1",
            occurredAt: event.createdAt,
            channelName: "mychannel",
            chaincodeName: "fairpass",
            blockNumber: null,
          },
        ]),
      );
    render(<App />);
    await screen.findByRole("button", { name: /回归验证专场/ });
    fireEvent.click(screen.getByRole("button", { name: "我的门票" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "打开票务历史" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Fabric暂不可用",
    );
    expect(screen.queryByText("暂无这张门票的已确认链上记录。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试查询" }));
    expect(await screen.findByText("门票领取")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(operations).toHaveBeenCalledTimes(2);
  });
});
