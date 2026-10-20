# FairPass

基于 Hyperledger Fabric 的活动票务课程项目。学生报名、抽签、领票与转让；主办方创建活动并发布抽签；检票员核销入场。包含 React 三角色界面、Express + SQLite 后端，以及 TypeScript 链码；后端支持 Mock 和真实 Fabric Gateway。

## 项目结构

```text
fairpass/
├── frontend/                 # React + TypeScript：三角色预览与 HTTP client
│   └── src/
│       ├── pages/            # 学生、主办方和检票员页面
│       ├── components/       # 票卡与动画组件
│       └── api/client.ts     # v1 HTTP 契约的前端实现
├── backend/                  # Express、SQLite、Mock/真实 Fabric Gateway
├── blockchain/               # TypeScript 链码与 test-network 脚本
├── docs/                     # 共同契约、逐接口规范、三端任务清单
└── design/confirmed-ui/      # 已确认的界面截图与交互说明
```

## 数据边界

- **SQLite** 保存活动介绍、报名记录、抽签名单等常规业务数据。
- **Fabric 账本** 保存票数、领票资格、票权、转让和核销等关键状态与历史。
- 前端只调用后端 API；后端通过 Fabric Gateway 调用链码。

## 同学接手测试

首次拉取请按 [测试交接指南](docs/TESTING_HANDOFF.md) 启动。`backend/` 中运行 `npm ci`、`npm run demo:mock` 即可创建隔离的干净Mock数据和账号；前端接入该API后可操作完整业务流程。真实上链演示仍按Fabric环境指南启动。

## 本地预览

在 `frontend/` 运行 `npm ci`、`npm run dev`，打开 Vite 输出的地址。未设置 `VITE_API_BASE_URL` 时为**明确标注的界面预览**，操作只改变本地演示状态，不会创建真实票或链上交易。运行 `npm run build` 检查前端。接入后端时复制 `frontend/.env.example` 为 `.env.local`，填写以 `/api/v1` 结尾的 API 地址并重启 Vite。详细步骤见 [界面与启动指南](docs/UI_AND_FRONTEND_SETUP.md)。

真实联调使用本机 Ubuntu-22.04 WSL 测试网络：启动与验收命令见 [后端 WSL 联调指南](backend/README.md#本机-wsl-联调)。`npm run test:e2e:real` 验证 HTTP 创建、报名、抽签、领票、转让、核销和真实 Fabric 历史；Mock 模式不能通过真实交易 ID 检查。前端预览不会创建链上门票。

## 演示数据与 Git 提交

环境版本、首次安装、需要修改的配置文件及日常启动步骤见 [本机 Fabric 环境与演示复现](docs/LOCAL_FABRIC_SETUP.md)。

仓库保留界面、图片、账号初始化和演示活动准备脚本。数据库、Fabric 本地账本、`.env.local`、密钥以及 `.local/` 下的运行记录不进入 Git；现场领取、转让、核销后的状态也不会随代码提交。

新环境启动后端并初始化测试账号后，在 `backend/` 运行 `npm run demo:campus` 准备四组校园活动与展示门票，再运行 `npm run demo:prepare` 准备 **Pass it on.** 的「已中签、未领取」状态，供alex现场领票并转让给jamie。脚本通过真实接口写入演示数据，不会清空已有记录。演示过后需要另一张可领取的票时，运行 `npm run demo:prepare -- --new`。

本机演示使用以下 `frontend/.env.local` 配置，保存后重启前端；该文件不提交：

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1
VITE_TICKET_MOTION=full
```

## 开发契约与三人分工

- [共同业务与链码契约](docs/SHARED_CONTRACT.md)
- [三种身份的界面说明与前端启动指南](docs/UI_AND_FRONTEND_SETUP.md)
- [HTTP API v1：逐接口字段、权限和错误](docs/API_V1.md)
- [前端任务](docs/FRONTEND_TASK.md)
- [后端任务](docs/BACKEND_TASK.md)
- [Fabric 任务](docs/BLOCKCHAIN_TASK.md)

## 课程交付与展示材料

- [项目介绍与技术报告](docs/PROJECT_TECHNICAL_REPORT.md)：实际问题、产品与架构、实现原理、成果、团队分工填写区、改进思路、PPT逐页提纲及答辩问答。
- [视频录制操作清单](docs/VIDEO_RECORDING_CHECKLIST.md)：环境检查、活动时间安排、逐镜头操作与配音、证据采集和异常处理。

- [录制前真实使用走查](docs/MANUAL_RECORDING_WALKTHROUGH.md)：按角色逐步核对实际功能，附本轮前端回归结果。

材料依据当前代码编写；团队姓名、实际开发贡献、运行结果与真实截图需在提交前补齐。

## 可交互的真实演示数据

真实后端启动后，在WSL的 `/opt/fairpass-dev/backend` 运行 `npm run demo:interactive`，准备“开放报名体验”“领票与转让体验”“现场验票体验”三组数据。alex可报名或领取/转让，检票员可在开场前30分钟至结束期间对预领票核销。首次准备需约半分钟等待真实报名截止，核销从活动开始前30分钟起开放，核销窗口4小时。再次执行会保留历史、复用尚可操作的场次，并补充已用完或过期的场次；`npm run demo:interactive -- --new` 强制新增。记录在忽略的 `.local/interactive-demo.json`，不同场次标题带准备时间避免混淆。已领取并转出的旧票不会恢复为可领取。
