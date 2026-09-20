import { useEffect, useState } from "react";
import { TicketStage } from "./components/TicketStage";
import { InspectorWorkspace, OrganizerWorkspace } from "./pages/RolePages";
import { QRCodeSVG } from "qrcode.react";
import {
  ApplicationsPage,
  EventDetailPage,
  EventsPage,
  IncomingTransfersPage,
  OperationTimeline,
  TransferPanel,
} from "./pages/StudentPages";
import {
  ApiError,
  clearToken,
  liveApiConfigured,
  savedToken,
  saveToken,
  studentApi,
} from "./api/client";
import type {
  Event as ApiEvent,
  EventDetail,
  Operation,
  Registration,
  Ticket as ApiTicket,
  User,
  Role,
} from "./api/client";

type Page = "events" | "event-detail" | "applications" | "tickets" | "incoming";
const roleName = (role: Role) =>
  ({ STUDENT: "学生", ORGANIZER: "主办方", INSPECTOR: "验票员" })[role];
type Ticket = {
  id: string;
  category: string;
  title: string;
  titleLines: string[];
  date: string;
  time: string;
  place: string;
  note: string;
  art: "music" | "film" | "type" | "garden";
  tint: string;
  tx: string;
  eventId?: string;
  status?: "ACTIVE" | "REDEEMED";
  transferCount?: number;
  ownerId?: string;
  startAt?: string;
};

// Deliberately local demo data. Replace with GET /api/v1/me/tickets and event data.
const tickets: Ticket[] = [
  {
    id: "demo-ticket-after-hours",
    category: "CAMPUS LIVE",
    title: "After hours. Live on campus.",
    titleLines: ["After hours.", "Live on campus."],
    date: "26 OCT",
    time: "19:30—21:30",
    place: "校园大礼堂",
    note: "在熟悉的校园里，听一场久违的现场演出。",
    art: "music",
    tint: "#0b6af1",
    tx: "6caa9e73974d08a8b4a1a5711975f592e2c6f21ca311de74aa605234b6910123",
  },
  {
    id: "demo-ticket-form-matters",
    category: "DESIGN WEEK",
    title: "Form matters.",
    titleLines: ["Form", "matters."],
    date: "09 NOV",
    time: "14:00—17:00",
    place: "艺术楼 · 2 号工作室",
    note: "让想法在动手创作中慢慢成形。",
    art: "type",
    tint: "#e99345",
    tx: "9d15d84ac3fc102efaa4ad40909358192474b47cf11a75a4b9e0c94a3cc19228",
  },
  {
    id: "demo-ticket-film-night",
    category: "OPEN SCREEN",
    title: "Frames after dark.",
    titleLines: ["Frames", "after dark."],
    date: "18 NOV",
    time: "20:00—22:00",
    place: "北草坪",
    note: "在星空下，一起看一场露天电影。",
    art: "film",
    tint: "#9077ce",
    tx: "8ac0be912745bb89990cc1ee76e67450f16721837996c29e046d06821baa3b44",
  },
  {
    id: "demo-ticket-garden",
    category: "SUNDAY CLUB",
    title: "A slower Sunday.",
    titleLines: ["A slower", "Sunday."],
    date: "01 DEC",
    time: "10:00—12:00",
    place: "植物园",
    note: "留一点时间，慢下来，呼吸与生长。",
    art: "garden",
    tint: "#6a9e7e",
    tx: "b2e6c73941e22c6b48292188f0238df0a7e405a02fc9f0ab812ad7628975314c",
  },
];

function TicketArt({ kind }: { kind: Ticket["art"] }) {
  if (kind === "music")
    return (
      <svg viewBox="0 0 440 284" aria-hidden="true" className="ticket-art-svg">
        <rect x="23" y="89" width="394" height="174" fill="#b9d5f9" />
        <circle
          cx="356"
          cy="63"
          r="60"
          fill="#efba5d"
          stroke="#182641"
          strokeWidth="2"
        />
        <rect
          x="70"
          y="42"
          width="305"
          height="218"
          fill="#1970ec"
          stroke="#182641"
          strokeWidth="2"
        />
        <path
          d="M70 200 133 77l51 126 58-125 59 125 42-126 32 122v61H70Z"
          fill="#d9e9fc"
        />
        <path
          d="M70 226c35-28 63-28 99 0 37-29 64-26 96 0 37-33 75-29 110 1v33H70Z"
          fill="#0c347b"
        />
        <path
          d="M87 253c-9-23-8-38 2-41 9-3 14 13 16 25 2-25 13-31 20-23 5 7 1 23-1 32 10-23 19-25 25-19 8 9-7 28-7 28Zm115 0c-5-22-1-41 9-44 11-3 12 13 14 27 6-18 15-20 21-14 6 7 2 21-2 31Zm101 0c-7-24-2-41 8-43 10-3 11 16 13 28 6-18 13-22 21-17 8 5 3 23-1 32Z"
          fill="#0a1c3b"
        />
        <path
          d="M117 40v54m119-54v54m113-54v54"
          stroke="#15223e"
          strokeWidth="3"
        />
        <path
          d="M102 74h30l-9 19h-13Zm119 0h30l-9 19h-13Zm113 0h30l-9 19h-13Z"
          fill="#17243c"
        />
        <circle cx="117" cy="94" r="9" fill="#f4ca65" />
        <circle cx="236" cy="94" r="9" fill="#f4ca65" />
        <circle cx="349" cy="94" r="9" fill="#f4ca65" />
        <path d="M53 263h339" stroke="#111f3c" strokeWidth="2" />
      </svg>
    );
  if (kind === "type")
    return (
      <svg viewBox="0 0 440 284" aria-hidden="true" className="ticket-art-svg">
        <rect x="33" y="54" width="374" height="205" rx="8" fill="#f6e9db" />
        <circle cx="99" cy="113" r="61" fill="#db9a62" />
        <path d="M290 45 391 124 297 237 199 158Z" fill="#d8c9ec" />
        <rect
          x="90"
          y="85"
          width="236"
          height="174"
          rx="9"
          fill="#fffdf8"
          stroke="#24242d"
          strokeWidth="2"
        />
        <path d="M90 120h236" stroke="#24242d" strokeWidth="2" />
        <circle cx="111" cy="103" r="5" fill="#e49245" />
        <circle cx="129" cy="103" r="5" fill="#eccd78" />
        <circle cx="147" cy="103" r="5" fill="#a4b9a7" />
        <text
          x="155"
          y="220"
          fontFamily="Georgia,serif"
          fontSize="118"
          fill="#1b2431"
        >
          F
        </text>
        <path
          d="M262 164v57m-18-57h36m-36 57h36"
          stroke="#1b2431"
          strokeWidth="2"
        />
        <circle cx="389" cy="217" r="22" fill="#e5aa74" />
      </svg>
    );
  if (kind === "film")
    return (
      <svg viewBox="0 0 440 284" aria-hidden="true" className="ticket-art-svg">
        <rect x="23" y="59" width="394" height="199" rx="7" fill="#e9def6" />
        <circle cx="111" cy="109" r="61" fill="#b69bdc" />
        <circle cx="330" cy="87" r="30" fill="#f1c56e" />
        <rect
          x="83"
          y="92"
          width="277"
          height="151"
          rx="8"
          fill="#252b55"
          stroke="#2d254b"
          strokeWidth="2"
        />
        <rect x="105" y="111" width="233" height="112" fill="#c0b3e8" />
        <path d="M105 204 161 150l53 51 40-34 84 48v8H105Z" fill="#6d62a9" />
        <circle cx="279" cy="144" r="17" fill="#f4dfad" />
        <path
          d="M70 65h300M70 261h300"
          stroke="#2d254b"
          strokeWidth="7"
          strokeDasharray="14 10"
        />
        <path
          d="M52 244 100 276m288-32-48 32"
          stroke="#534477"
          strokeWidth="3"
        />
      </svg>
    );
  return (
    <svg viewBox="0 0 440 284" aria-hidden="true" className="ticket-art-svg">
      <rect x="31" y="54" width="376" height="207" rx="11" fill="#e6eee2" />
      <circle cx="330" cy="103" r="53" fill="#e9bc70" />
      <path d="M20 262h400" stroke="#415d4b" strokeWidth="2" />
      <path
        d="M106 261V113m0 81c-43-8-62-34-57-71 42 0 63 21 57 71Zm0-28c0-54 24-85 66-92 7 51-14 83-66 92Zm120 95V105m0 84c-42-12-60-38-55-69 39 1 58 25 55 69Zm0-35c2-51 25-75 68-78 1 45-25 72-68 78Zm91 107V155m0 52c-35-6-50-26-48-53 31 1 47 18 48 53Zm0-22c1-37 20-59 53-64 3 37-14 58-53 64Z"
        fill="#8fb49b"
        stroke="#415d4b"
        strokeWidth="2"
      />
      <path
        d="M82 262h70m40 0h68m28 0h57"
        stroke="#2a5942"
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TicketFront({ ticket }: { ticket: Ticket }) {
  return (
    <div className="ticket-front-content">
      <span className="ticket-label" style={{ background: ticket.tint }}>
        {ticket.category}
      </span>
      <h2>
        {ticket.titleLines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </h2>
      <div className="art-container">
        <TicketArt kind={ticket.art} />
      </div>
      <span className="ticket-front-date">
        {ticket.date} <span>·</span> FAIRPASS
      </span>
    </div>
  );
}

function TicketBack({
  ticket,
  onClose,
  onTransfer,
  operations = [],
  preview = true,
}: {
  ticket: Ticket;
  onClose: () => void;
  onTransfer?: (ticket: Ticket) => void;
  operations?: Operation[];
  preview?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copyHash() {
    try {
      await navigator.clipboard.writeText(operations[0]?.txId || "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="ticket-back-content">
      <div className="back-top">
        <span className="ticket-label" style={{ background: ticket.tint }}>
          {ticket.category}
        </span>
        <button
          className="close-ticket"
          onClick={onClose}
          aria-label="关闭门票详情"
        >
          <CloseIcon />
        </button>
      </div>
      <h2>{ticket.title}</h2>
      <p className="back-description">{ticket.note}</p>
      <div className="ticket-facts">
        <div>
          <span>日期</span>
          <strong>{ticket.date}</strong>
        </div>
        <div>
          <span>时间</span>
          <strong>{ticket.time}</strong>
        </div>
        <div className="fact-wide">
          <span>地点</span>
          <strong>{ticket.place}</strong>
        </div>
      </div>
      <div className="ticket-code">
        <div className="qr-frame">
          <QRCodeSVG
            value={ticket.id}
            size={154}
            bgColor="#fffdf7"
            fgColor="#181d27"
            marginSize={1}
          />
        </div>
        <span>
          {preview
            ? "预览门票 · 不可用于入场"
            : ticket.status === "REDEEMED"
              ? "已核销 · 不可再次入场"
              : "入场时请出示此票号"}
        </span>
        <code>{ticket.id}</code>
        {!preview && ticket.ownerId && (
          <span className="ticket-holder">当前持有人 · {ticket.ownerId}</span>
        )}
      </div>
      {(preview || ticket.status === "ACTIVE") &&
        (ticket.transferCount ?? 0) === 0 &&
        (!ticket.startAt || Date.now() < new Date(ticket.startAt).getTime()) &&
        onTransfer && (
          <button
            className="ticket-transfer-link"
            onClick={() => onTransfer(ticket)}
          >
            <strong>转让门票</strong>
            <span>活动开始前可转让一次 →</span>
          </button>
        )}
      <div className="chain-space" aria-hidden="true">
        <span className="chain-space-dot" />
        <span>门票记录</span>
        <span className="chain-space-line" />
        <span className="chain-space-arrow">↓</span>
      </div>
      <section className="chain-record" aria-label="链上记录">
        <p className="section-marker">链上记录</p>
        <h3>Made to be yours.</h3>
        <OperationTimeline operations={operations} preview={preview} />
        <dl>
          <div>
            <dt>状态</dt>
            <dd>
              {preview
                ? "预览数据"
                : ticket.status === "REDEEMED"
                  ? "已核销"
                  : "有效"}
            </dd>
          </div>
          <div>
            <dt>网络</dt>
            <dd>
              {operations[0]?.channelName || (preview ? "未连接" : "未提供")}
            </dd>
          </div>
          <div>
            <dt>交易哈希</dt>
            <dd className="hash-value">
              {operations[0]?.txId || (preview ? "未连接" : "暂无已确认交易")}
            </dd>
          </div>
        </dl>
        <button
          className="copy-link"
          onClick={copyHash}
          disabled={!operations.length}
        >
          {copied ? "已复制 ✓" : "复制哈希 ↗"}
        </button>
      </section>
      <div className="back-end">
        FAIRPASS <span>KEEP THIS ONE CLOSE.</span>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m3 3 12 12M15 3 3 15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
const previewDates = ["2026-10-26", "2026-11-09", "2026-11-18", "2026-12-01"];
const previewDeadline = (date: string) => {
  const deadline = new Date(`${date}T18:00:00Z`);
  deadline.setUTCDate(deadline.getUTCDate() - 2);
  return deadline.toISOString();
};
const previewEvents: ApiEvent[] = tickets.map((ticket, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  organizerId: "00000000-0000-4000-8000-000000000010",
  title: ticket.title,
  description: ticket.note,
  location: ticket.place,
  capacity: 120 + index * 30,
  registrationDeadline: previewDeadline(previewDates[index]),
  startAt: `${previewDates[index]}T${["19:30", "14:00", "20:00", "10:00"][index]}:00Z`,
  endAt: `${previewDates[index]}T${["21:30", "17:00", "22:00", "12:00"][index]}:00Z`,
  status: index === 1 || index === 2 ? "DRAWN" : "OPEN",
  registrationCount: [89, 167, 142, 53][index],
  winnerCount: index === 1 || index === 2 ? 120 : 0,
  issuedCount: index === 1 || index === 2 ? 84 : 0,
  redeemedCount: 0,
  createdAt: "2026-09-10T10:00:00Z",
}));
const previewUser: User = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "学生预览",
  role: "STUDENT",
};
const organizerPreviewUser: User = {
  id: "00000000-0000-4000-8000-000000000010",
  displayName: "主办方预览",
  role: "ORGANIZER",
};
const inspectorPreviewUser: User = {
  id: "00000000-0000-4000-8000-000000000020",
  displayName: "验票员预览",
  role: "INSPECTOR",
};
const previewRegistrations: Registration[] = previewEvents
  .slice(0, 3)
  .map((event, index) => ({
    id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, "0")}`,
    eventId: event.id,
    userId: previewUser.id,
    status: ["REGISTERED", "WON", "LOST"][index] as Registration["status"],
    createdAt: "2026-09-18T10:00:00Z",
    event,
  }));

function displayTicket(record: ApiTicket, index: number): Ticket {
  const event = record.event;
  const base = tickets[index % tickets.length];
  const start = event?.startAt ? new Date(event.startAt) : new Date();
  return {
    ...base,
    id: record.id,
    eventId: record.eventId,
    ownerId: record.ownerId,
    startAt: event?.startAt,
    status: record.status,
    transferCount: record.transferCount,
    title: event?.title || "校园门票",
    titleLines: (event?.title || "校园门票")
      .split(" ")
      .reduce<string[]>((lines, word) => {
        const last = lines.length - 1;
        if (last < 0 || lines[last].length + word.length > 17) lines.push(word);
        else lines[last] += ` ${word}`;
        return lines;
      }, []),
    date: new Intl.DateTimeFormat("en", {
      month: "short",
      day: "2-digit",
      timeZone: "UTC",
    })
      .format(start)
      .toUpperCase(),
    time: event
      ? `${new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(start)} UTC`
      : "查看活动",
    place: event?.location || "查看活动详情",
    note: event?.description || "记住这段校园时光。",
    tx: "",
  };
}

function App() {
  const [page, setPage] = useState<Page>("events");
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewRole, setPreviewRole] = useState<Role>("STUDENT");
  const [roleHomeVersion, setRoleHomeVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState<{ token: string; user: User } | null>(
    null,
  );
  const [account, setAccount] = useState("student1");
  const [events, setEvents] = useState<ApiEvent[]>(
    liveApiConfigured ? [] : previewEvents,
  );
  const [registrations, setRegistrations] = useState<Registration[]>(
    liveApiConfigured ? [] : previewRegistrations,
  );
  const [ownedTickets, setOwnedTickets] = useState<ApiTicket[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventDetail | null>(null);
  const [operations, setOperations] = useState<Record<string, Operation[]>>({});
  const [eventsPage, setEventsPage] = useState(1);
  const [applicationsPage, setApplicationsPage] = useState(1);
  const [eventsTotal, setEventsTotal] = useState(
    liveApiConfigured ? 0 : previewEvents.length,
  );
  const [applicationsTotal, setApplicationsTotal] = useState(
    liveApiConfigured ? 0 : previewRegistrations.length,
  );
  const [loading, setLoading] = useState(liveApiConfigured);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<Ticket | null>(null);
  const [recipient, setRecipient] = useState("");
  const preview = !liveApiConfigured;
  const currentRole = session?.user.role || previewRole;
  const currentUser =
    session?.user ||
    (currentRole === "ORGANIZER"
      ? organizerPreviewUser
      : currentRole === "INSPECTOR"
        ? inspectorPreviewUser
        : previewUser);

  function switchPreviewRole(role: Role) {
    setPreviewRole(role);
    setPage("events");
    setMenuOpen(false);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function goHome() {
    setPage("events");
    setRoleHomeVersion((version) => version + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function refresh(
    token: string,
    eventPage = eventsPage,
    registrationPage = applicationsPage,
  ) {
    setLoading(true);
    setLoadError("");
    try {
      const [nextEvents, nextRegistrations, nextTickets] = await Promise.all([
        studentApi.events(token, eventPage),
        studentApi.registrations(token, registrationPage),
        studentApi.tickets(token),
      ]);
      setEvents(nextEvents.data);
      setEventsTotal(nextEvents.total);
      setRegistrations(nextRegistrations.data);
      setApplicationsTotal(nextRegistrations.total);
      setOwnedTickets(nextTickets.data);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "暂时无法加载最新信息。",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!liveApiConfigured) return;
    const token = savedToken();
    if (!token) {
      setLoading(false);
      return;
    }
    studentApi
      .me(token)
      .then((user) => setSession({ token, user }))
      .catch(() => {
        clearToken();
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (session?.user.role === "STUDENT") void refresh(session.token);
  }, [session, eventsPage, applicationsPage]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page]);

  async function login() {
    setBusy("login");
    setActionError("");
    try {
      const result = await studentApi.login(account.trim());
      saveToken(result.token);
      setSession(result);
      setPage("events");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "登录失败。");
    } finally {
      setBusy(null);
    }
  }

  const artwork = (event: ApiEvent) => {
    const position = events.findIndex((item) => item.id === event.id);
    return (
      <TicketArt
        kind={
          tickets[
            (position < 0 ? event.title.length : position) % tickets.length
          ].art
        }
      />
    );
  };

  async function openEvent(id: string) {
    if (!id) {
      setPage("events");
      return;
    }
    setActionError("");
    const local =
      events.find((item) => item.id === id) ||
      previewEvents.find((item) => item.id === id);
    if (preview && local) {
      setSelectedEvent({
        ...local,
        myRegistration:
          registrations.find((item) => item.eventId === id) || null,
        myTicket: null,
      });
      setPage("event-detail");
      window.scrollTo(0, 0);
      return;
    }
    if (!session) return;
    setBusy("event");
    try {
      setSelectedEvent(await studentApi.event(session.token, id));
      setPage("event-detail");
      window.scrollTo(0, 0);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法打开该活动。");
    } finally {
      setBusy(null);
    }
  }

  async function register() {
    if (!selectedEvent || busy) return;
    setBusy("register");
    setActionError("");
    try {
      if (preview) {
        const item: Registration = {
          id: crypto.randomUUID(),
          eventId: selectedEvent.id,
          userId: previewUser.id,
          status: "REGISTERED",
          createdAt: new Date().toISOString(),
          event: selectedEvent,
        };
        setRegistrations((items) => [item, ...items]);
        setApplicationsTotal((count) => count + 1);
        setSelectedEvent({ ...selectedEvent, myRegistration: item });
        setNotice("已在本地预览中添加报名，未向服务端发送请求。");
      } else if (session) {
        await studentApi.register(session.token, selectedEvent.id);
        setSelectedEvent(
          await studentApi.event(session.token, selectedEvent.id),
        );
        await refresh(session.token);
        setNotice("报名成功。");
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "报名失败。");
      if (
        session &&
        error instanceof ApiError &&
        (error.status === 503 || error.code === "TIMEOUT")
      )
        await refresh(session.token);
    } finally {
      setBusy(null);
    }
  }

  async function claim(id: string) {
    if (busy) return;
    if (preview) {
      setNotice("领票需要服务端确认；预览门票仅用于查看界面和动画。");
      return;
    }
    if (!session) return;
    setBusy(id);
    setActionError("");
    try {
      await studentApi.claim(session.token, id);
      await refresh(session.token);
      if (selectedEvent?.id === id)
        setSelectedEvent(await studentApi.event(session.token, id));
      setNotice("领票成功，门票已加入“我的门票”。");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "领票失败。");
      if (
        error instanceof ApiError &&
        (error.status === 503 || error.code === "TIMEOUT")
      )
        await refresh(session.token);
    } finally {
      setBusy(null);
    }
  }

  async function openTicketRecord(ticket: Ticket) {
    if (preview || !session) return;
    try {
      const result = await studentApi.operations(session.token, ticket.id);
      setOperations((current) => ({ ...current, [ticket.id]: result.data }));
    } catch {
      setOperations((current) => ({ ...current, [ticket.id]: [] }));
    }
  }

  async function submitTransfer() {
    if (!transfer || busy) return;
    if (preview) {
      setTransfer(null);
      setRecipient("");
      setNotice("转让预览已完成，门票归属没有改变。");
      return;
    }
    if (!session) return;
    setBusy("transfer");
    setActionError("");
    try {
      await studentApi.transfer(session.token, transfer.id, recipient.trim());
      setTransfer(null);
      setRecipient("");
      // Unmount the detailed card before its now-transferred record leaves the list.
      setPage("events");
      await refresh(session.token);
      setNotice("转让成功，这张票已从“我的门票”移除。");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "转让失败。");
      if (
        error instanceof ApiError &&
        (error.status === 503 || error.code === "TIMEOUT")
      ) {
        setTransfer(null);
        setPage("events");
        await refresh(session.token);
        setNotice("已刷新转让状态，请先查看“我的门票”，再决定是否重试。");
      }
    } finally {
      setBusy(null);
    }
  }

  const liveTickets = ownedTickets.map(displayTicket);
  const shownTickets = preview ? tickets : liveTickets;
  const showLogin = liveApiConfigured && !session;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={goHome}>
          FairPass
        </button>
        <nav aria-label="主导航">
          {currentRole === "STUDENT" ? (
            <>
              <button
                className={
                  page === "events" || page === "event-detail"
                    ? "nav-active"
                    : ""
                }
                onClick={() => setPage("events")}
              >
                活动
              </button>
              <button
                className={page === "applications" ? "nav-active" : ""}
                onClick={() => setPage("applications")}
              >
                我的报名
              </button>
              <button
                className={
                  page === "tickets" || page === "incoming" ? "nav-active" : ""
                }
                onClick={() => setPage("tickets")}
              >
                我的门票
              </button>
            </>
          ) : (
            <button className="nav-active" onClick={goHome}>
              {currentRole === "ORGANIZER" ? <>活动管理</> : <>活动验票</>}
            </button>
          )}
        </nav>
        <div className="account-wrap">
          <button
            className="account-button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
            aria-label="账户菜单"
          >
            账户{" "}
            <span className="account-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
                <circle
                  cx="12"
                  cy="9"
                  r="3"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
                <path
                  d="M5.5 19c1.3-3 3.5-4.4 6.5-4.4s5.2 1.4 6.5 4.4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
              </svg>
            </span>
          </button>
          {menuOpen && (
            <div className="account-menu">
              <strong>{currentUser.displayName}</strong>
              <small>
                {preview
                  ? "本地示例数据"
                  : session?.user.role
                    ? roleName(session.user.role)
                    : "请登录"}
              </small>
              {preview && (
                <div className="role-switch" aria-label="切换预览角色">
                  <span>切换预览角色</span>
                  {(["STUDENT", "ORGANIZER", "INSPECTOR"] as Role[]).map(
                    (role) => (
                      <button
                        key={role}
                        className={role === currentRole ? "selected" : ""}
                        onClick={() => switchPreviewRole(role)}
                      >
                        {roleName(role)}
                      </button>
                    ),
                  )}
                </div>
              )}
              {session && (
                <button
                  onClick={() => {
                    clearToken();
                    setSession(null);
                    setMenuOpen(false);
                    setPage("events");
                  }}
                >
                  退出登录
                </button>
              )}
            </div>
          )}
        </div>
      </header>
      <main>
        {preview && (
          <div className="preview-ribbon">
            界面预览 · 示例数据 · 门票不可用于入场
          </div>
        )}
        {showLogin ? (
          <section className="editorial-stage">
            <div className="editorial-sheet login-sheet">
              <h1>
                Make room for <em>your next event.</em>
              </h1>
              <p>输入后端提供的测试账号，进入相应角色的工作界面。</p>
              <label htmlFor="demo-account">测试账号</label>
              <input
                id="demo-account"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void login();
                }}
              />
              <button
                className="blue-action"
                disabled={busy === "login"}
                onClick={() => void login()}
              >
                {busy === "login" ? "正在登录…" : "继续 →"}
              </button>
              {actionError && (
                <p className="form-error" role="alert">
                  {actionError}
                </p>
              )}
            </div>
          </section>
        ) : currentRole === "ORGANIZER" ? (
          <OrganizerWorkspace
            key={`${currentUser.id}-${roleHomeVersion}`}
            preview={preview}
            token={session?.token}
            user={currentUser}
            samples={previewEvents}
            artwork={artwork}
          />
        ) : currentRole === "INSPECTOR" ? (
          <InspectorWorkspace
            key={`${currentUser.id}-${roleHomeVersion}`}
            preview={preview}
            token={session?.token}
            sampleEvent={previewEvents[0]}
          />
        ) : page === "events" ? (
          <EventsPage
            events={events}
            loading={loading}
            error={loadError}
            page={eventsPage}
            total={eventsTotal}
            onRetry={() => session && void refresh(session.token)}
            onPage={setEventsPage}
            onSelect={(id) => void openEvent(id)}
            artwork={artwork}
          />
        ) : page === "event-detail" && selectedEvent ? (
          <EventDetailPage
            event={selectedEvent}
            registration={
              registrations.find((item) => item.eventId === selectedEvent.id) ||
              null
            }
            ticket={
              ownedTickets.find((item) => item.eventId === selectedEvent.id) ||
              null
            }
            artwork={artwork(selectedEvent)}
            busy={Boolean(busy)}
            error={actionError}
            onBack={() => setPage("events")}
            onRegister={() => void register()}
            onClaim={() => void claim(selectedEvent.id)}
            onTickets={() => setPage("tickets")}
          />
        ) : page === "applications" ? (
          <ApplicationsPage
            registrations={registrations}
            ticketEventIds={ownedTickets.map((ticket) => ticket.eventId)}
            loading={loading}
            error={loadError || actionError}
            page={applicationsPage}
            total={applicationsTotal}
            onRetry={() => session && void refresh(session.token)}
            onPage={setApplicationsPage}
            onOpen={(id) => void openEvent(id)}
            onClaim={(id) => void claim(id)}
            claiming={busy}
            artwork={artwork}
          />
        ) : page === "incoming" ? (
          <IncomingTransfersPage onBack={() => setPage("tickets")} />
        ) : shownTickets.length ? (
          <>
            <TicketStage
              tickets={shownTickets}
              front={(ticket) => <TicketFront ticket={ticket} />}
              back={(ticket, onClose) => (
                <TicketBack
                  ticket={ticket}
                  onClose={onClose}
                  preview={preview}
                  operations={operations[ticket.id] || []}
                  onTransfer={(record) => {
                    setActionError("");
                    setTransfer(record);
                  }}
                />
              )}
              onOpen={(ticket) => void openTicketRecord(ticket)}
            />
            <button
              className="incoming-entry"
              onClick={() => setPage("incoming")}
            >
              待接收门票 ↗
            </button>
          </>
        ) : (
          <section className="ticket-empty">
            <h1>
              Your tickets will live <em>here.</em>
            </h1>
            <p>
              {loading
                ? "正在加载门票…"
                : "抽签中签后可以领取门票，也可以接收其他学生转来的门票。"}
            </p>
            <button onClick={() => setPage("events")}>浏览活动 →</button>
            <button onClick={() => setPage("incoming")}>待接收门票 →</button>
          </section>
        )}
      </main>
      {transfer && (
        <TransferPanel
          preview={preview}
          title={transfer.title}
          ticketId={transfer.id}
          busy={busy === "transfer"}
          error={actionError}
          recipient={recipient}
          onRecipient={setRecipient}
          onClose={() => setTransfer(null)}
          onSubmit={() => void submitTransfer()}
        />
      )}
      {notice && (
        <div className="demo-notice" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="关闭提示">
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
