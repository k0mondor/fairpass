# 后端同学开发清单

工作目录 `backend/`。先读 [共同契约](SHARED_CONTRACT.md) 与 [HTTP API v1](API_V1.md)。这两份文档是联调验收依据。当前目录只有占位文件；下面均为待开发项。后端负责 SQLite 业务数据、权限、抽签和 Fabric Gateway 接入，并主持三端联调。

## 交付顺序

| 阶段 | 交付物 | 验收点 |
|---|---|---|
| 1. 服务骨架 | TypeScript + Express、环境配置、统一响应/错误、参数校验、请求日志 | 登录与 `/auth/me` 工作；错误有稳定 code 和 requestId |
| 2. 数据库 | SQLite 迁移、种子账号、唯一约束和索引、可重复初始化脚本 | 重启不丢状态；重复种子不新增账号 |
| 3. 基础业务 | 活动列表/详情、本人活动、报名、本人的报名 | 主办方分页仅本人活动；并发报名不重复 |
| 4. 账本集成 | Gateway adapter、创建、抽签、领票、转让、核销 | HTTP 2xx 只在 Fabric commit 确认后；超时不伪造成功 |
| 5. 联调 | 票/操作记录、错误映射、三角色端到端测试、运行说明 | API v1 的字段、权限和失败路径通过 |

可以先用与真实 Gateway 相同接口的模拟 adapter 支持页面开发；最终演示路径必须连接真实 Fabric。模拟响应不能声称是真实链上交易。

## 1. 工程与数据库

- 建议按 `src/routes`、`src/services`、`src/db`、`src/fabric`、`src/middleware` 拆分。路由解析/校验并包装响应；服务层管理状态、权限和恢复；Gateway adapter 封装提交、commit 状态及查询。提供 `.env.example`，不提交私钥、证书、真实数据库、token 或本机环境文件。
- 表至少有 `users`、`events`、`registrations`、`draw_winners`、`draw_attempts`、`idempotency_keys`，字段和约束见共同契约第 6 节。`registrations(event_id,user_id)` 唯一；`draw_attempts(event_id)` 唯一。幂等记录保存 actor、请求摘要、eventId、执行状态、已确认 txId 和时间。为主办方、活动状态、报名和分页排序建索引。启用 SQLite 外键；写操作用事务和锁避免并发抽签/创建双推进。
- 预置至少 1 个主办方、1 个检票员、3 个学生，并给前端 account 名称。服务端签发/验证有到期时间的演示 token。身份与角色只来自 token；`toUserId` 是转让目标，必须查到且为学生。生产身份认证不属于本课程范围。
- 校验 UUID、64 位票 ID、字符串长度、整数、ISO 时间、枚举和请求形状；按 [API v1 错误表](API_V1.md#7-状态码与稳定错误码) 返回。日志带 requestId、actorId、资源 ID、txId 和耗时；不得记录 token、私钥或把异常堆栈返回浏览器。

## 2. 全部 HTTP 路由

| 模块 | 接口 | 关键行为 |
|---|---|---|
| 认证 | `POST /auth/demo-login`, `GET /auth/me` | 仅预置账号；无效/过期 token 为 401 |
| 活动 | `GET /events`, `GET /me/events`, `GET /events/:id`, `POST /events` | `/me/events` 在 SQL 层按 organizerId 筛选后分页，total 只算本人；`myTicket` 按当前 owner 查 |
| 报名 | `POST /events/:id/registrations`, `GET /me/registrations` | OPEN 且截止前；唯一约束及单活动 1000 人上限；DRAWING 时不暴露候选名单 |
| 抽签 | `POST /events/:id/draw`, `GET /events/:id/draw` | 本活动主办方、截止后/开始前、只抽一次；成功返回真实 txId |
| 票 | `POST /events/:id/tickets/claim`, `GET /me/tickets`, `GET /tickets/:id`, `POST /tickets/:id/transfer` | 资格/时限校验；按 owner 索引查当前持有票；转出后本人列表和详情权限立刻更新 |
| 核销 | `POST /tickets/:id/redeem` | 仅检票员及活动时间窗口内；返回 `{ ticket, operation }`，operation 为本次已确认交易且含 txId |
| 历史 | `GET /events/:id/operations`, `GET /tickets/:id/operations` | 只有已确认 Fabric 操作；权限、服务端分页和类型筛选；报名不混入 |

公共 `GET /events` 不能代替主办方列表：不能先分页全部活动，再让前端过滤。票和报名列表每项附完整 `event`。检票成功的操作记录由本次交易确定，不能另查“最新一条”猜测。区块号查不到就填 `null`。必须读链上实时状态而 Gateway 不可用时返回 503，不用未确认的投影伪装成功。

## 3. 写交易、幂等与恢复

**创建活动：** 验证字段、时间、角色和 `Idempotency-Key`；在 SQLite 事务中以全局唯一 key 固定 actorId、请求摘要和 eventId，再调用 `CreateEvent`。确认后保存活动与 txId，返回 201。同 key、同 actor、同请求重放返回同一活动；不同 actor 或 payload 复用 key 为 `409 IDEMPOTENCY_CONFLICT`。HTTP/Gateway 在提交后超时，按固定 eventId 查 `GetEvent`：存在且字段一致则完成本地收尾；可确定未提交才重试；仍不确定返回 503。不得生成第二个 eventId。

**报名：** 先检查活动状态和截止时间，再在事务中插入。数据库唯一键兜底并发防重；1000 人上限。报名不提交 Fabric，不生成链上 Operation。

**抽签：** 截止后、开始前，本活动主办方才能把 OPEN 转为 DRAWING。同一 SQLite 事务中锁定报名快照，用密码学安全随机数抽取 `min(capacity,N)` 人；把排序名单的规范 JSON、哈希和状态持久化。之后只用这份名单提交 `PublishDraw`。确认后保存 txId、获胜名单与 WON/LOST，转为 DRAWN。超时/重启先查 `GetEvent`：链上同哈希已发布则本地收尾；未发布则继续用原名单；哈希不同停止并报警，绝不重新抽签。DRAWING 时 API 隐藏候选名单。

**领票、转让、核销：** 先核验 HTTP 身份、活动窗口和数据库接收人，再提交链码；链码独立复查票务规则。等 commit 确认，取确切的操作记录后返回成功。超时查询票、owner、计数和交易；503 不是业务拒绝，不能将未知结果直接重试为新意图。检票响应 operation 的 txId 必须与本次提交一致。

**状态与对账：** 读出时按 endAt 呈现 FINISHED，拒绝过期写入。链上计数是发行/核销事实源；本地投影只能在确认后更新。启动时或恢复命令扫描未完成创建/抽签，逐项对账；遇不一致留下审计记录，不静默清空。

## 4. Gateway 与运行配置

与区块链同学固定 channelName、`chaincodeName=fairpass`、MSP ID、peer endpoint、TLS 根证书、客户端证书/私钥路径。adapter 至少提供 `evaluate(method,args)` 和 `submitAndConfirm(method,args)`；后者返回 JSON、txId、确认状态及可获知的 blockNumber。提交后 commit 状态未知必须传给服务层明确处理。链码 `CODE:message` 映射为 HTTP 稳定码；网络、背书、commit 故障分开记录。

`.env.example` 列服务端口、前端 CORS origin、SQLite 路径、demo token secret/有效期及 Fabric 参数。`backend/README.md` 写安装、迁移、种子、启动、测试、模拟/真实 Gateway 切换和恢复步骤。演示准备一场未开始的活动供领票/转让，另一场已提前领票且正在进行的活动供核销；不能靠修改后端机器时钟绕过链码时间。

## 5. 必须通过的验收

1. 逐路由核对成功结构、必填字段、分页边界、筛选、错误码、三角色和资源权限；多主办方时 `/me/events` 的 `data` 与 `total` 均只属当前主办方。
2. 重复/并发报名只有一条；1000 人上限；截止瞬间的报名和抽签符合时间规则。
3. 两个抽签请求只发布一份名单；模拟 Gateway 超时与进程重启后，名单/哈希不变且能收尾。
4. 相同 key 创建只生成一个活动；同 key 不同 payload 为 409；链上已建、本地未收尾时可恢复。
5. 未中签、重复领票、超发、非持有人转让、第二次转让、无效接收人、过期转让、重复核销和时间窗外核销均被拒；转出后 owner 索引正确。
6. 核销返回 operation 的 txId 与历史一致；只有已确认交易进列表；Fabric 故障时无假成功或假区块号。

联调后在 `backend/README.md` 记录可复现命令、测试结果与限制；模拟 Gateway 不能代替真实上链验收。
