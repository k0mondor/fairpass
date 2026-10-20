import { useState } from "react";
import type { Role } from "../api/client";
import "./login-page.css";

export function LoginPage({
  role,
  account,
  password,
  busy,
  restoring,
  error,
  onAccount,
  onPassword,
  onSubmit,
}: {
  role: Role;
  account: string;
  password: string;
  busy: boolean;
  restoring: boolean;
  error: string;
  onAccount: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const roleLabel = {
    STUDENT: "学生",
    ORGANIZER: "主办方",
    INSPECTOR: "验票员",
  }[role];
  return (
    <section className="login-page" aria-label="登录">
      <div className="login-intro">
        <h1>
          Your next
          <br />
          <em>experience awaits.</em>
        </h1>
        <p>校园活动，从这里开始。</p>
      </div>
      <div className="login-form-area">
        <h2>Welcome back.</h2>
        <p className="login-subtitle">{roleLabel}登录</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          aria-busy={busy || restoring}
        >
          <label htmlFor="login-account">账号</label>
          <input
            id="login-account"
            name="username"
            autoComplete="username"
            placeholder="请输入账号"
            value={account}
            onChange={(event) => onAccount(event.target.value)}
            required
            maxLength={50}
            disabled={busy || restoring}
            autoCapitalize="none"
            spellCheck={false}
          />
          <label htmlFor="login-password">密码</label>
          <div className="login-password">
            <input
              id="login-password"
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              placeholder="请输入密码"
              value={password}
              onChange={(event) => onPassword(event.target.value)}
              required
              maxLength={128}
              disabled={busy || restoring}
            />
            <button
              type="button"
              aria-label={visible ? "隐藏密码" : "显示密码"}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
              disabled={busy || restoring}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="3"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
                {visible && (
                  <path
                    d="m4 3 16 18"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                )}
              </svg>
            </button>
          </div>
          {error && (
            <p id="login-error" className="login-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="login-submit"
            type="submit"
            disabled={busy || restoring}
          >
            {restoring ? (
              "正在恢复登录…"
            ) : busy ? (
              "正在登录…"
            ) : (
              <>
                登录 <span aria-hidden="true">→</span>
              </>
            )}
          </button>
        </form>
      </div>
    </section>
  );
}
