# FairPass HTTP API v1

本规范供前端、后端和 Fabric 联调。业务规则、共享类型和链码方法以 [共同契约](SHARED_CONTRACT.md) 为准；本文件明确 HTTP 入参、响应、权限与失败语义。当前 `backend/` 和 `blockchain/` 尚未实现，下面是**待实现的契约**，不是已上线接口。

## 1. 通用约定

- 基础路径：`/api/v1`。请求和响应为 UTF-8 JSON；无业务请求体的 POST 传 `{}`。除登录外，必须带 `Authorization: Bearer <demo-token>`，身份和角色只能由 token 决定。
- `User.id`、`Event.id`、`Registration.id` 和创建请求的 `Idempotency-Key` 为 UUID；`Ticket.id` 为 64 位小写 SHA-256 十六进制；`Operation.id` 与 `txId` 相同，来自 Fabric。所有时间用带时区的 UTC ISO 8601 字符串，服务端比较真实时间，响应统一输出 `Z`。
- 单体成功响应 `{ "data": T }`，列表响应 `{ "data": T[], "page": 1, "pageSize": 20, "total": 42 }`。`page`、`pageSize` 为正整数，默认 1、20，`pageSize` 最大 100；越界页返回空数组及真实 `total`。分页在权限过滤之后计算，按 `createdAt DESC, id DESC` 稳定排序；操作记录按 `occurredAt DESC, txId DESC`。未知查询参数可忽略，非法已知参数返回 400。
- 错误响应 `{ "error": { "code": "ALREADY_REGISTERED", "message": "已报名", "requestId": "uuid" } }`。所有失败含 `requestId`，也在 `X-Request-Id` 响应头中返回；不暴露堆栈、私钥或链码内部错误。后端记录 requestId、路由、actorId、eventId/ticketId、txId 和耗时，不记录 token。
- 列表和详情只展示已确认状态。链上写交易必须等 Gateway 提交确认成功，才返回 2xx 和交易信息。客户端超时、后端超时及 Gateway 结果不明均不代表交易失败；后端先对账，仍不确定返回 503，客户端重新查询对应资源。禁止把未确认交易当作已成功操作展示。
- 浏览器跨域时后端只允许配置过的前端 origin、`Authorization`、`Content-Type`、`Idempotency-Key` 请求头和必要方法；预检请求不要求 token。

## 2. 共享响应模型

字段均为必填，除标记为 `null` 或说明为详情附加的字段。类型的完整定义见 [共同契约第 3 节](SHARED_CONTRACT.md#3-共享数据模型)。

| 对象 | 字段与含义 |
|---|---|
| `User` | `id, displayName, role`；`role` 为 `STUDENT / ORGANIZER / INSPECTOR` |
| `Event` | `id, organizerId, title, description, location, capacity, registrationDeadline, startAt, endAt, status, registrationCount, winnerCount, issuedCount, redeemedCount, createdAt` |
| `Registration` | `id, eventId, userId, status, createdAt`；`GET /me/registrations` 的每项增加 `event: Event` |
| `Ticket` | `id, eventId, originalWinnerId, ownerId, status, transferCount, claimedAt, redeemedAt`；票列表和票详情增加 `event: Event` |
| `Operation` | `id, eventId, ticketId, type, actorId, fromUserId, toUserId, occurredAt, txId, channelName, chaincodeName, blockNumber`；`ticketId/fromUserId/toUserId/blockNumber` 可为 `null`。`id === txId`；仅表示已确认交易 |

`Event.status` 为 `OPEN / DRAWING / DRAWN / FINISHED`。`FINISHED` 在 `endAt` 到达后读出时体现，即使数据库尚未由定时任务更新也必须阻止过期操作。`registrationCount` 来自 SQLite，`winnerCount` 来自已确认抽签；`issuedCount` 与 `redeemedCount` 来自链上或确认后的投影。`DRAWING` 时不可泄露暂存中签名单。

## 3. 身份与活动

| 方法与路径 | 权限 | 请求 | 成功状态与 `data` | 主要失败 |
|---|---|---|---|---|
| `POST /auth/demo-login` | 公开 | `{ "account": "student1" }`，仅预置账号 | 200 `{ token, user: User }` | 400 字段无效；401 `UNAUTHENTICATED` 账号不存在 |
| `GET /auth/me` | 已登录 | 无 | 200 `User` | 401 |
| `GET /events` | 已登录 | `page,pageSize,status?` | 200 `Event[]` 分页；所有可公开浏览的活动 | 400 无效筛选 |
| `GET /me/events` | 主办方 | `page,pageSize,status?` | 200 `Event[]` 分页；仅 token 所属主办方的活动，`total` 也是其活动数 | 403 |
| `GET /events/:eventId` | 已登录 | UUID 路径参数 | 200 `Event` 加 `myRegistration: Registration|null, myTicket: Ticket|null`；非学生均为 null。`myTicket` 只代表当前持有票 | 404 |
| `POST /events` | 主办方 | `Idempotency-Key: <uuid>`；`CreateEventInput` | 201 `Event`；同 key 同请求重放返回同一活动和 200 | 400/403/409/422/503 |

`GET /events` 与 `GET /me/events` 的 `status` 只接受四个 `EventStatus` 枚举值。列表筛选、计数和分页必须在服务端完成；主办方列表不能先分页全部活动再由前端筛选。

`CreateEventInput` 为：

```json
{
  "title": "Campus Design Night",
  "description": "An evening of student projects.",
  "location": "Hall A",
  "capacity": 120,
  "registrationDeadline": "2026-10-01T10:00:00Z",
  "startAt": "2026-10-02T10:00:00Z",
  "endAt": "2026-10-02T12:00:00Z"
}
```

`title` 1–100 字符，`description` 最多 2000 字符，`location` 1–200 字符；`capacity` 为正整数；创建时要求 `now < registrationDeadline < startAt < endAt`。活动 ID 由后端生成，`organizerId` 从 token 获取，不接收客户端指定的主办方或状态。相同 `Idempotency-Key` 必须绑定同一个 actor、请求摘要和 eventId；相同请求恢复已有结果，不同请求或不同 actor 用同 key 返回 `409 IDEMPOTENCY_CONFLICT`。创建链上确认前不能返回 201。

## 4. 报名、抽签与领票

| 方法与路径 | 权限 | 请求 | 成功状态与 `data` | 主要失败 |
|---|---|---|---|---|
| `POST /events/:eventId/registrations` | 学生 | `{}` | 201 `Registration`，初始 `REGISTERED` | 403/404/409 `ALREADY_REGISTERED`/422 `REGISTRATION_CLOSED` |
| `GET /me/registrations` | 学生 | `page,pageSize` | 200 带 `event` 的 `Registration[]` 分页；中签发布前只能显示 `REGISTERED` | 403 |
| `POST /events/:eventId/draw` | 该活动主办方 | `{}` | 200 `{ eventId, winnerCount, winnersHash, txId }`，仅在链上确认后 | 403/404/409/422/503 |
| `GET /events/:eventId/draw` | 该活动主办方 | 无 | 200 `{ status, registrationCount, winnerCount, winnersHash, winners: User[] }` | 403/404 |
| `POST /events/:eventId/tickets/claim` | 中签学生 | `{}` | 201 `Ticket` | 403/404/409/422/503 |

报名截止条件是 `now < registrationDeadline`；单活动最多 1000 人，达到上限返回 `409 SOLD_OUT`。报名唯一键 `(eventId,userId)` 防并发重复。抽签在截止时刻及之后、活动开始前、状态 `OPEN` 时进行；结果由服务端安全随机选择 `min(capacity, registrationCount)` 人，名单按 userId 升序形成规范 JSON，计算 `winnersHash = SHA256(UTF8(JSON.stringify(sortedWinnerIds)))` 的小写十六进制。`DRAWING` 为后端保存候选名单并尝试发布的中间状态，`GET /events/:id/draw` 在 `OPEN` 和 `DRAWING` 时返回 `winnersHash:null,winners:[]`；已发布后返回按 userId 排序的获胜 `User[]`。只有本活动主办方可见名单。已确认同一抽签的重试返回 `409 ALREADY_DRAWN`，处理中返回 `409 DRAW_IN_PROGRESS`；不重新生成随机名单。

领票要求已确认中签、尚未领取、`now < startAt` 且未超发行量；成功票 ID 固定为 `SHA256(UTF8("ticket:" + eventId + ":" + winnerId))`。重复领票返回 `409 ALREADY_CLAIMED`，未中签返回 `409 NOT_WINNER`，活动已开始返回 `422 CLAIM_CLOSED`。网络结果不明时先查 `GET /me/tickets` 或活动详情的 `myTicket`。

## 5. 票、转让与检票

| 方法与路径 | 权限 | 请求 | 成功状态与 `data` | 主要失败 |
|---|---|---|---|---|
| `GET /me/tickets` | 学生 | `page,pageSize` | 200 带 `event` 的当前持有 `Ticket[]` 分页，包括转入票，转出后不再出现 | 403 |
| `GET /tickets/:ticketId` | 当前持有人、活动主办方、检票员 | 64 位 hex 票 ID | 200 带 `event` 的 `Ticket` | 403/404 |
| `POST /tickets/:ticketId/transfer` | 当前持有人 | `{ "toUserId": "<student UUID>" }` | 200 更新后的 `Ticket`；`ownerId` 立即变为接收人 | 403/404/409/422/503 |
| `POST /tickets/:ticketId/redeem` | 检票员 | `{}` | 200 `{ ticket: Ticket, operation: Operation }`；`operation.type` 为 `TICKET_REDEEMED`，`txId` 必有值 | 403/404/409/422/503 |

转让接收人必须是存在的**其他**学生账号；不用曾经报名。票必须 `ACTIVE`、`transferCount === 0` 且 `now < startAt`。已转让的原持有人不再有票详情/记录权限（活动主办方与检票员除外）。`originalWinnerId` 不变。无待接受状态，转让一经链上确认即改变持有人；页面的“转入邀请”是未来功能提案，不属于 v1。

检票要求 `startAt <= now < endAt` 且票为 `ACTIVE`。成功响应必须把更新票和**同一笔已确认核销交易**的 `Operation` 一起返回，便于成功页立即显示交易 ID；不得通过“另查最新操作记录”猜测本次交易。重复核销返回 `409 ALREADY_REDEEMED`。当请求超时，客户端先查 `GET /tickets/:ticketId`，若票已核销，再看操作记录核对交易；未能确认时不显示放行成功。票码目前仅为 ticketId，属于课程演示码，不能作为生产级防伪凭证。

## 6. 链上操作记录

| 方法与路径 | 权限 | 请求 | 成功状态与 `data` |
|---|---|---|---|
| `GET /events/:eventId/operations` | 该活动主办方 | `page,pageSize,type?` | 200 `Operation[]` 分页；`type` 只能为五种 `OperationType` 之一 |
| `GET /tickets/:ticketId/operations` | 当前持有人、活动主办方、检票员 | `page,pageSize` | 200 `Operation[]` 分页 |

只有 Fabric 已确认的 `EVENT_CREATED`、`DRAW_PUBLISHED`、`TICKET_CLAIMED`、`TICKET_TRANSFERRED`、`TICKET_REDEEMED` 可进入列表。报名为 SQLite 记录，不是链上操作。后端可以为活动创建记录补齐 `channelName` 和 `chaincodeName`；`blockNumber` 查不到时必须为 `null`。活动级记录可包含票级记录；票级记录只含这张票的领票、转让、核销。`fromUserId`/`toUserId`：转让分别记录旧/新持有人；领票的 `toUserId` 为领取人；其余按不适用填 `null`。

## 7. 状态码与稳定错误码

| HTTP | 错误码 | 使用场景 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | JSON、路径 ID、时间格式、分页/筛选、字段缺失或非法；创建缺少合法幂等 key |
| 401 | `UNAUTHENTICATED` | token 缺失、无效、过期；未知 demo 账号 |
| 403 | `FORBIDDEN`, `NOT_TICKET_OWNER` | 角色错误、非活动主办方、无票详情权限、非当前持有人转让 |
| 404 | `NOT_FOUND` | 活动或票不存在；无权得知资源存在时可统一用 404 |
| 409 | `IDEMPOTENCY_CONFLICT`, `ALREADY_REGISTERED`, `DRAW_IN_PROGRESS`, `ALREADY_DRAWN`, `NOT_WINNER`, `ALREADY_CLAIMED`, `SOLD_OUT`, `TRANSFER_LIMIT_REACHED`, `INVALID_RECIPIENT`, `ALREADY_REDEEMED` | 冲突或重复操作 |
| 422 | `REGISTRATION_CLOSED`, `DRAW_NOT_READY`, `CLAIM_CLOSED`, `TRANSFER_CLOSED`, `CHECKIN_CLOSED` | 活动状态或时间窗口不允许 |
| 503 | `FABRIC_UNAVAILABLE` | Gateway 不可用、提交状态不明且对账后仍无法确认；可带 `Retry-After` |

后端把链码的 `CODE:message` 映射为上述稳定错误码和 HTTP 状态。未知链码异常映射 503 或 500 并记录日志，不将底层异常原文返回浏览器。一般服务器故障使用 500 `INTERNAL_ERROR`。`GET` 若必须依赖链上读取而账本不可用，返回 503，不用可能过时的本地投影伪装实时结果。

## 8. 联调示例与结果核对

```http
POST /api/v1/tickets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/redeem
Authorization: Bearer <inspector-token>
Content-Type: application/json

{}
```

示例中的重复字母仅用于展示 ID 形状，真实值由链码计算或 Fabric 生成。成功响应结构如下；`ticket` 必须是完整票对象并附 `event`，`operation` 必须为本次交易：

```json
{
  "data": {
    "ticket": {
      "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "eventId": "8b03a0d0-702f-4823-a1e8-73fa7941d435",
      "originalWinnerId": "5bbff9db-5823-45c9-a2cc-f55a8a79db45",
      "ownerId": "5bbff9db-5823-45c9-a2cc-f55a8a79db45",
      "status": "REDEEMED",
      "transferCount": 0,
      "claimedAt": "2026-10-02T09:00:00Z",
      "redeemedAt": "2026-10-02T10:02:00Z",
      "event": {
        "id": "8b03a0d0-702f-4823-a1e8-73fa7941d435",
        "organizerId": "34158846-4fbe-4327-8f55-080087998dd6",
        "title": "Campus Design Night",
        "description": "An evening of student projects.",
        "location": "Hall A",
        "capacity": 120,
        "registrationDeadline": "2026-10-01T10:00:00Z",
        "startAt": "2026-10-02T10:00:00Z",
        "endAt": "2026-10-02T12:00:00Z",
        "status": "DRAWN",
        "registrationCount": 150,
        "winnerCount": 120,
        "issuedCount": 115,
        "redeemedCount": 1,
        "createdAt": "2026-09-20T10:00:00Z"
      }
    },
    "operation": {
      "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "eventId": "8b03a0d0-702f-4823-a1e8-73fa7941d435",
      "ticketId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "type": "TICKET_REDEEMED",
      "actorId": "1659f4ef-9e58-46b3-9d5d-b414ba6842fb",
      "fromUserId": null,
      "toUserId": null,
      "occurredAt": "2026-10-02T10:02:00Z",
      "txId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "channelName": "mychannel",
      "chaincodeName": "fairpass",
      "blockNumber": null
    }
  }
}
```

联调验收按 [共同契约第 7 节](SHARED_CONTRACT.md#7-三层联调验收)；重点再检查主办方两页分页总数一致、抽签中/确认后的名单可见性、转出后 owner 索引、检票返回交易 ID、Gateway 超时后读状态，以及 `requestId` 能对应后端日志。
