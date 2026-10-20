import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ApplicationsPage,
  EventDetailPage,
  OperationTimeline,
  TransferPanel,
} from "../src/pages/StudentPages";
import { TransactionPending } from "../src/components/TransactionPending";
import { event, ticket } from "./fixtures";

const props = {
  artwork: null,
  busy: false,
  error: "",
  onBack: vi.fn(),
  onRegister: vi.fn(),
  onClaim: vi.fn(),
  onTickets: vi.fn(),
};
describe("fresh event detail", () => {
  it("updates waiting registration to a confirmed winner on a new detail response", () => {
    const registration = {
      id: "reg",
      eventId: event.id,
      userId: "student-1",
      status: "REGISTERED" as const,
      createdAt: event.createdAt,
    };
    const { rerender } = render(
      <EventDetailPage
        {...props}
        event={{ ...event, myRegistration: registration }}
      />,
    );
    expect(screen.getByText("已报名，抽签后可在这里查看结果。")).toBeTruthy();
    rerender(
      <EventDetailPage
        {...props}
        event={{
          ...event,
          status: "DRAWN",
          myRegistration: { ...registration, status: "WON" },
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "领取门票" })).toBeTruthy();
    expect(screen.queryByText("已报名，抽签后可在这里查看结果。")).toBeNull();
  });

  it("removes the held-ticket action when fresh detail explicitly has no ticket", () => {
    const { rerender } = render(
      <EventDetailPage {...props} event={{ ...event, myTicket: ticket() }} />,
    );
    expect(screen.getByRole("button", { name: /查看我的门票/ })).toBeTruthy();
    rerender(<EventDetailPage {...props} event={event} />);
    expect(screen.queryByRole("button", { name: /查看我的门票/ })).toBeNull();
    expect(screen.getByRole("button", { name: /报名/ })).toBeTruthy();
  });
});

describe("chain history states", () => {
  it("distinguishes loading, failure with retry, and confirmed empty", () => {
    const retry = vi.fn();
    const { rerender } = render(
      <OperationTimeline operations={[]} preview={false} loading />,
    );
    expect(screen.getByRole("status").textContent).toContain("正在查询");
    rerender(
      <OperationTimeline
        operations={[]}
        preview={false}
        error="网络中断"
        onRetry={retry}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("网络中断");
    expect(screen.queryByText("暂无这张门票的已确认链上记录。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试查询" }));
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(<OperationTimeline operations={[]} preview={false} />);
    expect(screen.getByText("暂无这张门票的已确认链上记录。")).toBeTruthy();
  });
});

it("shows a slow confirmation message and clears it when the operation ends", async () => {
  vi.useFakeTimers();
  const { rerender } = render(<TransactionPending active />);
  expect(screen.queryByRole("status")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(8_000));
  expect(screen.getByRole("status").textContent).toContain("请勿重复提交");
  rerender(<TransactionPending active={false} />);
  expect(screen.queryByRole("status")).toBeNull();
});

it("does not offer another claim for a ticket already claimed and transferred", () => {
  const registration = {
    id: "reg",
    eventId: event.id,
    userId: "student-1",
    status: "WON" as const,
    createdAt: event.createdAt,
    ticketClaimed: true,
    event,
  };
  const { rerender } = render(
    <ApplicationsPage
      registrations={[registration]}
      ticketEventIds={[]}
      loading={false}
      error=""
      page={1}
      total={1}
      onRetry={vi.fn()}
      onPage={vi.fn()}
      onOpen={vi.fn()}
      onClaim={vi.fn()}
      claiming={null}
      artwork={() => null}
    />,
  );
  expect(screen.queryByRole("button", { name: /领取门票/ })).toBeNull();
  expect(screen.getByText("门票已领取并转出，不能重复领取。")).toBeTruthy();
  rerender(
    <EventDetailPage
      {...props}
      event={{ ...event, myRegistration: registration, myTicketClaimed: true }}
    />,
  );
  expect(screen.queryByRole("button", { name: /领取门票/ })).toBeNull();
  expect(screen.getByText("门票已领取并转出，不能重复领取。")).toBeTruthy();
});

it("asks for a typed recipient username and never lists preset recipients", () => {
  const onRecipient = vi.fn();
  const onSubmit = vi.fn();
  const panelProps = {
    preview: false,
    title: event.title,
    ticketId: ticket().id,
    busy: false,
    error: "",
    onRecipient,
    onSubmit,
    onClose: vi.fn(),
  };
  const { rerender } = render(<TransferPanel {...panelProps} recipient="" />);
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByRole("button", { name: "确认转让" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.change(screen.getByLabelText("接收方用户名"), {
    target: { value: "jamie" },
  });
  expect(onRecipient).toHaveBeenCalledWith("jamie");
  rerender(<TransferPanel {...panelProps} recipient="jamie" />);
  fireEvent.click(screen.getByRole("button", { name: "确认转让" }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
