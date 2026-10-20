import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import App from "../src/App";
import { ApiError, studentApi } from "../src/api/client";
import { page } from "./fixtures";

beforeEach(() => {
  vi.spyOn(studentApi, "events").mockResolvedValue(page([]));
  vi.spyOn(studentApi, "registrations").mockResolvedValue(page([]));
  vi.spyOn(studentApi, "tickets").mockResolvedValue(page([]));
});

it("does not auto-login or expose preset accounts, and submits typed credentials with the selected role", async () => {
  const login = vi
    .spyOn(studentApi, "login")
    .mockRejectedValue(
      new ApiError("账号、密码或登录身份不正确", "UNAUTHENTICATED", 401),
    );
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Welcome back." }),
  ).toBeTruthy();
  expect(login).not.toHaveBeenCalled();
  expect(screen.queryByText("alex")).toBeNull();
  expect(screen.queryByText("123456")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "账户菜单" }));
  expect(screen.getByLabelText("登录身份")).toBeTruthy();
  expect(screen.queryByText("学生一")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "主办方", exact: true }));
  expect(screen.getByText("主办方登录")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("账号"), {
    target: { value: "morgan" },
  });
  fireEvent.change(screen.getByLabelText("密码"), {
    target: { value: "wrong" },
  });
  fireEvent.click(screen.getByRole("button", { name: "登录", exact: true }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(login).toHaveBeenCalledWith("morgan", "wrong", "ORGANIZER");
});

it("shows the signed-in username and logs out with no role switching or saved password", async () => {
  vi.spyOn(studentApi, "login").mockResolvedValue({
    token: "new-token",
    user: { id: "student-1", displayName: "alex", role: "STUDENT" },
  });
  render(<App />);
  fireEvent.change(await screen.findByLabelText("账号"), {
    target: { value: "alex" },
  });
  fireEvent.change(screen.getByLabelText("密码"), {
    target: { value: "123456" },
  });
  const password = screen.getByLabelText("密码") as HTMLInputElement;
  expect(password.type).toBe("password");
  fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
  expect(password.type).toBe("text");
  fireEvent.click(screen.getByRole("button", { name: "登录", exact: true }));
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Welcome back." })).toBeNull(),
  );
  expect(
    screen.getByRole("button", { name: "账户菜单" }).textContent,
  ).toContain("alex");
  fireEvent.click(screen.getByRole("button", { name: "账户菜单" }));
  expect(screen.queryByLabelText("登录身份")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "主办方", exact: true }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  expect(await screen.findByLabelText("账号")).toHaveProperty("value", "");
  expect(screen.getByLabelText("密码")).toHaveProperty("value", "");
  expect(sessionStorage.getItem("fairpass.login.token.v2")).toBeNull();
});
