# FairPass 共同契约（v1）

本文件约定三端共享的业务规则和数据边界；逐接口字段、错误码、示例与超时语义见 [API v1 详细规范](API_V1.md)。课程演示范围：创建活动、报名、抽签、领票、转让、核销、查看操作记录。变更接口时须同步更新两份文档和前端 API client。

## 1. 技术与边界

- 前端：React + TypeScript，仅调用 `/api/v1`。
- 后端：Node.js + TypeScript + Express；SQLite 保存普通业务数据；Fabric Gateway 调用链码。选题文件允许 PostgreSQL/MySQL，当前仓库 README 选择 SQLite，v1 以 SQLite 为准。
- Fabric：官方 test-network、TypeScript 链码；链上保存活动票数、中签资格、票权、转让和核销状态及操作记录。报名个人信息不上链。
- 用户、活动和报名 ID 是 UUID 字符串；票 ID 是按第 3 节生成的 SHA-256 十六进制字符串；操作 ID 是 Fabric `txId`。时间是 UTC ISO 8601（如 `2026-10-01T10:00:00Z`）；人数和票数是非负整数。API JSON 使用 camelCase。
- 本地演示使用预置账号和 `Authorization: Bearer <demo-token>`。前端不得通过传 `userId` 或 `role` 选择身份；后端从 token 解析。生产身份认证不在课程范围内。
- Fabric Gateway 使用平台服务身份提交交易。后端必须验证角色和操作人；链码验证票务规则。此信任边界应在答辩中说明。

## 2. 角色与业务规则

角色：`STUDENT`、`ORGANIZER`、`INSPECTOR`。一个演示账号只有一个角色。主办方只管理自己创建的活动；检票员可核销全部活动的票。

活动状态：`OPEN` → `DRAWING` → `DRAWN` → `FINISHED`。`OPEN` 允许报名；达到 `registrationDeadline` 后才能抽签；`DRAWING` 表示抽签发布链上过程中，前端只读；`DRAWN` 允许中签者领票；活动结束时间后为 `FINISHED`。后端存储状态并在读取时按时间阻止过期操作，不依赖定时任务即时改状态。活动不能修改票数和时间；若必须重建，创建新活动。

- 活动要求 `0 < capacity`，`registrationDeadline < startAt < endAt`。报名截止时刻起不再接受报名。
- 每人每活动最多报名一次；只有报名者参加抽签。
- 抽签只执行一次。后端使用加密安全随机数打乱报名用户 ID，再取 `min(capacity, 报名人数)` 名。中奖名单按 userId 排序后计算 SHA-256 哈希，用于记录和核对；不要把随机 seed 或名单中的个人信息写进公开页面。
- 中签不等于持票。中签者在 `startAt` 之前领取；每人每活动最多领取一张。链码须同时检查资格、重复领取及发行总量。
- 票一旦转让，原持有人失去使用权；接收人必须是已存在的学生账号，不要求曾报名或中签。每张票最多转让一次，只能在 `startAt` 之前转让，已核销票不能转让。转让后 `originalWinnerId` 不变，`ownerId` 改变。
- 检票仅在 `startAt <= 当前时间 < endAt` 执行；每张票只可核销一次。后端判定时间和检票员权限，链码再次拒绝重复核销。
- v1 票码内容为 `ticketId`，用于现场测试扫码或手动输入；它不是生产级防盗票凭证。页面显示票当前持有人和状态，检票员由后端检查权限。

## 3. 共享数据模型

```ts
type Role = 'STUDENT' | 'ORGANIZER' | 'INSPECTOR';
type EventStatus = 'OPEN' | 'DRAWING' | 'DRAWN' | 'FINISHED';
type RegistrationStatus = 'REGISTERED' | 'WON' | 'LOST';
type TicketStatus = 'ACTIVE' | 'REDEEMED';
type OperationType = 'EVENT_CREATED' | 'DRAW_PUBLISHED' | 'TICKET_CLAIMED' | 'TICKET_TRANSFERRED' | 'TICKET_REDEEMED';

interface User { id: string; displayName: string; role: Role }
interface Event {
  id: string; organizerId: string; title: string; description: string;
  location: string; capacity: number; registrationDeadline: string;
  startAt: string; endAt: string; status: EventStatus;
  registrationCount: number; winnerCount: number; issuedCount: number;
  redeemedCount: number; createdAt: string;
}
interface Registration {
  id: string; eventId: string; userId: string;
  status: RegistrationStatus; createdAt: string;
}
interface Ticket {
  id: string; eventId: string; originalWinnerId: string;
  ownerId: string; status: TicketStatus; transferCount: number;
  claimedAt: string; redeemedAt: string | null;
}
interface Operation {
  id: string; eventId: string; ticketId: string | null;
  type: OperationType; actorId: string; fromUserId: string | null;
  toUserId: string | null; occurredAt: string; txId: string;
  channelName: string; chaincodeName: string;
  blockNumber: number | null;
}
```

`Event` 的计数字段由后端汇总：报名数来自 SQLite；中签数来自已确认抽签名单；发行、核销数来自链上查询或经链上确认后的本地投影。不得以未经确认的本地写入增加链上计数。`Ticket.id` 在链码领取时确定为 `SHA256("ticket:" + eventId + ":" + originalWinnerId)` 的 64 位小写十六进制字符串，确保重试得到同一 ID。`Operation.id` 使用 Fabric `txId`；`EVENT_CREATED` 等记录可在后端查询时融合展示，且须标记链上交易 ID。

**链上展示边界**：`Operation` 列表只显示已确认的 Fabric 交易（建活动、发布抽签、领票、转让、核销）。报名保存在 SQLite，页面标为“平台记录”，不能标为“上链”。`channelName` 和 `chaincodeName` 从 Gateway 配置补充；`blockNumber` 只有在后端确实查询到区块号时填值，否则为 `null`，前端显示“未提供”，不得编造。交易成功意味着 Fabric 提交确认，不能仅以提交请求已发出作为“上链成功”。

## 4. HTTP 约定

前缀 `/api/v1`；请求与响应均为 JSON。成功结构为 `{ "data": ... }`。列表为 `{ "data": [...], "page": 1, "pageSize": 20, "total": 25 }`，默认 `page=1&pageSize=20`，最大 100。失败结构为 `{ "error": { "code": "ALREADY_REGISTERED", "message": "已报名", "requestId": "..." } }`。错误码是稳定的，中文 message 可用于页面提示。

HTTP 状态：400 参数错误；401 未登录；403 角色或资源权限不足；404 不存在；409 业务冲突；422 时间或状态不允许；503 Fabric 暂不可用。客户端超时后应重新查询状态，不能直接认定交易失败。

| 方法与路径 | 角色 | 请求 | `data` / 说明 |
|---|---|---|---|
| `POST /auth/demo-login` | 公开 | `{ "account": "student1" }` | `{ token, user }`；仅允许预置账号 |
| `GET /auth/me` | 登录 | 无 | `User` |
| `GET /events` | 登录 | 查询 `page,pageSize,status` | `Event[]`；学生可见全部活动 |
| `GET /me/events` | 主办方 | 查询 `page,pageSize,status` | 本人创建的 `Event[]`；`total` 只统计本人活动 |
| `GET /events/:eventId` | 登录 | 无 | `Event`，附加 `myRegistration: Registration|null`、`myTicket: Ticket|null`；非学生均为 null |
| `POST /events` | 主办方 | `CreateEventInput`；请求头 `Idempotency-Key: <uuid>` | `Event`；201，创建 SQLite 记录及链上活动；重复提交同一 key 返回同一活动 |
| `POST /events/:eventId/registrations` | 学生 | `{}` | `Registration`；201 |
| `GET /me/registrations` | 学生 | 分页参数 | `Registration[]`，每项附 `event: Event` |
| `POST /events/:eventId/draw` | 该活动主办方 | `{}` | `{ eventId, winnerCount, winnersHash, txId }`；只执行一次 |
| `GET /events/:eventId/draw` | 该活动主办方 | 无 | `{ status, registrationCount, winnerCount, winnersHash, winners: User[] }`；仅发布成功后返回名单 |
| `POST /events/:eventId/tickets/claim` | 中签学生 | `{}` | `Ticket`；201 |
| `GET /me/tickets` | 学生 | 分页参数 | `Ticket[]`，每项附 `event: Event`；包含当前持有的转入票 |
| `GET /tickets/:ticketId` | 持有人、该活动主办方、检票员 | 无 | `Ticket`，附 `event: Event` |
| `POST /tickets/:ticketId/transfer` | 当前持有人 | `{ "toUserId": "uuid" }` | 更新后的 `Ticket` |
| `POST /tickets/:ticketId/redeem` | 检票员 | `{}` | `{ ticket: Ticket, operation: Operation }`；只在交易确认后返回，`operation.txId` 必有值 |
| `GET /events/:eventId/operations` | 该活动主办方 | 分页参数；可选 `type` | 已确认的链上 `Operation[]`，按时间倒序；用于活动“链上记录”页 |
| `GET /tickets/:ticketId/operations` | 当前持有人、该活动主办方、检票员 | 分页参数 | 已确认的链上 `Operation[]`，按时间倒序；用于电子票时间线 |

`CreateEventInput`：`{ title, description, location, capacity, registrationDeadline, startAt, endAt }`。`title` 1–100 字符，`description` 最多 2000 字符，`location` 1–200 字符。创建操作仅在链上交易确认后返回成功。`Event.id` 由后端生成，`organizerId` 从 token 获取。前端为一次创建意图生成并保存 UUID 作为 `Idempotency-Key`，网络超时重试使用同一个 key；更改表单后生成新 key。后端存储 key、请求摘要与 eventId；同 key 不同请求返回 `409 IDEMPOTENCY_CONFLICT`。

### 示例：报名与领票

```http
POST /api/v1/events/8b03a0d0-702f-4823-a1e8-73fa7941d435/registrations
Authorization: Bearer <demo-token>
Content-Type: application/json

{}
```

```json
{"data":{"id":"9aeb506d-846c-4f62-b11d-11cdd934236e","eventId":"8b03a0d0-702f-4823-a1e8-73fa7941d435","userId":"5bbff9db-5823-45c9-a2cc-f55a8a79db45","status":"REGISTERED","createdAt":"2026-10-01T09:00:00Z"}}
```

领票成功返回上述 `Ticket` 完整结构。若未中签返回 `409 NOT_WINNER`；重复领票返回 `409 ALREADY_CLAIMED`。前端收到 503 或网络超时后调用 `GET /me/tickets` 核对。

### 稳定错误码

`VALIDATION_ERROR`、`UNAUTHENTICATED`、`FORBIDDEN`、`NOT_FOUND`、`IDEMPOTENCY_CONFLICT`、`REGISTRATION_CLOSED`、`ALREADY_REGISTERED`、`DRAW_NOT_READY`、`DRAW_IN_PROGRESS`、`ALREADY_DRAWN`、`NOT_WINNER`、`ALREADY_CLAIMED`、`SOLD_OUT`、`CLAIM_CLOSED`、`NOT_TICKET_OWNER`、`TRANSFER_CLOSED`、`TRANSFER_LIMIT_REACHED`、`INVALID_RECIPIENT`、`ALREADY_REDEEMED`、`CHECKIN_CLOSED`、`FABRIC_UNAVAILABLE`。

## 5. Fabric 链码契约

链码名称 `fairpass`；所有参数为字符串，复杂数组传 JSON 字符串；返回 JSON 字符串。链码内使用 Fabric transaction timestamp，不用本机时钟；只读方法不改变状态。后端把链码错误映射成上面的稳定 API 错误码。

| 方法 | 参数 | 返回 | 必须检查 |
|---|---|---|---|
| `CreateEvent` | `eventId, organizerId, capacity, startAt, endAt` | `ChainEvent` | 活动不存在、容量合法 |
| `PublishDraw` | `eventId, winnerIdsJson, winnersHash` | `ChainEvent` | 仅一次、去重、中奖人数不超过容量；原子写入资格 |
| `ClaimTicket` | `eventId, winnerId` | `Ticket` | 资格存在、未领过、未超发、活动未开始 |
| `TransferTicket` | `ticketId, fromUserId, toUserId` | `Ticket` | 当前持有人、未核销、未开始、最多一次、不能转给自己；接收人存在由后端检查 |
| `RedeemTicket` | `ticketId, inspectorId` | `Ticket` | 未核销、活动正在进行；检票员角色由后端检查 |
| `GetEvent` | `eventId` | `ChainEvent` | 存在 |
| `GetTicket` | `ticketId` | `Ticket` | 存在 |
| `GetTicketsByOwner` | `ownerId` | `Ticket[]` | 用 owner 索引查询，转让时更新索引 |
| `GetOperationsByEvent` | `eventId` | `Operation[]` | 返回链上已确认记录，可由后端分页 |
| `GetOperationsByTicket` | `ticketId` | `Operation[]` | 返回链上已确认记录 |

`ChainEvent = { eventId, organizerId, capacity, startAt, endAt, drawPublished, winnersHash, winnerCount, issuedCount, redeemedCount }`。中签资格可用 `eligibility:{eventId}:{userId}` 键；票用 `ticket:{ticketId}`；事件及票的操作记录使用复合键，按 txId 去重。状态和索引在同一 Fabric 交易中更新。链码业务错误使用 `CODE:message` 格式，便于后端映射。`PublishDraw` 的 `winnerIdsJson` 是排序、去重后的 UUID 数组；若人数过大超出 Fabric 交易大小，v1 演示限制单活动报名 ≤ 1000 人。

## 6. SQLite 最小表与约束

```text
users(id PK, account UNIQUE, display_name, role)
events(id PK, organizer_id FK, title, description, location, capacity,
       registration_deadline, start_at, end_at, status, created_at,
       draw_winners_hash NULL, draw_tx_id NULL)
registrations(id PK, event_id FK, user_id FK, status, created_at,
              UNIQUE(event_id,user_id))
draw_winners(event_id FK, user_id FK, PRIMARY KEY(event_id,user_id))
draw_attempts(event_id PK, winner_ids_json, winners_hash, state, created_at)
idempotency_keys(key PK, actor_id, request_hash, event_id, state, created_at)
```

票和票务操作以 Fabric 为准；可做后端缓存，但不能把缓存当成票权事实。抽签时先在 SQLite 事务中把活动置 `DRAWING` 并保存候选名单与哈希，然后提交一次 `PublishDraw`，确认后在 SQLite 事务中写入 `draw_tx_id`、中奖名单与 `DRAWN`。若 Gateway 超时或后端重启，先查询链上 `GetEvent`：已发布且哈希相同则完成本地收尾；未发布则重试同一候选名单；哈希不一致则停止并报错，不重新抽签。创建活动时先记录 idempotency key 与 eventId，再提交链上交易；同 key 重试先按同一 eventId 查询链上状态，避免创建两次。报名使用数据库唯一约束防重。

## 7. 三层联调验收

1. 主办方创建容量 2 的活动；3 名学生报名；截止后抽签，恰好 2 人中签。
2. 未中签者领票被拒；中签者成功领票；再次领同一张票被拒；链上发行数不超过 2。
3. 持票者转让给另一学生；原持有人不再出现在 `GET /me/tickets`；再次转让被拒。
4. 检票员核销转入票；再次核销被拒；操作记录能看到领票、转让、核销及 txId。
5. 非主办方不能抽签；学生不能核销；非持有人不能转让；过期报名、领票和转让均被拒。

现场演示准备两个活动：一个尚未开始，用于报名、抽签、领票、转让；另一个正在进行且已提前领票，用于检票。Fabric 使用交易时间，因此不能靠修改后端时钟绕过链码时间检查。
