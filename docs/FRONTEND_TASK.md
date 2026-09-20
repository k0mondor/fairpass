# 同学 A / 前端 Coding Agent 任务

先阅读 [共同契约](SHARED_CONTRACT.md)和 [HTTP API v1](API_V1.md)。`frontend/` 已有三角色页面和可运行的界面预览；后端/链码接通后仍需完成真实联调。仅通过 `/api/v1` 与后端交互，不自行计算抽签结果或票的有效性；页面以 API 返回状态为准。


## 页面与功能清单

| 页面 | 必做内容 | 对应接口 |
|---|---|---|
| 测试账号登录 | 选择预置账号、保存 token、展示当前角色、退出 | `POST /auth/demo-login`, `GET /auth/me` |
| 活动列表 | 标题、时间、地点、报名截止、状态、剩余阶段提示、分页 | `GET /events` |
| 活动详情 | 活动信息、报名按钮、本人报名和中签状态、领票按钮 | `GET /events/:id`, `POST /events/:id/registrations`, `POST /events/:id/tickets/claim` |
| 我的报名 | 每个活动的报名、中签、未中签状态 | `GET /me/registrations` |
| 我的门票 | 当前持有票、票码、活动信息、核销状态、转让入口，以及“链上流转记录”时间线 | `GET /me/tickets`, `GET /tickets/:id`, `GET /tickets/:id/operations` |
| 转让门票 | 录入接收人的用户 ID，二次确认，显示操作结果 | `POST /tickets/:id/transfer` |
| 主办方活动管理 | 创建活动、查看本人活动、报名/中签/已发/已核销数字、执行抽签；管理详情放显眼的“查看链上记录”入口 | `POST /events`, `GET /me/events`, `GET /events/:id/draw`, `POST /events/:id/draw` |
| 检票页 | 输入或扫描 ticketId，先查询票和活动，再提交核销，显示清晰结果 | `GET /tickets/:id`, `POST /tickets/:id/redeem` |
| 链上记录 | 主办方查看该活动的建活动、抽签发布、领票、转让、核销交易；点击一条打开详情抽屉 | `GET /events/:id/operations`, `GET /tickets/:id/operations` |

## 开发约定

- 集中定义共享类型和 API client；统一处理 token、`{data}`、分页与 `{error}`，避免每页各写一套请求。
- 创建活动时为同一次提交生成 `Idempotency-Key`，超时重试保持该 key；修改表单后换新 key。
- 主办方列表由 `/me/events` 在服务端按本人筛选并分页；不能对 `/events` 的单页结果本地筛选。
- 按角色控制导航和按钮，但权限最终以后端为准。活动详情根据 `myRegistration`、`myTicket` 和时间状态决定按钮文案。
- 提交操作时禁用按钮，避免双击；409/422 使用服务端 message；503/请求超时后重新查询状态。
- 票码先展示完整 ticketId 并提供复制功能；扫码可用现成浏览器库，若时间不足，手动输入是必须完成的主路径。
- 转让确认要显示接收人 ID、活动名和“最多转让一次”。检票确认要显示活动名、票状态和当前持有人。
- 交易详情抽屉显示：操作类型、交易时间、交易 ID（可复制）、通道、链码、票 ID、转出/接收人及区块号（有值才显示）。只显示已确认交易；不要把“报名成功”画成链上交易。领票、转让、核销成功页提供“查看链上记录”入口；检票成功时直接显示 txId 的缩略值。
- 检票成功使用 `POST /tickets/:id/redeem` 返回的 `{ticket,operation}`；operation 必须是本次已确认交易，不以另查“最新一条”推断。
- “链上记录”用清晰的时间线或表格，默认显示 20 条，支持类型筛选；主办方活动管理详情应显示最近 3 条交易预览。
- 列表有加载、空状态和错误重试；手机宽度下学生票和检票页可正常使用。
- 在后端接口尚未完成时，使用与共同契约完全一致的 mock 数据；联调时切回真实 API，不把 mock 放进最终演示路径。

## 交付和验收

交付可启动的 React + TypeScript 前端、环境变量示例（API 地址）、演示操作说明。用三种角色从页面跑通共同契约第 7 节；非当前持有的转出票不再显示于“我的门票”。A 负责整理最终答辩演示顺序及测试账号表。

## 给 Coding Agent 的直接任务

> 阅读 `docs/SHARED_CONTRACT.md`、`docs/API_V1.md` 和本文件，在现有 `frontend/` 页面基础上与真实后端/链码联调。保持已确认的票卡动画与三角色界面；重点验证主办方本人分页、检票返回本次 txId、转出后票权查询和超时恢复。提交联调验证结果与仍未联通的接口。
