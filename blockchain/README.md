# FairPass 智能合约

TypeScript链码负责活动限额、中签资格、门票发行、归属转让、入场核销及操作记录。

## 主要交易

| 方法 | 作用 |
| --- | --- |
| `CreateEvent` | 保存活动容量与时间 |
| `PublishDraw` | 校验名单与摘要，写入中签资格 |
| `ClaimTicket` | 按资格发行确定性票号的门票 |
| `TransferTicket` | 更新持有人、转让次数及索引 |
| `RedeemTicket` | 在验票窗口核销门票 |

查询接口提供活动、门票、持有人门票列表及活动或门票操作历史。票号与原始中签者保持不变；转让变更当前持有人。领取、转让在开场前完成；核销窗口为开场前30分钟至活动结束。

## 构建与部署

```sh
cd chaincode
npm ci
npm run build
```

部署环境使用Fabric测试网络，安装与启动见 [Fabric环境指南](../docs/LOCAL_FABRIC_SETUP.md)。`scripts/upgrade-local-wsl.sh` 通过递增链码sequence升级现有网络，保留账本。后端启动入口为 `backend/scripts/start-real-wsl.sh`。

## 源码入口

- `chaincode/src/fairpass.ts`：合约交易、查询和索引。
- `chaincode/src/types.ts`：链上数据结构。
- 其余源文件：哈希计算、参数与存储辅助逻辑。

[业务契约](../docs/SHARED_CONTRACT.md) · [HTTP接口](../docs/API_V1.md)
