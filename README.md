# FairPass

基于 Hyperledger Fabric 的活动票务课程项目。用户报名后参与抽签，中签者领取电子票；系统记录票权转让与入场核销，防止超发和重复核销。

## 项目结构

```text
fairpass/
├── frontend/                 # React + TypeScript：用户、主办方和检票员页面
│   └── src/
│       ├── pages/            # 页面
│       ├── components/       # 复用组件
│       └── api/              # 后端接口调用
├── backend/                  # Node.js + TypeScript + Express
│   └── src/
│       ├── routes/           # HTTP 路由
│       ├── services/         # 报名、抽签等业务逻辑
│       ├── db/               # SQLite 数据访问
│       └── fabric/           # Fabric Gateway 客户端
└── blockchain/               # Hyperledger Fabric
    ├── chaincode/src/        # TypeScript 链码：发票、转让、核销
    └── network/              # 测试网络配置或启动脚本
```

## 数据边界

- **SQLite** 保存活动介绍、报名记录、抽签名单等常规业务数据。
- **Fabric 账本** 保存票数、领票资格、票权、转让和核销等关键状态与历史。
- 前端只调用后端 API；后端通过 Fabric Gateway 调用链码。

## 第一阶段开发顺序

1. 跑通 Fabric 官方 TypeScript 链码和 Gateway 示例。
2. 约定活动、报名、门票的数据结构与 API。
3. 实现创建活动、报名、抽签、领票和核销的完整流程。
4. 增加票权转让、异常提示和演示数据。

当前仓库仅包含目录骨架，尚未安装依赖或实现业务功能。
