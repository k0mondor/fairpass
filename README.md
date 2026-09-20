# FairPass

基于 Hyperledger Fabric 的活动票务课程项目。学生报名、抽签、领票与转让；主办方创建活动并发布抽签；检票员核销入场。前端已有可运行的三角色界面预览，后端与链码仍待实现。

## 项目结构

```text
fairpass/
├── frontend/                 # React + TypeScript：三角色预览与 HTTP client
│   └── src/
│       ├── pages/            # 学生、主办方和检票员页面
│       ├── components/       # 票卡与动画组件
│       └── api/client.ts     # v1 HTTP 契约的前端实现
├── backend/                  # 待实现：Express、SQLite、Fabric Gateway
├── blockchain/               # 待实现：TypeScript 链码与 test-network 脚本
├── docs/                     # 共同契约、逐接口规范、三端任务清单
└── design/confirmed-ui/      # 已确认的界面截图与交互说明
```

## 数据边界

- **SQLite** 保存活动介绍、报名记录、抽签名单等常规业务数据。
- **Fabric 账本** 保存票数、领票资格、票权、转让和核销等关键状态与历史。
- 前端只调用后端 API；后端通过 Fabric Gateway 调用链码。

## 本地预览

在 `frontend/` 运行 `npm install`、`npm run dev`，打开 Vite 输出的地址。未设置 `VITE_API_BASE_URL` 时为**明确标注的界面预览**，操作只改变本地演示状态，不会创建真实票或链上交易。运行 `npm run build` 检查前端。接入后端时复制 `frontend/.env.example` 为 `.env.local`，填写以 `/api/v1` 结尾的 API 地址并重启 Vite。详情见 [前端说明](frontend/README.md)。

后端和区块链目录目前只有占位文件，不能进行真实三端联调。前端预览不是可入场票务系统。

## 开发契约与三人分工

- [共同业务与链码契约](docs/SHARED_CONTRACT.md)
- [HTTP API v1：逐接口字段、权限和错误](docs/API_V1.md)
- [前端任务](docs/FRONTEND_TASK.md)
- [后端任务](docs/BACKEND_TASK.md)
- [Fabric 任务](docs/BLOCKCHAIN_TASK.md)
