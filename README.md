# FairPass

基于 Hyperledger Fabric 的校园活动票务课程项目。覆盖创建活动、学生报名、限额抽签、中签领票、用户名转让、现场验票和链上历史查询。采用 React + TypeScript 前端、Express + SQLite 后端和 TypeScript 智能合约。

## 快速开始：带预置数据的功能测试

需要 Node.js 22 和 npm 10+。以下命令在 PowerShell 执行，其他系统将 `Copy-Item` 换为对应的复制命令。

终端一，启动后端：

```powershell
cd backend
npm ci
npm run demo:mock
```

等待打印 `READY: clean Mock demo`（约两分钟）。该命令自动初始化演示账号和7个活动，包含四组展示门票及开放报名、待领票/转让、待验票三种可操作场次。

终端二，从仓库根目录启动前端：

```powershell
cd frontend
npm ci
Copy-Item .env.example .env.local
npm run dev -- --strictPort
```

打开 `http://127.0.0.1:5173/`。前端配置中的API默认指向 `http://127.0.0.1:3000/api/v1`；修改 `.env.local` 后需重启前端。端口被占用时先停止旧服务。若PowerShell限制npm脚本，可使用 `npm.cmd`。

Mock使用内存账本，交易ID以 `mock-` 开头，不代表真实上链。每次 `npm run demo:mock` 都创建新的配套数据库与Mock账本，恢复可操作初始状态，不继承其他人的手工活动及测试操作。未设置API地址时，前端仅为界面预览。

## 演示账号与操作顺序

登录时选择身份，再输入用户名和密码。以下均为课程演示账号，密码统一为 `123456`。

| 账号 | 身份 | 主要用途 |
| --- | --- | --- |
| alex | 学生 | 报名、领取门票、转让 |
| jamie | 学生 | 接收转让、查看门票与历史 |
| morgan | 主办方 | 创建活动、查看报名、发布抽签 |
| taylor | 检票员 | 查询票码、复核并核销 |
| casey | 学生 | 三人竞争两个名额的额外测试账号 |

建议先用alex体验开放报名、领取与转让，jamie查看收到的票，再用taylor核销预领的验票专场门票。自行创建活动时，用当前时间安排报名截止、开始和结束；截止后由morgan发布抽签。完整步骤与预置状态见 [测试交接指南](docs/TESTING_HANDOFF.md)。

- 用户名大小写不敏感地唯一，转让需手动输入另一个已存在的学生用户名。
- 领取与转让须在开场前进行，每票最多转让一次；转让确认后立即变更归属。
- 验票窗口为开场前30分钟至活动结束，结束时刻不包含；已核销票不能再转让或核销。
- 页面按UTC+8显示时间，API与账本使用UTC。

## 真实Fabric联调与录制

安装、证书配置、WSL启动及旧链码升级见 [Fabric环境指南](docs/LOCAL_FABRIC_SETUP.md)。当前规则要求链码包含提前验票逻辑；已有网络须升级链码，不能仅重启前端。

真实后端启动后，在实际运行后端的环境执行：

```sh
npm run demo:campus
npm run demo:interactive
```

前者准备四组校园展示活动与门票，后者准备可报名、待领票和待验票场次；过期或使用后重新运行会补充可操作场次，`npm run demo:interactive -- --new` 强制新增。脚本通过API写入业务数据，不重置既有账本。另有 `npm run demo:prepare` 准备 **Pass it on.** 的已中签、未领取场次，适合现场展示领取与转让。

真实交易须等待Fabric提交确认，历史记录通过QSCC查询实际区块号；报名记录保存在SQLite，不标为上链。`npm run test:e2e:real` 会创建独立测试活动并消费测试票，不能用来准备待操作门票。

## 项目结构与数据边界

```text
frontend/                  React三角色界面、登录、票卡与HTTP客户端
backend/                   Express业务服务、SQLite、Mock/真实Gateway
blockchain/                TypeScript智能合约、测试及部署脚本
docs/                      架构契约、环境指南、测试交接和课程材料
design/confirmed-ui/       界面设计参考
```

SQLite保存账号、活动介绍、报名和抽签编排数据；Fabric保存限额、中签资格、票权、转让、核销及关键操作历史。前端仅调用后端API。

Git提交代码、配置模板、演示账号定义和数据生成脚本。数据库、Fabric账本、手工创建的 `test` 活动、已操作状态、`.env`、私钥、token与 `.local/` 运行清单均不上传；同学拉取后生成自己的初始数据。

## 验证

| 目录 | 命令 |
| --- | --- |
| `frontend/` | `npm test`、`npm run build` |
| `backend/` | `npm run typecheck`、`npm test` |
| `blockchain/chaincode/` | `npm ci`、`npm test` |
| 真实后端运行目录 | `npm run fabric:check`、`npm run test:e2e:real` |

最近验证：2026-10-20，后端96项、前端23项、链码12项测试通过，前端构建通过；真实Fabric已验证票务流程、开场前核销与历史区块号。自动化测试与Mock体验不能替代录制前的真实环境走查。

## 文档入口

- [测试交接指南](docs/TESTING_HANDOFF.md)：从启动、账号到实际操作。
- [Fabric环境指南](docs/LOCAL_FABRIC_SETUP.md)：安装、启动、配置与升级。
- [共同业务与链码契约](docs/SHARED_CONTRACT.md)、[HTTP API v1](docs/API_V1.md)：实现和联调依据。
- [前端界面说明](docs/UI_AND_FRONTEND_SETUP.md)及各模块README：开发与运行细节。
- [项目技术报告](docs/PROJECT_TECHNICAL_REPORT.md)：项目故事、需求、架构、设计、团队分工、成果及PPT内容依据。
- [视频录制操作清单](docs/VIDEO_RECORDING_CHECKLIST.md)：录前检查、分镜、操作、配音及证据采集。

课程材料中的团队姓名、实际贡献与待补截图需由团队填写，不能用界面预览图代替真实运行证据。
