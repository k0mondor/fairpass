# FairPass 前端

React与TypeScript实现学生、主办方和验票员三类界面，包含身份登录、活动浏览、报名与领票、票卡堆叠和平铺、翻面二维码、用户名转让、主办方统计和验票复核。

## 启动

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev -- --strictPort
```

访问 `http://127.0.0.1:5173/`。在 `.env.local` 设置 `VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1` 连接后端。`VITE_TICKET_MOTION` 可设置为 `system` 或 `full`。构建命令为 `npm run build`。

## 代码入口

- `src/App.tsx`：身份会话、页面组织和门票业务交互。
- `src/pages/LoginPage.tsx`：账号密码登录。
- `src/pages/StudentPages.tsx`：学生报名、领票及转让。
- `src/pages/RolePages.tsx`：活动管理、交易记录和验票。
- `src/components/TicketStage.tsx`：票堆、平铺和票卡展开动画。
- `src/api/client.ts`：HTTP客户端、请求等待和分页加载。

演示账号和流程见 [项目说明](../README.md)，拍摄步骤见 [录制指南](../docs/VIDEO_RECORDING_CHECKLIST.md)。
