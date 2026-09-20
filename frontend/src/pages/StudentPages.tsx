import type { ReactNode } from "react";
import type {
  Event,
  EventDetail,
  Operation,
  Registration,
  Ticket,
} from "../api/client";
import "./student-pages.css";

export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
export const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));

export const operationLabel = (type: Operation["type"]) =>
  ({
    EVENT_CREATED: "活动创建",
    DRAW_PUBLISHED: "抽签结果发布",
    TICKET_CLAIMED: "门票领取",
    TICKET_TRANSFERRED: "门票转让",
    TICKET_REDEEMED: "门票核销",
  })[type];

function Cover({
  event,
  art,
  compact = false,
}: {
  event: Event;
  art: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`event-cover ${compact ? "cover-compact" : ""}`}>
      <span className="cover-name">{event.title}</span>
      <span className="cover-art">{art}</span>
      <span className="cover-foot">FAIRPASS / CAMPUS EXPERIENCES</span>
    </div>
  );
}

function SheetHeading({
  children,
  italic,
  description,
}: {
  children: ReactNode;
  italic: string;
  description: string;
}) {
  return (
    <header className="student-sheet-heading">
      <h1>
        {children} <em>{italic}</em>
      </h1>
      <p>{description}</p>
    </header>
  );
}

function LoadingLine() {
  return (
    <p className="list-message" role="status">
      正在加载最新信息…
    </p>
  );
}

export function EventsPage({
  events,
  loading,
  error,
  page,
  total,
  onRetry,
  onPage,
  onSelect,
  artwork,
}: {
  events: Event[];
  loading: boolean;
  error: string;
  page: number;
  total: number;
  onRetry: () => void;
  onPage: (page: number) => void;
  onSelect: (id: string) => void;
  artwork: (event: Event) => ReactNode;
}) {
  return (
    <section className="editorial-stage">
      <div className="editorial-sheet student-sheet">
        <SheetHeading
          italic="something good."
          description="看看校园里正在发生什么，找到想参加的活动。"
        >
          Make room for
        </SheetHeading>
        {error && (
          <div className="inline-error" role="alert">
            {error} <button onClick={onRetry}>重试</button>
          </div>
        )}
        {loading ? (
          <LoadingLine />
        ) : events.length === 0 ? (
          <div className="empty-message">
            <h2>暂时没有活动</h2>
            <p>新活动发布后，会出现在这里。</p>
          </div>
        ) : (
          <div className="student-event-list">
            {events.map((event) => (
              <button
                className="student-event-row"
                key={event.id}
                onClick={() => onSelect(event.id)}
              >
                <Cover event={event} art={artwork(event)} />
                <span className="event-row-copy">
                  <small>
                    {event.status === "OPEN"
                      ? "报名中"
                      : event.status === "DRAWING"
                        ? "抽签中"
                        : event.status === "DRAWN"
                          ? "已抽签"
                          : "已结束"}
                  </small>
                  <strong>{event.title}</strong>
                  <span className="event-row-description">
                    {event.description}
                  </span>
                  <span className="event-row-facts">
                    <span>
                      {dateLabel(event.startAt)} · {timeLabel(event.startAt)}
                    </span>
                    <span>{event.location}</span>
                  </span>
                  <span className="event-row-deadline">
                    报名截止：{dateLabel(event.registrationDeadline)}
                  </span>
                </span>
                <span className="event-row-arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            ))}
          </div>
        )}
        {total > 20 && (
          <div className="list-pager">
            <button disabled={page === 1} onClick={() => onPage(page - 1)}>
              ← 上一页
            </button>
            <span>
              第 {page} / {Math.ceil(total / 20)} 页
            </span>
            <button
              disabled={page * 20 >= total}
              onClick={() => onPage(page + 1)}
            >
              下一页 →
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function EventDetailPage({
  event,
  registration,
  ticket,
  artwork,
  busy,
  error,
  onBack,
  onRegister,
  onClaim,
  onTickets,
}: {
  event: EventDetail;
  registration: Registration | null;
  ticket: Ticket | null;
  artwork: ReactNode;
  busy: boolean;
  error: string;
  onBack: () => void;
  onRegister: () => void;
  onClaim: () => void;
  onTickets: () => void;
}) {
  const registered = registration ?? event.myRegistration;
  const held = ticket ?? event.myTicket;
  const beforeStart = Date.now() < new Date(event.startAt).getTime();
  const canRegister =
    event.status === "OPEN" &&
    Date.now() < new Date(event.registrationDeadline).getTime();
  return (
    <section className="editorial-stage">
      <div className="editorial-sheet student-sheet detail-sheet">
        <button className="text-back" onClick={onBack}>
          ← 返回活动
        </button>
        <Cover event={event} art={artwork} />
        <div className="event-detail-content">
          <div>
            <span className="detail-status">
              {event.status === "OPEN"
                ? "报名中"
                : event.status === "DRAWING"
                  ? "抽签中"
                  : event.status === "DRAWN"
                    ? "已抽签"
                    : "活动已结束"}
            </span>
            <h1>{event.title}</h1>
            <p className="event-detail-description">{event.description}</p>
          </div>
          <div className="detail-action-area">
            {held ? (
              <button className="blue-action" onClick={onTickets}>
                查看我的门票 ↗
              </button>
            ) : registered?.status === "WON" && beforeStart ? (
              <button className="blue-action" disabled={busy} onClick={onClaim}>
                {busy ? "正在领取…" : "领取门票"}
              </button>
            ) : registered?.status === "WON" ? (
              <p className="detail-decision">领取时间已结束。</p>
            ) : registered?.status === "LOST" ? (
              <p className="detail-decision">本次抽签未中签。</p>
            ) : registered ? (
              <p className="detail-decision">
                已报名，抽签后可在这里查看结果。
              </p>
            ) : canRegister ? (
              <button
                className="blue-action"
                disabled={busy}
                onClick={onRegister}
              >
                {busy ? "正在报名…" : "报名活动"}
              </button>
            ) : (
              <p className="detail-decision">报名已截止。</p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
        <dl className="event-detail-facts">
          <div>
            <dt>活动时间</dt>
            <dd>
              {dateLabel(event.startAt)}
              <br />
              {timeLabel(event.startAt)} – {timeLabel(event.endAt)} UTC
            </dd>
          </div>
          <div>
            <dt>地点</dt>
            <dd>{event.location}</dd>
          </div>
          <div>
            <dt>报名截止</dt>
            <dd>
              {dateLabel(event.registrationDeadline)} ·{" "}
              {timeLabel(event.registrationDeadline)} UTC
            </dd>
          </div>
          <div>
            <dt>活动名额</dt>
            <dd>{event.capacity}</dd>
          </div>
        </dl>
        <p className="sheet-fineprint">
          抽签结果和门票归属以服务端确认的信息为准。报名成功不代表已经获得门票。
        </p>
      </div>
    </section>
  );
}

export function ApplicationsPage({
  registrations,
  ticketEventIds,
  loading,
  error,
  page,
  total,
  onRetry,
  onPage,
  onOpen,
  onClaim,
  claiming,
  artwork,
}: {
  registrations: Registration[];
  ticketEventIds: string[];
  loading: boolean;
  error: string;
  page: number;
  total: number;
  onRetry: () => void;
  onPage: (page: number) => void;
  onOpen: (id: string) => void;
  onClaim: (id: string) => void;
  claiming: string | null;
  artwork: (event: Event) => ReactNode;
}) {
  return (
    <section className="editorial-stage">
      <div className="editorial-sheet student-sheet">
        <SheetHeading
          italic="the list."
          description="报名进度、抽签结果和领票状态，都可以在这里查看。"
        >
          You're on
        </SheetHeading>
        {error && (
          <div className="inline-error" role="alert">
            {error} <button onClick={onRetry}>重试</button>
          </div>
        )}
        {loading ? (
          <LoadingLine />
        ) : registrations.length === 0 ? (
          <div className="empty-message">
            <h2>还没有报名记录</h2>
            <p>找到感兴趣的活动，在报名截止前参加。</p>
            <button onClick={() => onOpen("")}>浏览活动 ↗</button>
          </div>
        ) : (
          <div className="registration-list">
            {registrations.map((registration) => {
              const event = registration.event;
              if (!event) return null;
              const claimable =
                registration.status === "WON" &&
                !ticketEventIds.includes(event.id) &&
                Date.now() < new Date(event.startAt).getTime();
              return (
                <div className="registration-row" key={registration.id}>
                  <button
                    className="registration-cover-button"
                    onClick={() => onOpen(event.id)}
                    aria-label={`查看活动：${event.title}`}
                  >
                    <Cover event={event} art={artwork(event)} compact />
                  </button>
                  <div className="registration-title">
                    <small>{dateLabel(event.startAt)}</small>
                    <button onClick={() => onOpen(event.id)}>
                      {event.title} ↗
                    </button>
                    <p>{event.location}</p>
                  </div>
                  <div className="registration-result">
                    <strong>
                      {registration.status === "WON"
                        ? "已中签"
                        : registration.status === "LOST"
                          ? "未中签"
                          : "已报名"}
                    </strong>
                    {registration.status === "REGISTERED" && (
                      <span>等待抽签</span>
                    )}
                    <p>
                      {registration.status === "WON"
                        ? "请在活动开始前领取门票。"
                        : registration.status === "LOST"
                          ? "感谢参与，欢迎看看其他活动。"
                          : "抽签结束后，这里会显示结果。"}
                    </p>
                    {claimable && (
                      <button
                        className="blue-action"
                        disabled={claiming === event.id}
                        onClick={() => onClaim(event.id)}
                      >
                        {claiming === event.id ? "正在领取…" : "领取门票 →"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {total > 20 && (
          <div className="list-pager">
            <button disabled={page === 1} onClick={() => onPage(page - 1)}>
              ← 上一页
            </button>
            <span>
              第 {page} / {Math.ceil(total / 20)} 页
            </span>
            <button
              disabled={page * 20 >= total}
              onClick={() => onPage(page + 1)}
            >
              下一页 →
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function TransferPanel({
  preview,
  title,
  ticketId,
  busy,
  error,
  recipient,
  onRecipient,
  onClose,
  onSubmit,
}: {
  preview: boolean;
  title: string;
  ticketId: string;
  busy: boolean;
  error: string;
  recipient: string;
  onRecipient: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div
      className="transfer-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="transfer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
      >
        <button
          className="transfer-close"
          onClick={onClose}
          aria-label="关闭转让窗口"
        >
          ×
        </button>
        <h2 id="transfer-title">
          Pass it <em>on.</em>
        </h2>
        <p>
          将 <strong>{title}</strong> 的门票转让给另一位学生。
        </p>
        <label htmlFor="recipient-id">接收方学生 ID</label>
        <input
          id="recipient-id"
          value={recipient}
          onChange={(event) => onRecipient(event.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          autoFocus
        />
        <p className="transfer-note">
          {preview
            ? "这是界面预览。确认后不会改变门票归属。"
            : "确认后门票会立即转给对方。活动开始前，每张票只能转让一次；转让后你将不再持有这张票。"}
        </p>
        <div className="transfer-confirmation">
          <span>活动</span>
          <strong>{title}</strong>
          <span>接收方</span>
          <code>{recipient || "请输入接收方 ID"}</code>
          <span>门票</span>
          <code>{ticketId}</code>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="blue-action"
          disabled={
            busy ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              recipient.trim(),
            )
          }
          onClick={onSubmit}
        >
          {busy ? "正在确认转让…" : preview ? "预览转让" : "确认转让"}
        </button>
        <button className="quiet-action" onClick={onClose}>
          暂不转让
        </button>
      </section>
    </div>
  );
}

export function IncomingTransfersPage({ onBack }: { onBack: () => void }) {
  return (
    <section className="editorial-stage incoming-stage">
      <div className="incoming-wrap">
        <button className="text-back" onClick={onBack}>
          ← 我的门票
        </button>
        <h1>待接收门票</h1>
        <div className="incoming-empty">
          <h2>暂时没有待接收门票</h2>
          <p>
            当前版本在转让方确认后会直接变更门票归属，因此暂无“接受”或“拒绝”邀请的操作。
          </p>
          <button onClick={onBack}>返回我的门票 →</button>
        </div>
      </div>
    </section>
  );
}

export function OperationTimeline({
  operations,
  preview,
}: {
  operations: Operation[];
  preview: boolean;
}) {
  if (preview)
    return (
      <p className="record-empty">
        这是一张预览门票。连接服务后，已确认的链上记录会显示在这里。
      </p>
    );
  if (!operations.length)
    return <p className="record-empty">暂无这张门票的已确认链上记录。</p>;
  return (
    <ol className="operation-timeline">
      {operations.map((operation) => (
        <li key={operation.id}>
          <strong>{operationLabel(operation.type)}</strong>
          <time>
            {dateLabel(operation.occurredAt)} ·{" "}
            {timeLabel(operation.occurredAt)} UTC
          </time>
          <details>
            <summary>{operation.txId.slice(0, 16)}… · 查看详情</summary>
            <dl>
              <div>
                <dt>交易 ID</dt>
                <dd>
                  {operation.txId}{" "}
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(operation.txId)
                    }
                  >
                    复制
                  </button>
                </dd>
              </div>
              <div>
                <dt>通道 / 链码</dt>
                <dd>
                  {operation.channelName} / {operation.chaincodeName}
                </dd>
              </div>
              <div>
                <dt>操作者</dt>
                <dd>{operation.actorId}</dd>
              </div>
              {operation.ticketId && (
                <div>
                  <dt>门票</dt>
                  <dd>{operation.ticketId}</dd>
                </div>
              )}
              {operation.fromUserId && (
                <div>
                  <dt>转出方</dt>
                  <dd>{operation.fromUserId}</dd>
                </div>
              )}
              {operation.toUserId && (
                <div>
                  <dt>接收方</dt>
                  <dd>{operation.toUserId}</dd>
                </div>
              )}
              <div>
                <dt>区块</dt>
                <dd>{operation.blockNumber ?? "未提供"}</dd>
              </div>
            </dl>
          </details>
        </li>
      ))}
    </ol>
  );
}
