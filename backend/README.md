# FairPass 后端

Node.js 22、Express和TypeScript实现票务API，SQLite保存业务数据，Fabric Gateway执行合约交易与账本查询。API前缀为 `/api/v1`，健康检查为 `/health`。

## 演示启动

```powershell
npm ci
npm run demo:mock
```

自动构建服务、初始化演示账号，并准备校园活动和可操作门票。默认端口3000，每次启动使用新的SQLite数据库和内存Mock账本。

## 配置启动

```powershell
npm ci
Copy-Item .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

配置文件设置数据库路径、认证密钥、CORS及Fabric连接。`DEMO_TOKEN_SECRET` 至少32字符。真实Fabric环境使用 `FABRIC_GATEWAY_MODE=real` 并填写TLS证书和服务身份路径，具体见 [环境指南](../docs/LOCAL_FABRIC_SETUP.md)。

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 编译后端 |
| `npm start` | 启动编译后的服务 |
| `npm run typecheck` | 类型检查 |
| `npm run db:seed` | 初始化演示账号 |
| `npm run demo:campus` | 准备校园展示活动与门票 |
| `npm run demo:interactive` | 准备报名、待领票和待验票场次 |
| `npm run demo:prepare` | 准备Pass it on.领票转让场次 |
| `npm run fabric:check` | 检查Fabric读写连接 |

## 代码结构

`routes/` 定义接口，`middleware/` 校验身份与权限，`services/` 编排业务及异常恢复，`db/` 提供迁移与仓储，`fabric/` 提供真实与Mock适配器。

创建、抽签和票务交易等待Fabric提交确认，结果不确定时查询实际状态进行对账。历史通过QSCC补充真实区块号。账号定义保存在 `src/db/seed.ts`，完整账号见 [项目说明](../README.md)。

[HTTP接口](../docs/API_V1.md) · [业务契约](../docs/SHARED_CONTRACT.md)
