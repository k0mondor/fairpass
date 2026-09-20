// All role pages speak only the v1 HTTP contract. Preview data stays in UI modules.
export type Role = "STUDENT" | "ORGANIZER" | "INSPECTOR";
export type EventStatus = "OPEN" | "DRAWING" | "DRAWN" | "FINISHED";
export type RegistrationStatus = "REGISTERED" | "WON" | "LOST";
export type TicketStatus = "ACTIVE" | "REDEEMED";
export type OperationType =
  | "EVENT_CREATED"
  | "DRAW_PUBLISHED"
  | "TICKET_CLAIMED"
  | "TICKET_TRANSFERRED"
  | "TICKET_REDEEMED";

export interface User {
  id: string;
  displayName: string;
  role: Role;
}
export interface Event {
  id: string;
  organizerId: string;
  title: string;
  description: string;
  location: string;
  capacity: number;
  registrationDeadline: string;
  startAt: string;
  endAt: string;
  status: EventStatus;
  registrationCount: number;
  winnerCount: number;
  issuedCount: number;
  redeemedCount: number;
  createdAt: string;
}
export interface Registration {
  id: string;
  eventId: string;
  userId: string;
  status: RegistrationStatus;
  createdAt: string;
  event?: Event;
}
export interface Ticket {
  id: string;
  eventId: string;
  originalWinnerId: string;
  ownerId: string;
  status: TicketStatus;
  transferCount: number;
  claimedAt: string;
  redeemedAt: string | null;
  event?: Event;
}
export interface Operation {
  id: string;
  eventId: string;
  ticketId: string | null;
  type: OperationType;
  actorId: string;
  fromUserId: string | null;
  toUserId: string | null;
  occurredAt: string;
  txId: string;
  channelName: string;
  chaincodeName: string;
  blockNumber: number | null;
}
export interface EventDetail extends Event {
  myRegistration: Registration | null;
  myTicket: Ticket | null;
}
export interface PageResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

const apiBase = import.meta.env.VITE_API_BASE_URL || "/api/v1";
export const liveApiConfigured = Boolean(import.meta.env.VITE_API_BASE_URL);
const tokenKey = "fairpass.demo.token";
export const savedToken = () => sessionStorage.getItem(tokenKey);
export const saveToken = (token: string) =>
  sessionStorage.setItem(tokenKey, token);
export const clearToken = () => sessionStorage.removeItem(tokenKey);

async function request<T>(
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(
        body?.error?.message || `请求失败（${response.status}）`,
        body?.error?.code || "REQUEST_FAILED",
        response.status,
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      controller.signal.aborted
        ? "请求超时，请先刷新当前状态，再决定是否重试。"
        : "暂时无法连接服务，请检查网络后重试。",
      controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR",
      0,
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

const one = <T>(path: string, token: string, options?: RequestInit) =>
  request<{ data: T }>(path, token, options).then((body) => body.data);
const list = <T>(path: string, token: string) =>
  request<PageResult<T>>(path, token);

export const studentApi = {
  login: (account: string) =>
    request<{ data: { token: string; user: User } }>(
      "/auth/demo-login",
      undefined,
      {
        method: "POST",
        body: JSON.stringify({ account }),
      },
    ).then((body) => body.data),
  me: (token: string) => one<User>("/auth/me", token),
  events: (token: string, page = 1) =>
    list<Event>(`/events?page=${page}&pageSize=20`, token),
  event: (token: string, id: string) =>
    one<EventDetail>(`/events/${encodeURIComponent(id)}`, token),
  registrations: (token: string, page = 1) =>
    list<Registration>(`/me/registrations?page=${page}&pageSize=20`, token),
  tickets: (token: string, page = 1) =>
    list<Ticket>(`/me/tickets?page=${page}&pageSize=20`, token),
  register: (token: string, id: string) =>
    one<Registration>(
      `/events/${encodeURIComponent(id)}/registrations`,
      token,
      {
        method: "POST",
        body: "{}",
      },
    ),
  claim: (token: string, id: string) =>
    one<Ticket>(`/events/${encodeURIComponent(id)}/tickets/claim`, token, {
      method: "POST",
      body: "{}",
    }),
  transfer: (token: string, id: string, toUserId: string) =>
    one<Ticket>(`/tickets/${encodeURIComponent(id)}/transfer`, token, {
      method: "POST",
      body: JSON.stringify({ toUserId }),
    }),
  operations: (token: string, id: string, page = 1) =>
    list<Operation>(
      `/tickets/${encodeURIComponent(id)}/operations?page=${page}&pageSize=20`,
      token,
    ),
};

export interface CreateEventInput {
  title: string;
  description: string;
  location: string;
  capacity: number;
  registrationDeadline: string;
  startAt: string;
  endAt: string;
}
export interface DrawResult {
  eventId: string;
  winnerCount: number;
  winnersHash: string;
  txId: string;
}
export interface DrawDetail {
  status: EventStatus;
  registrationCount: number;
  winnerCount: number;
  winnersHash: string | null;
  winners: User[];
}
export interface RedeemResult {
  ticket: Ticket;
  operation: Operation;
}

export const roleApi = {
  events: (token: string, page = 1) =>
    list<Event>(`/me/events?page=${page}&pageSize=20`, token),
  event: (token: string, id: string) => studentApi.event(token, id),
  createEvent: (
    token: string,
    input: CreateEventInput,
    idempotencyKey: string,
  ) =>
    one<Event>("/events", token, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    }),
  draw: (token: string, id: string) =>
    one<DrawResult>(`/events/${encodeURIComponent(id)}/draw`, token, {
      method: "POST",
      body: "{}",
    }),
  drawDetail: (token: string, id: string) =>
    one<DrawDetail>(`/events/${encodeURIComponent(id)}/draw`, token),
  eventOperations: (token: string, id: string, page = 1, type = "") =>
    list<Operation>(
      `/events/${encodeURIComponent(id)}/operations?page=${page}&pageSize=20${type ? `&type=${encodeURIComponent(type)}` : ""}`,
      token,
    ),
  ticket: (token: string, id: string) =>
    one<Ticket>(`/tickets/${encodeURIComponent(id)}`, token),
  redeem: (token: string, id: string) =>
    one<RedeemResult>(`/tickets/${encodeURIComponent(id)}/redeem`, token, {
      method: "POST",
      body: "{}",
    }),
};
