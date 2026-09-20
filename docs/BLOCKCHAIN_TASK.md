# 区块链同学开发清单

工作目录 `blockchain/`。先读 [共同契约](SHARED_CONTRACT.md) 与 [HTTP API v1](API_V1.md)。当前目录只有占位文件；下面均为待开发项。负责 Fabric test-network 可复现启动、TypeScript 链码、查询索引、部署和链码测试，并与后端共同验证 Gateway commit 确认。

## 1. 链上数据与信任边界

| 状态 | 建议键 / 内容 | 约束 |
|---|---|---|
| 活动 | `event:{eventId}` → `ChainEvent` | 容量、时间、抽签哈希/人数、发行/核销数；eventId 唯一 |
| 资格 | `eligibility:{eventId}:{userId}` | 仅 PublishDraw 原子生成；记录是否已领取 |
| 票 | `ticket:{ticketId}` → `Ticket` | 固定 SHA-256 ID；originalWinnerId 不变，ownerId 可变 |
| 持有人索引 | Fabric composite key，如 `owner~ticket(ownerId,ticketId)` | 领票添加；转让同交易删除旧键并添加新键 |
| 操作记录 | 按 eventId、ticketId、txId 可查询的复合键 | 同交易写入，`id=txId`，顺序稳定 |

链上不存报名表、手机号、姓名、邮箱、随机 seed 或完整活动文案。资格中 userId 是演示系统内部 UUID，仍须限制链上数据暴露范围。链码用 Fabric transaction timestamp，转换为 UTC ISO；不得读取本机时钟、网络随机数或外部数据库。输入做 UUID、整数、JSON 数组、时间格式和长度校验，业务异常统一 `CODE:message`。同一输入应产生确定性读写集。

Gateway 使用平台服务身份，因此链码无法独立识别真实 HTTP 角色，也不能从链上确认接收人是否存在。后端检查 token、角色、资源归属和接收人；链码独立检查容量、资格、owner、次数、票状态和时间，避免超发或重复核销。答辩中应说明该信任边界。

## 2. 全部交易方法

链码名 `fairpass`。参数都是字符串，数组用 JSON 字符串传入，成功返回 JSON 字符串。状态、索引、计数和 Operation 必须在同一 Fabric 交易中更新。

| 方法 | 参数 / 返回 | 必须检查和原子变更 |
|---|---|---|
| `CreateEvent` | `eventId,organizerId,capacity,startAt,endAt` → `ChainEvent` | ID/时间/容量合法、活动不存在；计数为 0、drawPublished=false；写 `EVENT_CREATED`，actorId 为 organizerId |
| `PublishDraw` | `eventId,winnerIdsJson,winnersHash` → `ChainEvent` | 未抽签且未开始；名单已排序/去重、人数 ≤ capacity；链码重算哈希；写资格、winnerCount/hash/drawPublished 和 `DRAW_PUBLISHED` |
| `ClaimTicket` | `eventId,winnerId` → `Ticket` | 已发布、交易时间 < startAt、资格未用、issuedCount < capacity、固定 ticketId 不存在；写票/资格领取标记/owner 索引/发行数及 `TICKET_CLAIMED` |
| `TransferTicket` | `ticketId,fromUserId,toUserId` → `Ticket` | 当前 owner、双方不同、ACTIVE、transferCount=0、交易时间 < startAt；更新 owner/次数、替换索引，写 `TICKET_TRANSFERRED`；接收人存在由后端验证 |
| `RedeemTicket` | `ticketId,inspectorId` → `Ticket` | ACTIVE、`startAt <= txTime < endAt`；写 REDEEMED/redeemedAt、核销数加一、`TICKET_REDEEMED`；检票员角色由后端验证 |

哈希规范与后端一致：中奖 UUID 升序、紧凑 JSON 数组（双引号、无空格），`SHA256(UTF8(json))` 的 64 位小写 hex。票 ID 为 `SHA256(UTF8("ticket:"+eventId+":"+originalWinnerId))`。txId 和时间必须取 Fabric 交易上下文，不接受调用方传入。actorId 由后端身份层担保，链码在记录中使用传参。

业务拒绝码至少覆盖 `VALIDATION_ERROR`、`NOT_FOUND`、`ALREADY_DRAWN`、`DRAW_NOT_READY`、`NOT_WINNER`、`ALREADY_CLAIMED`、`SOLD_OUT`、`CLAIM_CLOSED`、`NOT_TICKET_OWNER`、`TRANSFER_CLOSED`、`TRANSFER_LIMIT_REACHED`、`ALREADY_REDEEMED`、`CHECKIN_CLOSED`。重复提交不得再次增加计数。

## 3. 查询与历史

| 方法 | 参数 | 返回/要求 |
|---|---|---|
| `GetEvent` | `eventId` | 完整 ChainEvent，含 drawPublished、winnersHash、winnerCount、issuedCount、redeemedCount |
| `GetTicket` | `ticketId` | 当前票权、状态、transferCount、claimedAt、redeemedAt |
| `GetTicketsByOwner` | `ownerId` | owner 索引下的票，转出即消失、转入即出现；按 ticketId 稳定排序 |
| `GetOperationsByEvent` | `eventId` | 本活动五类操作，稳定排序，后端再倒序分页和 type 筛选 |
| `GetOperationsByTicket` | `ticketId` | 本票领票/转让/核销记录，不含其他票与报名 |

只读方法不得写状态。Operation 至少有 `id/txId,eventId,ticketId,type,actorId,fromUserId,toUserId,occurredAt`；HTTP 层补 channelName、chaincodeName 和可获得的 blockNumber。活动创建与抽签的 ticketId=null。记录与主状态同交易提交；未 commit 的提交不能进入成功历史。若历史超过演示上限，需与后端共同设计分页并更新接口版本，不能单方改变返回形状。

## 4. 网络与交付

- 基于官方 test-network。`blockchain/README.md` 写依赖版本、Docker/Fabric CLI 准备、干净环境启动、建通道、打包/安装/批准/提交链码、测试和停止网络的可执行命令；Windows 使用 WSL/Docker 时说明在哪个环境运行。脚本可重复执行或明确清理步骤。
- 给后端 Gateway 配置：channel、chaincode name、MSP ID、peer endpoint、TLS 根证书、客户端证书与私钥路径。不提交私钥/证书；至少提供真实 `GetEvent` 与一次写交易的 Gateway 联通验证。
- 说明重部署/升级及账本持久化预期，避免重启误清空演示状态。两场演示活动分别用于尚未开始的领票/转让、已提前领票且正在进行的核销；不能靠改后端本机钟绕过 Fabric 时间。
- 与后端一起核对精确字段、哈希算法、错误码映射和 commit 语义；README 记录方法签名、命令、样例输出与限制。

## 5. 必须通过的链码测试

1. 空账本创建→抽签→领票→转让→核销；每步查询状态、计数、索引和相应 txId 操作。
2. 相同 eventId 重建、重复抽签/领票、无资格领票、超发、重复/非 owner/转给自己、重复核销均被拒；拒绝后计数和索引不变。
3. 名单乱序、重复、超容量、hash 不匹配被拒；正确名单资格与 winnerCount 一致。
4. 开始/结束时刻边界符合领票、转让和核销规则；链码测试控制交易 timestamp，而非依赖后端时钟。
5. 并发领取最后额度、并发转让同票、并发核销同票，处理 MVCC 冲突后账本仅接受合法交易，历史与状态一致。
6. 转让后 owner 查询正确；活动/票历史不混入其他票或报名，多次查询顺序稳定。

联调验收需拿到真实 Gateway commit 确认与 txId，并确认 HTTP 核销响应的 operation 是本次交易。模拟 Gateway 不能代替链码验收。
