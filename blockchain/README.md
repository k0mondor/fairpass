# FairPass 区块链层（Hyperledger Fabric）

基于官方 `fabric-samples/test-network`，TypeScript 链码，通道 `mychannel`，链码名 `fairpass`。
接口契约见 `docs/SHARED_CONTRACT.md`、`docs/BLOCKCHAIN_TASK.md`。

## 1. 运行环境

| 项 | 内容 |
| --- | --- |
| 运行位置 | Ubuntu 20.04 虚拟机（不是 WSL） |
| Node.js | 20（手动安装） |
| Fabric / Fabric CLI | 2.4.6 |
| Docker | 26.1.3 |
| test-network 位置 | `~/hyperledger/fabric/scripts/fabric-samples/test-network`（下文记作 `$TN`） |

准备检查：

```bash
node -v && docker --version && docker ps
cd $TN && ../bin/peer version
```

## 2. 启动、部署、停止

```bash
cd $TN

# 干净启动（会清空旧账本）并建通道
./network.sh down
./network.sh up createChannel -c mychannel

# 首次部署链码（打包/安装/批准/提交一步完成），sequence 从 1 开始
./network.sh deployCC -ccn fairpass -ccp ~/fairpass-repo/blockchain/chaincode -ccl typescript -ccv 1.0 -ccs 1
```

升级链码：改完代码后版本号和 sequence 都要递增。先查当前 sequence：

```bash
export PATH=${PWD}/../bin:$PATH FABRIC_CFG_PATH=${PWD}/../config
export CORE_PEER_TLS_ENABLED=true CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051
peer lifecycle chaincode querycommitted -C mychannel -n fairpass
```

再用 `Sequence + 1` 重新 `deployCC`（例：`-ccv 1.1 -ccs 7`）。升级不会清空账本。

停止网络：

```bash
./network.sh down        # 删除容器和卷：账本全部丢失
```

### 账本持久化

- `./network.sh down` 会删除 peer/orderer 的卷，所有链上数据（活动、抽签结果、票、操作记录）都会丢。演示前不要执行。
- 想保留数据暂停网络：先 `docker ps -q > /tmp/running.txt`，再 `docker stop $(cat /tmp/running.txt)`；恢复时 `docker start $(cat /tmp/running.txt)`，等约 30 秒再查询（不要用 `down`）。链码容器（dev-peer…）停止后会被自动删除，`docker start` 提示 No such container 属正常，peer 会在第一次调用时重新创建。已实测：重启后账本数据不变。
- 升级链码（`deployCC` 递增 sequence）不影响已有账本数据。

## 3. 链码方法

所有参数都是字符串。时间为 UTC ISO 8601（带 `Z`），链码统一规范为 `...:00.000Z`。ID 必须是小写 UUID，`ticketId` 为 64 位小写十六进制。

| 方法 | 参数 | 类型 | 说明 |
| --- | --- | --- | --- |
| `CreateEvent` | `eventId, organizerId, capacity, startAt, endAt` | 写 | 重复创建返回 `IDEMPOTENCY_CONFLICT` |
| `GetEvent` | `eventId` | 读 | |
| `PublishDraw` | `eventId, winnerIdsJson, winnersHash` | 写 | 只能发布一次，开始前才能发布 |
| `ClaimTicket` | `eventId, winnerId` | 写 | 开始前，中签者领票 |
| `TransferTicket` | `ticketId, fromUserId, toUserId` | 写 | 每张票最多一次，开始前 |
| `RedeemTicket` | `ticketId, inspectorId` | 写 | 仅在 `startAt <= 当前 < endAt` 内 |
| `GetTicket` | `ticketId` | 读 | |
| `GetTicketsByOwner` | `ownerId` | 读 | 无票时返回 `[]` |
| `GetOperationsByEvent` | `eventId` | 读 | 按时间从旧到新 |
| `GetOperationsByTicket` | `ticketId` | 读 | 按时间从旧到新 |
| `Ping` | 无 | 读 | 联通检查，交付前可删除 |

### 哈希规则（与后端一致）

- `ticketId = SHA256("ticket:" + eventId + ":" + originalWinnerId)`，64 位小写 hex
- `winnersHash = SHA256(UTF-8(紧凑 JSON 数组))`，数组为按字典序（普通 `<` 比较，不用 `localeCompare`）严格升序、无重复的中签用户 ID

### 操作记录（Operation）字段约定

`id === txId`；`occurredAt` 取交易时间戳（不是本机时钟）。

| type | actorId | fromUserId | toUserId |
| --- | --- | --- | --- |
| `EVENT_CREATED` | organizerId | null | null |
| `DRAW_PUBLISHED` | organizerId | null | null |
| `TICKET_CLAIMED` | winnerId | null | winnerId |
| `TICKET_TRANSFERRED` | fromUserId | fromUserId | toUserId |
| `TICKET_REDEEMED` | inspectorId | 当前持有人 | null |

### 错误码

链码抛出 `CODE:message`，后端按 `CODE` 映射。

| 错误码 | 触发场景 |
| --- | --- |
| `VALIDATION_ERROR` | 参数格式错误、名单未排序/有重复/超出容量、哈希不匹配 |
| `NOT_FOUND` | 活动或票不存在 |
| `IDEMPOTENCY_CONFLICT` | `CreateEvent` 的 eventId 已存在 |
| `ALREADY_DRAWN` | 已发布过抽签结果 |
| `DRAW_NOT_READY` | 开始后才发布抽签；或未抽签就领票 |
| `NOT_WINNER` / `ALREADY_CLAIMED` / `SOLD_OUT` / `CLAIM_CLOSED` | 领票相关 |
| `NOT_TICKET_OWNER` / `INVALID_RECIPIENT` / `TRANSFER_LIMIT_REACHED` / `TRANSFER_CLOSED` | 转让相关（转给自己为 `INVALID_RECIPIENT`；已核销为 `ALREADY_REDEEMED`） |
| `ALREADY_REDEEMED` / `CHECKIN_CLOSED` | 核销相关 |

样例（调用成功与失败）：

```text
Chaincode invoke successful. result: status:200 payload:"{\"eventId\":\"...\",\"capacity\":1,\"startAt\":\"2026-10-03T17:56:18.000Z\",...,\"issuedCount\":0,\"redeemedCount\":0}"

Error: endorsement failure during invoke. response: status:500 message:"NOT_FOUND:event not found"
```

## 4. 测试

`scripts/test-fixes.sh` 在真实 test-network 上跑 11 个用例（建活动、重复建活动、抽签、领票、转给自己、转让、二次转让、核销、核销后转让、两条操作记录字段），约 5 分钟（需要等活动开始）。

```bash
cp ~/fairpass-repo/blockchain/scripts/test-fixes.sh $TN/
cd $TN && bash test-fixes.sh      # 期望 11 行全部 PASS
```

脚本在每次 invoke 前等 4 秒，等区块提交后再发下一笔。注意：`peer chaincode invoke` 返回时交易可能还没提交，连续调用要留出出块时间。

## 5. 给后端的 Gateway 配置

不要把证书和私钥提交到仓库。路径都在 `$TN/organizations/` 下。

| 配置项 | 值 |
| --- | --- |
| channel | `mychannel` |
| chaincode name | `fairpass` |
| MSP ID | `Org1MSP` |
| peer endpoint | `localhost:7051`（peer0.org1） |
| peer TLS 根证书 | `peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt` |
| 客户端证书 | `peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/signcerts/` 下的 `.pem` |
| 客户端私钥 | `peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/keystore/` 下的文件 |

背书策略为默认的多数派，需要 Org1 和 Org2 同时背书。使用 Gateway SDK 时，后端会自动选择需要的 peer。

## 6. 已知限制与待办

- 链码不校验调用者身份：是否真实学生、是否检票员由后端判断，链码只执行票级规则。
- 链码不检查 `toUserId` 对应的账号是否存在（见 `TransferTicket` 注释）。
- 交易时间用 Fabric 交易时间戳，不能靠改后端本机时钟绕过时间限制。
- 演示用的两场活动由 `scripts/demo-events.sh` 在链上准备（A：7 天后开始，用于领票/转让；B：已开始且已领票，用于核销）。这些活动只存在于链上，后端数据库里没有；界面演示需通过后端接口按同样时间线创建。
- 后端真实 Gateway 适配器尚未接入，`GetEvent` 和一次写交易的联通验证待做。
- 链码单元测试（名单异常、领票边界、时间边界、并发冲突）待补。
