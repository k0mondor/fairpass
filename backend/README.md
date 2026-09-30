# FairPass Backend

FairPass 的 TypeScript + Express 后端。HTTP API 基础路径为 `/api/v1`，业务契约见仓库 `docs/API_V1.md` 与 `docs/SHARED_CONTRACT.md`。

当前完成项目初始化、统一 HTTP 基础设施、SQLite 初始迁移、演示账号 Seed、请求校验、Demo token 认证、活动查询和报名、统一 Fabric Gateway Adapter 与内存 Mock、幂等创建活动，以及可恢复的持久化抽签状态机；票务 HTTP 流程将按 `docs/BACKEND_TASK.md` 继续实现。

## 环境要求

- Node.js 22；当前基准版本见 `.nvmrc`
- npm 10+

## 本地启动

```powershell
npm ci
Copy-Item .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

默认监听 `http://127.0.0.1:3000`。健康检查位于 API 契约之外：

```text
GET /health
```

业务路由统一挂载在 `/api/v1`。JSON 请求体最大为 100 KB。浏览器 CORS 只响应 `CORS_ORIGIN` 中配置的精确 origin；需要允许多个本地前端时使用英文逗号分隔。

## 脚本

| 命令 | 用途 |
|---|---|
| `npm run dev` | 监听 TypeScript 文件并启动开发服务 |
| `npm run build` | 编译到 `dist/` |
| `npm start` | 运行编译后的服务 |
| `npm run typecheck` | 执行 TypeScript 类型检查 |
| `npm test` | 运行测试 |
| `npm run db:migrate` | 对 `SQLITE_PATH` 指向的数据库执行待应用迁移 |
| `npm run db:seed` | 执行迁移并幂等写入演示账号 |

## 数据库

SQLite 文件位置由 `SQLITE_PATH` 配置，默认示例为 `./data/fairpass.sqlite`。迁移会自动创建父目录，并在每个连接上启用：

- foreign keys
- 5 秒 busy timeout
- WAL journal mode
- NORMAL synchronous mode

初始迁移包含 `users`、`events`、`registrations`、`draw_winners`、`draw_attempts`、`idempotency_keys`，以及迁移历史表 `schema_migrations`。时间字段统一保存为 UTC ISO 8601 文本；输入格式将在服务校验层强制检查。

迁移按版本执行并记录，同一个数据库重复运行 `npm run db:migrate` 不会重复建表或清空已有数据。若已经记录的迁移版本未知或名称被改动，启动迁移会直接失败，避免静默使用不一致的 schema。

## 演示账号与认证

`npm run db:seed` 可重复执行，固定提供以下账号：

| account | 显示名 | 角色 |
|---|---|---|
| `student1` | 学生一 | STUDENT |
| `student2` | 学生二 | STUDENT |
| `student3` | 学生三 | STUDENT |
| `organizer1` | 主办方一 | ORGANIZER |
| `inspector1` | 检票员一 | INSPECTOR |

登录使用 `POST /api/v1/auth/demo-login`，请求体为 `{ "account": "student1" }`。成功后把 token 放入 `Authorization: Bearer <token>`，可通过 `GET /api/v1/auth/me` 查询当前身份。

token 使用 `DEMO_TOKEN_SECRET` 进行 HS256 签名，并校验 issuer、audience 和过期时间。服务启动时要求 secret 至少 32 个字符；有效期由正整数 `DEMO_TOKEN_TTL_SECONDS` 配置。角色来源于已签名 token，服务端同时检查对应用户仍存在且角色一致。

## 请求校验

共享校验模块覆盖 UUID、64 位小写十六进制票 ID、角色与状态枚举、带时区 ISO 时间、分页、活动创建、空请求体、转让目标和幂等 key。已知参数非法或请求形状错误统一返回 `400 VALIDATION_ERROR`；分页默认 `page=1&pageSize=20`，`pageSize` 最大为 100。

## 活动与报名接口

当前提供以下需要 Bearer token 的接口：

| 方法与路径 | 权限 | 说明 |
|---|---|---|
| `GET /api/v1/events` | 已登录 | 全部活动，支持 `page`、`pageSize`、`status` |
| `POST /api/v1/events` | 主办方 | 使用 UUID `Idempotency-Key` 创建活动，确认后返回 201，重放返回 200 |
| `GET /api/v1/me/events` | 主办方 | 只分页当前主办方的活动，`total` 也只统计本人 |
| `GET /api/v1/events/:eventId` | 已登录 | 活动详情；学生附加 `myRegistration` 和 `myTicket` |
| `POST /api/v1/events/:eventId/registrations` | 学生 | OPEN 且截止前报名，请求体为 `{}` |
| `GET /api/v1/me/registrations` | 学生 | 本人报名列表，每项附完整活动 |
| `POST /api/v1/events/:eventId/draw` | 本活动主办方 | 截止后、开始前发布唯一抽签结果，请求体为 `{}` |
| `GET /api/v1/events/:eventId/draw` | 本活动主办方 | 查询抽签状态；确认前隐藏名单与哈希 |

活动列表按 `createdAt DESC, id DESC` 稳定排序。到达 `endAt` 后，读取时状态自动呈现为 `FINISHED`，筛选和分页 total 使用相同的有效状态。

报名写入使用 SQLite `BEGIN IMMEDIATE` 事务，并由 `(event_id,user_id)` 唯一约束兜底。重复报名返回 `ALREADY_REGISTERED`，单活动达到 1000 人返回 `SOLD_OUT`，截止时刻及之后或非 OPEN 状态返回 `REGISTRATION_CLOSED`。报名只写 SQLite，不生成链上 Operation。

创建活动会先在 SQLite `BEGIN IMMEDIATE` 事务中把全局唯一的 `Idempotency-Key` 固定到 actorId、规范化请求 SHA-256 和 eventId，再调用 Gateway `CreateEvent`。只有 commit 确认，或通过 `GetEvent` 对账确认链上字段一致后，才会在同一 SQLite 事务中保存活动并把幂等记录标为 `CONFIRMED`。同 key、actor 和请求重放返回原活动与 200；不同 actor 或 payload 复用 key 返回 `409 IDEMPOTENCY_CONFLICT`。

提交结果未知时会保留 `PENDING` 记录并按固定 eventId 查询链上状态。链上存在且字段一致时完成本地收尾；明确不存在时只允许使用原 eventId 重试一次；查询仍不可用时返回 `503 FABRIC_UNAVAILABLE`。并发的相同创建意图会合并到同一进行中任务，不会生成第二个 eventId。Mock 模式下这些语义可用于恢复测试，但交易仍不是真实上链。

抽签在 SQLite `BEGIN IMMEDIATE` 事务中锁定报名快照，使用 Node.js 密码学安全随机数选择 `min(capacity, registrationCount)` 名中签者，再把排序后的规范 JSON、SHA-256 哈希和 `DRAWING` 状态一并持久化。Gateway 只接收这份已保存名单；确认后才写入 `draw_winners`、更新 `WON/LOST` 和把活动置为 `DRAWN`。并发请求不会生成第二份名单。

`PublishDraw` 结果未知或服务重试时，后端先用 `GetEvent` 对账：同一哈希会完成本地收尾，明确未发布时最多以原名单安全重试一次，哈希不一致则把尝试标记为 `CONFLICT` 并返回 503。`OPEN`/`DRAWING` 的查询始终返回 `winnersHash: null` 和空名单，只有本活动主办方能在确认后查看中签用户。

链上抽签尚未发布的活动，其 `winnerCount`、`issuedCount`、`redeemedCount` 为 0 且 `myTicket` 为 null。已确认抽签的活动通过统一 Gateway 读取链上计数和当前 owner；Gateway 不可用、链上记录缺失或提交结果仍不确定时返回 `503 FABRIC_UNAVAILABLE`，不会用本地零值或未确认投影伪装链上状态。

## Fabric Gateway Adapter

业务服务只依赖 `GatewayAdapter` 的 `evaluate(method,args)` 与 `submitAndConfirm(method,args)`，不直接依赖 Fabric SDK。提交成功结果包含业务 JSON、txId、确认状态、可用时的区块号，以及本次交易对应的 Operation。内部错误区分业务拒绝、网络、超时、背书、commit 失败和 commit 未知；链码 `CODE:message` 会映射到 API v1 稳定错误码，未知原文不会返回浏览器。

开发环境默认使用 `FABRIC_GATEWAY_MODE=mock`。Mock 实现活动、抽签资格、票、owner 索引和 Operation，支持以下交易与查询：

- `CreateEvent`、`PublishDraw`、`ClaimTicket`、`TransferTicket`、`RedeemTicket`
- `GetEvent`、`GetTicket`、`GetTicketsByOwner`、`GetOperationsByEvent`、`GetOperationsByTicket`

Mock 交易 ID 始终以 `mock-` 开头，`blockNumber` 始终为 `null`，服务启动时也会打印模拟模式警告。Mock 状态只保存在当前进程内，重启后清空；它用于服务和页面开发，不能作为真实上链验收证据。

测试可通过 `MockGatewayAdapter.queueFault(method, fault)` 注入网络、超时、背书、commit、业务冲突和 `COMMIT_UNKNOWN`。除 `COMMIT_UNKNOWN` 外，故障在状态写入前发生；`COMMIT_UNKNOWN` 会先应用状态再抛错，用于验证调用方通过查询对账，不能据异常直接判定交易失败。

设置 `FABRIC_GATEWAY_MODE=real` 时，路由和业务服务无需修改，但当前 real adapter 会安全返回 `503 FABRIC_UNAVAILABLE`。真实 Fabric SDK、证书加载与 peer 连接将在链码可用后接入；在此之前不能用 `real` 模式宣称联通成功。

## 目录

```text
src/
├── config/      # HTTP、认证与 Fabric 环境配置解析
├── db/          # SQLite 连接、迁移和后续仓储
├── errors/      # 稳定 API 错误码与状态映射
├── fabric/      # Mock/真实 Fabric Gateway adapter
├── middleware/  # requestId、日志、认证和错误中间件
├── routes/      # `/api/v1` HTTP 路由
├── services/    # 认证、token、业务服务和恢复流程
├── types/       # 共享后端类型及 Express 类型扩展
├── utils/       # 统一响应等通用工具
├── validation/  # 共享 Zod schema 与安全错误转换
├── app.ts       # Express 应用与中间件顺序
└── server.ts    # 进程入口
```

## HTTP 基础行为

- 允许的方法：`GET`、`POST`、`OPTIONS`
- 允许的浏览器请求头：`Authorization`、`Content-Type`、`Idempotency-Key`
- CORS 预检请求不要求 token
- 每次请求生成 UUID requestId，并通过 `X-Request-Id` 返回
- 单体成功响应使用 `{ data }`
- 分页响应使用 `{ data, page, pageSize, total }`
- 错误响应使用 `{ error: { code, message, requestId } }`
- 未知路由返回 `404 NOT_FOUND`
- 无效 JSON 或超出大小限制的 JSON 返回 `400 VALIDATION_ERROR`
- 未处理异常返回 `500 INTERNAL_ERROR`，不暴露堆栈或内部消息

每次请求完成后输出一行 JSON 日志，包括 requestId、方法、路径、状态码和耗时；可用时增加 actorId、eventId、ticketId、txId 和 errorCode。日志不读取请求头、token、请求体或查询字符串。

## 配置与敏感信息

复制 `.env.example` 为本地 `.env` 后再填写实际配置。不得提交 token secret、Fabric 私钥、客户端证书、真实数据库或本机环境文件。

`FABRIC_GATEWAY_MODE` 仅接受 `mock` 或 `real`。`mock` 只用于前期页面和服务联调；最终验收必须切换到真实 Fabric Gateway，模拟交易不能标记为真实上链。channel、chaincode、MSP、peer endpoint、TLS 根证书、客户端证书与私钥路径均从环境变量读取，任何凭据都不得提交到仓库。
