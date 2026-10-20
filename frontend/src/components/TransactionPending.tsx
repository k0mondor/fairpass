import { useEffect, useState } from "react";

export function TransactionPending({ active }: { active: boolean }) {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    setWaiting(false);
    if (!active) return;
    const timer = window.setTimeout(() => setWaiting(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [active]);
  return active && waiting ? (
    <p className="role-notice" role="status">
      交易仍在处理中，正在等待链上确认。请勿重复提交。
    </p>
  ) : null;
}
