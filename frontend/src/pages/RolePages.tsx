import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ApiError,
  roleApi,
  type CreateEventInput,
  type Event,
  type Operation,
  type OperationType,
  type Ticket,
  type User,
} from "../api/client";
import { dateLabel, operationLabel, timeLabel } from "./StudentPages";
import "./role-pages.css";

const operationTypes: OperationType[] = [
  "EVENT_CREATED",
  "DRAW_PUBLISHED",
  "TICKET_CLAIMED",
  "TICKET_TRANSFERRED",
  "TICKET_REDEEMED",
];
const emptyForm = () => ({
  title: "",
  description: "",
  location: "",
  capacity: "",
  registrationDeadline: "",
  startAt: "",
  endAt: "",
});
type FormValues = ReturnType<typeof emptyForm>;
const formatStatus = (status: Event["status"]) =>
  ({
    OPEN: "报名中",
    DRAWING: "抽签中",
    DRAWN: "已抽签",
    FINISHED: "已结束",
  })[status];

function RoleHeading({
  title,
  accent,
  description,
}: {
  title: string;
  accent: string;
  description: string;
}) {
  return (
    <header className="role-heading">
      <h1>
        {title} <em>{accent}</em>
      </h1>
      <p>{description}</p>
    </header>
  );
}

function OperationDrawer({
  operation,
  onClose,
}: {
  operation: Operation;
  onClose: () => void;
}) {
  const fields: [string, string | number | null][] = [
    ["类型", operationLabel(operation.type)],
    [
      "时间",
      `${dateLabel(operation.occurredAt)} · ${timeLabel(operation.occurredAt)} UTC`,
    ],
    ["交易 ID", operation.txId],
    ["通道", operation.channelName],
    ["链码", operation.chaincodeName],
    ["门票 ID", operation.ticketId],
    ["操作者 ID", operation.actorId],
    ["转出方", operation.fromUserId],
    ["接收方", operation.toUserId],
    ["区块", operation.blockNumber ?? "未提供"],
  ];
  return (
    <div
      className="role-drawer-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="role-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-title"
      >
        <button
          className="role-drawer-close"
          onClick={onClose}
          aria-label="关闭交易详情"
        >
          ×
        </button>
        <h2 id="operation-title">
          A confirmed <em>record.</em>
        </h2>
        <p>这笔交易已由链上确认。</p>
        <dl className="operation-detail-list">
          {fields
            .filter(([, value]) => value !== null)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {value}
                  {label === "交易 ID" && (
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(operation.txId)
                      }
                    >
                      复制
                    </button>
                  )}
                </dd>
              </div>
            ))}
        </dl>
      </aside>
    </div>
  );
}

function EventForm({
  values,
  busy,
  error,
  onChange,
  onSubmit,
  onClose,
}: {
  values: FormValues;
  busy: boolean;
  error: string;
  onChange: (key: keyof FormValues, value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const field = (key: keyof FormValues, label: string, type = "text") => (
    <label className="role-field" key={key}>
      <span>{label}</span>
      <input
        type={type}
        required
        value={values[key]}
        min={key === "capacity" ? "1" : undefined}
        onChange={(event) => onChange(key, event.target.value)}
      />
    </label>
  );
  return (
    <div
      className="role-drawer-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="role-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
      >
        <button
          className="role-drawer-close"
          onClick={onClose}
          aria-label="关闭创建活动表单"
        >
          ×
        </button>
        <h2 id="create-title">
          A new <em>gathering.</em>
        </h2>
        <p>填写报名截止时间、活动时间和名额。</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {field("title", "活动名称")}
          <label className="role-field">
            <span>活动介绍</span>
            <textarea
              value={values.description}
              maxLength={2000}
              onChange={(event) => onChange("description", event.target.value)}
              rows={4}
            />
          </label>
          {field("location", "活动地点")}
          {field("capacity", "门票名额", "number")}
          {field("registrationDeadline", "报名截止时间", "datetime-local")}
          {field("startAt", "活动开始时间", "datetime-local")}
          {field("endAt", "活动结束时间", "datetime-local")}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="blue-action role-submit"
            disabled={busy}
            type="submit"
          >
            {busy ? "正在创建活动…" : "创建活动 →"}
          </button>
        </form>
      </aside>
    </div>
  );
}

export function OrganizerWorkspace({
  preview,
  token,
  user,
  samples,
  artwork,
}: {
  preview: boolean;
  token?: string;
  user: User;
  samples: Event[];
  artwork: (event: Event) => ReactNode;
}) {
  const [events, setEvents] = useState<Event[]>(preview ? samples : []);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(preview ? samples.length : 0);
  const [selected, setSelected] = useState<Event | null>(null);
  const [screen, setScreen] = useState<"list" | "detail" | "records">("list");
  const [formOpen, setFormOpen] = useState(false);
  const [values, setValues] = useState<FormValues>(emptyForm);
  const keyRef = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [operations, setOperations] = useState<Operation[]>([]);
  const [operationPage, setOperationPage] = useState(1);
  const [operationTotal, setOperationTotal] = useState(0);
  const [filter, setFilter] = useState("");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [drawInfo, setDrawInfo] = useState<{
    winnerCount: number;
    winnersHash?: string;
    txId?: string;
  } | null>(null);
  const [previewDrawCount, setPreviewDrawCount] = useState<number | null>(null);

  async function loadEvents(nextPage = page) {
    if (!token) return;
    setBusy("load");
    setError("");
    try {
      const response = await roleApi.events(token, nextPage);
      setEvents(response.data);
      setTotal(response.total);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "暂时无法加载活动。",
      );
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    if (token) void loadEvents(page);
  }, [token, page]);

  async function loadOperations(id: string, nextPage = 1, type = "") {
    if (!token) return;
    try {
      const response = await roleApi.eventOperations(token, id, nextPage, type);
      setOperations(response.data);
      setOperationTotal(response.total);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "暂时无法加载链上记录。",
      );
    }
  }

  async function openEvent(event: Event) {
    setError("");
    setNotice("");
    setSelected(event);
    setScreen("detail");
    setOperations([]);
    setDrawInfo(null);
    setPreviewDrawCount(null);
    window.scrollTo({ top: 0, behavior: "instant" });
    if (!token) return;
    setBusy("detail");
    try {
      const [detail, ops] = await Promise.all([
        roleApi.event(token, event.id),
        roleApi.eventOperations(token, event.id),
      ]);
      setSelected(detail);
      setOperations(ops.data);
      setOperationTotal(ops.total);
      if (detail.status === "DRAWN") {
        const draw = await roleApi.drawDetail(token, event.id);
        setDrawInfo({
          winnerCount: draw.winnerCount,
          winnersHash: draw.winnersHash || undefined,
        });
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "暂时无法加载活动详情。",
      );
    } finally {
      setBusy("");
    }
  }

  function changeForm(key: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    keyRef.current = crypto.randomUUID();
    setError("");
  }

  async function create() {
    if (busy) return;
    const start = new Date(values.startAt).getTime();
    const end = new Date(values.endAt).getTime();
    const deadline = new Date(values.registrationDeadline).getTime();
    if (
      !values.title.trim() ||
      !values.location.trim() ||
      !Number.isInteger(Number(values.capacity)) ||
      Number(values.capacity) < 1 ||
      !(deadline < start && start < end)
    ) {
      setError(
        "请填写活动名称、地点和大于 0 的名额；报名须在活动开始前截止，活动结束时间须晚于开始时间。",
      );
      return;
    }
    const input: CreateEventInput = {
      title: values.title.trim(),
      description: values.description.trim(),
      location: values.location.trim(),
      capacity: Number(values.capacity),
      registrationDeadline: new Date(deadline).toISOString(),
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
    };
    setBusy("create");
    setError("");
    try {
      const created = preview
        ? {
            ...input,
            id: crypto.randomUUID(),
            organizerId: user.id,
            status: "OPEN" as const,
            registrationCount: 0,
            winnerCount: 0,
            issuedCount: 0,
            redeemedCount: 0,
            createdAt: new Date().toISOString(),
          }
        : await roleApi.createEvent(token!, input, keyRef.current);
      setEvents((current) => [created, ...current]);
      setTotal((count) => count + 1);
      setFormOpen(false);
      setValues(emptyForm());
      keyRef.current = crypto.randomUUID();
      setNotice(
        preview
          ? "活动已加入本地预览，没有发送链上交易。"
          : "活动创建成功，交易已确认。",
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "创建活动失败。");
    } finally {
      setBusy("");
    }
  }

  async function draw() {
    if (!selected || busy) return;
    setBusy("draw");
    setError("");
    try {
      if (preview) {
        setPreviewDrawCount(
          Math.min(selected.capacity, selected.registrationCount),
        );
        setNotice("这只是本地抽签预览，没有选出中签者，也没有生成链上交易。");
      } else if (token) {
        const result = await roleApi.draw(token, selected.id);
        const detail = await roleApi.event(token, selected.id);
        setSelected(detail);
        setDrawInfo(result);
        await loadOperations(selected.id);
        setNotice("抽签结果已在链上确认。");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "抽签未完成。");
      if (
        token &&
        failure instanceof ApiError &&
        (failure.status === 503 || failure.code === "TIMEOUT")
      ) {
        try {
          setSelected(await roleApi.event(token, selected.id));
          await loadOperations(selected.id);
        } catch {
          /* retain the original error */
        }
      }
    } finally {
      setBusy("");
    }
  }

  function showRecords() {
    setScreen("records");
    setOperationPage(1);
    setFilter("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function changeOperationPage(nextPage: number, type = filter) {
    setOperationPage(nextPage);
    if (selected) void loadOperations(selected.id, nextPage, type);
  }
  function changeFilter(type: string) {
    setFilter(type);
    changeOperationPage(1, type);
  }
  const canDraw =
    selected?.status === "OPEN" &&
    Date.now() >= new Date(selected.registrationDeadline).getTime() &&
    Date.now() < new Date(selected.startAt).getTime();

  return (
    <>
      <section className="editorial-stage">
        <div className="editorial-sheet role-sheet">
          {screen === "list" ? (
            <>
              <div className="role-intro">
                <RoleHeading
                  title="Your events"
                  accent="in motion."
                  description="从报名、抽签到验票，掌握每场活动的进展。"
                />
                <button
                  className="blue-action"
                  onClick={() => {
                    setError("");
                    setFormOpen(true);
                  }}
                >
                  创建活动 →
                </button>
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error}{" "}
                  <button onClick={() => void loadEvents()}>重试</button>
                </p>
              )}
              {busy === "load" ? (
                <p className="list-message">正在加载活动…</p>
              ) : events.length ? (
                <div className="role-event-list">
                  {events.map((event, index) => (
                    <button
                      className="role-event-row"
                      key={event.id}
                      onClick={() => void openEvent(event)}
                    >
                      <span className={`role-event-art role-art-${index % 4}`}>
                        {artwork(event)}
                      </span>
                      <span className="role-event-copy">
                        <small>
                          {dateLabel(event.startAt)} · {event.location}
                        </small>
                        <strong>{event.title}</strong>
                        <span>{event.description}</span>
                      </span>
                      <span className="role-event-status">
                        {formatStatus(event.status)}
                      </span>
                      <span className="role-event-manage">管理活动 ↗</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-message">
                  <h2>还没有创建活动</h2>
                  <p>创建活动后，就可以开放报名。</p>
                </div>
              )}
              {total > 20 && (
                <div className="list-pager">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    ← 上一页
                  </button>
                  <span>第 {page} 页</span>
                  <button
                    disabled={page * 20 >= total}
                    onClick={() => setPage(page + 1)}
                  >
                    下一页 →
                  </button>
                </div>
              )}
            </>
          ) : selected && screen === "detail" ? (
            <>
              <button className="text-back" onClick={() => setScreen("list")}>
                ← 返回活动
              </button>
              <div className="role-detail-head">
                <div>
                  <h1>{selected.title}</h1>
                  <p>{selected.description}</p>
                </div>
                <div className="role-detail-state">
                  <span>{formatStatus(selected.status)}</span>
                  <p>
                    {selected.status === "DRAWN"
                      ? "抽签已结束，中签学生可以领取门票。"
                      : selected.status === "DRAWING"
                        ? "正在发布抽签结果，相关操作暂不可用。"
                        : selected.status === "OPEN"
                          ? "报名开放至公布的截止时间。"
                          : "这场活动已经结束。"}
                  </p>
                </div>
              </div>
              <div className="role-detail-art">{artwork(selected)}</div>
              <div className="role-counts">
                <div>
                  <span>名额</span>
                  <strong>{selected.capacity}</strong>
                </div>
                <div>
                  <span>报名人数</span>
                  <strong>{selected.registrationCount}</strong>
                </div>
                <div>
                  <span>中签人数</span>
                  <strong>{selected.winnerCount}</strong>
                </div>
                <div>
                  <span>已领票</span>
                  <strong>{selected.issuedCount}</strong>
                </div>
                <div>
                  <span>已核销</span>
                  <strong>{selected.redeemedCount}</strong>
                </div>
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="role-notice" role="status">
                  {notice}
                </p>
              )}
              <div className="role-detail-columns">
                <section>
                  <h2>活动信息</h2>
                  <dl className="role-facts">
                    <div>
                      <dt>活动时间</dt>
                      <dd>
                        {dateLabel(selected.startAt)}
                        <br />
                        {timeLabel(selected.startAt)}–
                        {timeLabel(selected.endAt)} UTC
                      </dd>
                    </div>
                    <div>
                      <dt>地点</dt>
                      <dd>{selected.location}</dd>
                    </div>
                    <div>
                      <dt>报名截止</dt>
                      <dd>
                        {dateLabel(selected.registrationDeadline)} ·{" "}
                        {timeLabel(selected.registrationDeadline)} UTC
                      </dd>
                    </div>
                  </dl>
                </section>
                <section>
                  <h2>活动抽签</h2>
                  <p className="role-status-copy">
                    {formatStatus(selected.status)}
                  </p>
                  {drawInfo && (
                    <p className="role-draw-info">
                      已中签 {drawInfo.winnerCount} 人
                      {drawInfo.txId && (
                        <> · TX {drawInfo.txId.slice(0, 14)}…</>
                      )}
                    </p>
                  )}
                  {previewDrawCount !== null && (
                    <p className="role-draw-info" role="status">
                      本地预览：{selected.registrationCount} 人报名，最多可抽取{" "}
                      {previewDrawCount} 人；尚未选出中签者。
                    </p>
                  )}
                  {selected.status === "OPEN" && (
                    <button
                      className="blue-action"
                      disabled={busy === "draw" || (!preview && !canDraw)}
                      onClick={() => void draw()}
                    >
                      {busy === "draw"
                        ? "正在确认抽签…"
                        : preview
                          ? "预览抽签"
                          : "开始抽签"}
                    </button>
                  )}
                  {selected.status === "DRAWN" && (
                    <button className="blue-action" disabled>
                      抽签已完成
                    </button>
                  )}
                  {selected.status === "OPEN" && !preview && !canDraw && (
                    <p className="role-muted">
                      报名截止后、活动开始前，才能进行抽签。
                    </p>
                  )}
                  {selected.status === "OPEN" && preview && (
                    <p className="role-muted">
                      预览模式可提前体验抽签入口；正式抽签仍须等到报名截止。
                    </p>
                  )}
                  <div className="role-record-preview">
                    <div className="role-record-head">
                      <h2>链上记录</h2>
                      <button onClick={showRecords}>查看全部记录 →</button>
                    </div>
                    {operations.length ? (
                      operations.slice(0, 3).map((item) => (
                        <button
                          key={item.id}
                          className="role-operation-row"
                          onClick={() => setOperation(item)}
                        >
                          <strong>{operationLabel(item.type)}</strong>
                          <span>{dateLabel(item.occurredAt)}</span>
                          <span>{item.txId.slice(0, 12)}…</span>
                          <b>→</b>
                        </button>
                      ))
                    ) : (
                      <p className="role-muted">
                        {preview
                          ? "预览数据没有已确认的链上交易。"
                          : busy === "detail"
                            ? "正在加载记录…"
                            : "暂无已确认的链上交易。"}
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </>
          ) : selected ? (
            <>
              <button className="text-back" onClick={() => setScreen("detail")}>
                ← {selected.title}
              </button>
              <RoleHeading
                title="On-chain"
                accent="activity."
                description="按时间从近到远，查看这场活动已确认的交易。"
              />
              <div className="role-record-tools">
                <label htmlFor="operation-filter">记录类型</label>
                <select
                  id="operation-filter"
                  value={filter}
                  onChange={(event) => changeFilter(event.target.value)}
                >
                  <option value="">全部已确认记录</option>
                  {operationTypes.map((type) => (
                    <option key={type} value={type}>
                      {operationLabel(type)}
                    </option>
                  ))}
                </select>
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="role-record-list">
                {operations.filter(
                  (item) => !preview || !filter || item.type === filter,
                ).length ? (
                  operations.map((item) => (
                    <button
                      key={item.id}
                      className="role-operation-row"
                      onClick={() => setOperation(item)}
                    >
                      <strong>{operationLabel(item.type)}</strong>
                      <span>
                        {dateLabel(item.occurredAt)} ·{" "}
                        {timeLabel(item.occurredAt)} UTC
                      </span>
                      <span>{item.txId.slice(0, 18)}…</span>
                      <b>→</b>
                    </button>
                  ))
                ) : (
                  <p className="list-message">当前筛选下暂无已确认交易。</p>
                )}
              </div>
              {operationTotal > 20 && (
                <div className="list-pager">
                  <button
                    disabled={operationPage === 1}
                    onClick={() => changeOperationPage(operationPage - 1)}
                  >
                    ← 上一页
                  </button>
                  <span>第 {operationPage} 页</span>
                  <button
                    disabled={operationPage * 20 >= operationTotal}
                    onClick={() => changeOperationPage(operationPage + 1)}
                  >
                    下一页 →
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </section>
      {formOpen && (
        <EventForm
          values={values}
          busy={busy === "create"}
          error={error}
          onChange={changeForm}
          onSubmit={() => void create()}
          onClose={() => setFormOpen(false)}
        />
      )}
      {operation && (
        <OperationDrawer
          operation={operation}
          onClose={() => setOperation(null)}
        />
      )}
    </>
  );
}

type InspectorState = "scan" | "review" | "success" | "error";
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
};

export function InspectorWorkspace({
  preview,
  token,
  sampleEvent,
}: {
  preview: boolean;
  token?: string;
  sampleEvent: Event;
}) {
  const [state, setState] = useState<InspectorState>("scan");
  const [input, setInput] = useState("");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [transaction, setTransaction] = useState<Operation | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrame = useRef(0);
  const scanningRef = useRef(false);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [state]);

  function stopCamera() {
    scanningRef.current = false;
    cancelAnimationFrame(scanFrame.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  }
  useEffect(
    () => () => {
      scanningRef.current = false;
      cancelAnimationFrame(scanFrame.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  async function lookup(value = input) {
    const id = value.trim();
    if (!id || busy) return;
    stopCamera();
    setBusy(true);
    setMessage("");
    setTransaction(null);
    try {
      const record: Ticket = preview
        ? {
            id,
            eventId: sampleEvent.id,
            originalWinnerId: "00000000-0000-4000-8000-000000000001",
            ownerId: "00000000-0000-4000-8000-000000000001",
            status: "ACTIVE",
            transferCount: 0,
            claimedAt: "2026-09-20T08:00:00Z",
            redeemedAt: null,
            event: sampleEvent,
          }
        : await roleApi.ticket(token!, id);
      if (preview && id !== "demo-ticket-after-hours")
        throw new Error(
          "没有找到这张预览门票。请使用 demo-ticket-after-hours 体验验票流程。",
        );
      setTicket(record);
      setState("review");
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "未找到门票。");
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    if (cameraActive) {
      stopCamera();
      return;
    }
    const Detector = (
      window as Window & {
        BarcodeDetector?: new (options: {
          formats: string[];
        }) => BarcodeDetectorLike;
      }
    ).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setMessage("此浏览器暂不支持摄像头扫码，请在下方输入票号。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (!videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraActive(true);
      scanningRef.current = true;
      setMessage("");
      const detector = new Detector({ formats: ["qr_code"] });
      const scan = async () => {
        if (!scanningRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes[0]?.rawValue) {
            setInput(codes[0].rawValue);
            await lookup(codes[0].rawValue);
            return;
          }
        } catch {
          /* transient frame */
        }
        if (scanningRef.current)
          scanFrame.current = requestAnimationFrame(scan);
      };
      scanFrame.current = requestAnimationFrame(scan);
    } catch {
      setMessage("无法使用摄像头，请在下方输入票号。");
      stopCamera();
    }
  }

  async function redeem() {
    if (!ticket || busy || ticket.status !== "ACTIVE") return;
    setBusy(true);
    setMessage("");
    try {
      if (preview) {
        setTransaction(null);
        setState("success");
        setMessage("仅为预览结果；门票未实际核销，也不能凭此入场。");
      } else {
        const redeemed = await roleApi.redeem(token!, ticket.id);
        setTicket(redeemed.ticket);
        setTransaction(redeemed.operation);
        setState("success");
      }
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "核销失败。");
      setState("error");
      if (
        !preview &&
        failure instanceof ApiError &&
        (failure.status === 503 || failure.code === "TIMEOUT")
      ) {
        try {
          setTicket(await roleApi.ticket(token!, ticket.id));
          setMessage(
            "已重新查询门票状态。请核对后再决定是否重试；当前未确认入场。",
          );
        } catch {
          /* keep request error */
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    stopCamera();
    setState("scan");
    setTicket(null);
    setTransaction(null);
    setMessage("");
    setInput("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const event = ticket?.event;

  return (
    <section className="editorial-stage">
      <div
        className={`editorial-sheet role-sheet inspector-sheet inspector-${state}`}
      >
        {state === "scan" ? (
          <>
            <RoleHeading
              title="Scan a"
              accent="ticket."
              description="先查询门票，再核对活动、持有人与状态。"
            />
            <div className="scan-camera">
              <video ref={videoRef} muted playsInline aria-hidden="true" />
              <span className="scan-corners" aria-hidden="true" />
              <div className="scan-camera-copy">
                {cameraActive ? "请将二维码对准摄像头" : "扫描二维码"}
              </div>
              <button onClick={() => void startCamera()}>
                {cameraActive ? "停止扫码" : "开启摄像头扫码"}
              </button>
            </div>
            <div className="scan-divider">
              <span>或</span>
            </div>
            <h2>手动输入票号</h2>
            <p className="scan-description">完整票号位于学生门票二维码下方。</p>
            <form
              className="scan-form"
              onSubmit={(event) => {
                event.preventDefault();
                void lookup();
              }}
            >
              <label className="sr-only" htmlFor="scan-ticket-id">
                票号
              </label>
              <input
                id="scan-ticket-id"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  preview ? "demo-ticket-after-hours" : "输入完整票号"
                }
                autoComplete="off"
              />
              <button
                className="blue-action"
                disabled={!input.trim() || busy}
                type="submit"
              >
                {busy ? "正在查询…" : "查询门票"}
              </button>
            </form>
            {preview && (
              <p className="role-muted">
                预览示例：{" "}
                <button
                  className="inline-code-button"
                  onClick={() => setInput("demo-ticket-after-hours")}
                >
                  demo-ticket-after-hours
                </button>
                。此操作不会发送真实核销请求。
              </p>
            )}
            {message && (
              <p className="form-error" role="alert">
                {message}
              </p>
            )}
          </>
        ) : state === "review" && ticket ? (
          <>
            <RoleHeading
              title="Review the"
              accent="details."
              description="核对活动、持有人与门票状态后，再确认核销。"
            />
            <div className="inspection-ticket">
              <div className="inspection-ticket-art">
                <span>FAIRPASS</span>
                <strong>{event?.title || "暂无活动详情"}</strong>
                <small>ADMIT ONE</small>
              </div>
              <dl>
                <div>
                  <dt>活动</dt>
                  <dd>{event?.title || ticket.eventId}</dd>
                </div>
                <div>
                  <dt>活动时间</dt>
                  <dd>
                    {event
                      ? `${dateLabel(event.startAt)} · ${timeLabel(event.startAt)} UTC`
                      : "未提供"}
                  </dd>
                </div>
                <div>
                  <dt>当前持有人</dt>
                  <dd className="id-value">{ticket.ownerId}</dd>
                </div>
                <div>
                  <dt>票号</dt>
                  <dd className="id-value">{ticket.id}</dd>
                </div>
                <div>
                  <dt>状态</dt>
                  <dd>
                    {ticket.status === "ACTIVE" ? "有效，可核销" : "已核销"}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="inspection-actions">
              {ticket.status === "ACTIVE" ? (
                <button
                  className="blue-action"
                  disabled={busy}
                  onClick={() => void redeem()}
                >
                  {busy ? "正在确认…" : "确认核销"}
                </button>
              ) : (
                <p className="form-error">这张门票已经核销，不能再次入场。</p>
              )}
              <button className="quiet-action" onClick={reset}>
                重新扫描
              </button>
            </div>
          </>
        ) : state === "success" && ticket ? (
          <>
            <div className="admitted-mark" aria-hidden="true">
              <svg viewBox="0 0 110 110" fill="none">
                <circle
                  cx="55"
                  cy="55"
                  r="48"
                  stroke="currentColor"
                  strokeWidth="6"
                />
                <path
                  d="m29 55 17 17 35-38"
                  stroke="currentColor"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className="admitted-heading">
              {preview ? "Preview" : "Admitted"}{" "}
              <em>{preview ? "only." : "today."}</em>
            </h1>
            {message && (
              <p className="role-notice" role="status">
                {message}
              </p>
            )}
            <dl className="admitted-facts">
              <div>
                <dt>活动</dt>
                <dd>{event?.title || ticket.eventId}</dd>
              </div>
              <div>
                <dt>持票人</dt>
                <dd className="id-value">{ticket.ownerId}</dd>
              </div>
              <div>
                <dt>票号</dt>
                <dd className="id-value">{ticket.id}</dd>
              </div>
              <div>
                <dt>检票时间</dt>
                <dd>
                  {preview
                    ? "未实际核销"
                    : ticket.redeemedAt
                      ? `${dateLabel(ticket.redeemedAt)} · ${timeLabel(ticket.redeemedAt)} UTC`
                      : "服务端已确认"}
                </dd>
              </div>
              <div>
                <dt>链上记录</dt>
                <dd>
                  {transaction ? (
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(transaction.txId)
                      }
                      title="复制交易 ID"
                    >
                      {transaction.txId.slice(0, 18)}… · 复制 ↗
                    </button>
                  ) : preview ? (
                    "预览中没有链上交易"
                  ) : (
                    "未返回交易 ID"
                  )}
                </dd>
              </div>
            </dl>
            <button className="blue-action scan-next" onClick={reset}>
              扫描下一张 →
            </button>
          </>
        ) : (
          <>
            <RoleHeading
              title="Check-in"
              accent="stopped."
              description={
                message || "暂时无法核验这张门票。请先检查票据状态。"
              }
            />
            {ticket && (
              <p className="inspection-error-detail">
                票号 {ticket.id} ·{" "}
                {ticket.status === "ACTIVE" ? "有效" : "已核销"}
              </p>
            )}
            <button className="blue-action" onClick={reset}>
              重新查询 →
            </button>
          </>
        )}
      </div>
    </section>
  );
}
