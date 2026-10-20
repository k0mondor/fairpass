import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { InspectorWorkspace, OrganizerWorkspace } from "../src/pages/RolePages";
import { dateLabel, timeLabel } from "../src/pages/StudentPages";
import { roleApi } from "../src/api/client";
import { event, page, ticket } from "./fixtures";

it("displays local dates correctly across a UTC date boundary", () => {
  expect(dateLabel("2026-10-19T20:30:00Z")).toContain("20");
  expect(timeLabel("2026-10-19T20:30:00Z")).toBe("04:30");
});

it("explains the check-in window and enables redemption only while it is open", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T04:00:00Z"));
  const timedEvent = {
    ...event,
    startAt: "2026-10-20T04:31:00Z",
    endAt: "2026-10-20T04:33:00Z",
  };
  vi.spyOn(roleApi, "ticket").mockResolvedValue({
    ...ticket(),
    event: timedEvent,
  });
  const redeem = vi.spyOn(roleApi, "redeem");
  render(
    <InspectorWorkspace preview={false} token="token" sampleEvent={event} />,
  );
  fireEvent.change(screen.getByLabelText("票号"), {
    target: { value: ticket().id },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "查询门票" }));
  });
  expect(
    screen.getByText("验票尚未开放，将在活动开始前30分钟开放。"),
  ).toBeTruthy();
  expect(screen.getByText(/12:31.*12:33 UTC\+8/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "确认核销" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "确认核销" }));
  expect(redeem).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(screen.getByText("当前处于验票时间内。")).toBeTruthy();
  expect(screen.getByRole("button", { name: "确认核销" })).toHaveProperty(
    "disabled",
    false,
  );
  await act(() => vi.advanceTimersByTimeAsync(32 * 60_000));
  expect(screen.getByText("验票时间已结束，不能核销。")).toBeTruthy();
  expect(screen.getByRole("button", { name: "确认核销" })).toHaveProperty(
    "disabled",
    true,
  );
});

it("filters confirmed operations through text controls instead of a dropdown", async () => {
  vi.spyOn(roleApi, "events").mockResolvedValue(page([event]));
  vi.spyOn(roleApi, "event").mockResolvedValue(event);
  const operations = vi
    .spyOn(roleApi, "eventOperations")
    .mockResolvedValue(page([]));
  render(
    <OrganizerWorkspace
      preview={false}
      token="token"
      user={{ id: event.organizerId, displayName: "morgan", role: "ORGANIZER" }}
      samples={[]}
      artwork={() => null}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /回归验证专场/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: "查看全部记录 →" }),
  );
  expect(screen.getByRole("group", { name: "记录类型" })).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "门票转让", exact: true }),
  );
  expect(operations).toHaveBeenLastCalledWith(
    "token",
    event.id,
    1,
    "TICKET_TRANSFERRED",
  );
  expect(
    screen
      .getByRole("button", { name: "门票转让", exact: true })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
