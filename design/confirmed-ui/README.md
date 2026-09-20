# FairPass 界面设计确认稿

本文件夹保存三种角色目前讨论确定的界面方向，供同学和 coding agent 实现时对照。图片是**布局和视觉参考**，不是可直接上线的素材或真实业务数据；图中的日期、姓名、二维码、票号、交易 ID、人数均为示意。实现时以 `docs/SHARED_CONTRACT.md` 的真实 API 响应为准。

本轮只整理设计，不改共享接口契约。尤其是“接收方接受转让”的流程与当前“发送即转移”接口不同，见 [实现与联调说明](IMPLEMENTATION.md#转让流程与当前接口的差异)。

## 已确认的共同视觉规则

- 页面使用统一的纯蓝底；顶部白色导航保持固定。活动与管理页面在蓝底上放**一整张**暖白内容页，避免在白底上堆许多小白卡。票页直接在蓝底上展示暖白纸票。
- 字体清楚、无发光；不用模糊背景、玻璃拟态、大面积渐变、红绿蓝状态块和拥挤的仪表盘。
- 蓝色同时用于主要操作按钮，包括学生的 `Claim ticket / 领票`。不要为领票另造一套强调色。
- 学生顶部始终有三个入口：`Events / 活动`、`My applications / 我的报名`、`My tickets / 我的门票`。票的堆叠、平铺、背面和转让过程不改变这三个入口。
- 主办方顶部只保留 `Event management / 活动管理`；检票员顶部只保留 `Check-in / 检票`。不显示其他角色的导航。

## 学生端

| 场景 | 确认稿 | 交互要点 |
|---|---|---|
| 活动列表 | [01-events.png](screens/student/01-events.png) | 蓝底上的连续暖白内容页；横向活动条目，不设“热门活动”。 |
| 我的报名 | [02-applications.png](screens/student/02-applications.png) | 报名、抽签和领票状态依次呈现；只有可领票时出现蓝色领票操作。 |
| 我的门票·堆叠正面 | [03-ticket-stack.png](screens/student/03-ticket-stack.png) | 紧密纸票叠放；左侧 `Next ticket`，右侧 `Show me!`；只露出后方票的窄边。 |
| 我的门票·2×2 平铺 | [04-ticket-grid.png](screens/student/04-ticket-grid.png) | 演示数据准备四张票；实际票数按 API 返回，不补假票。底部开关切回堆叠。 |
| 票背上半段 | [05-ticket-back-top.png](screens/student/05-ticket-back-top.png) | 翻面后仍是居中的竖长票，活动信息与二维码按阅读顺序排列。 |
| 票背底部 | [06-ticket-back-bottom.png](screens/student/06-ticket-back-bottom.png) | 向下滚动到票底才看到链上操作和完整交易哈希。 |
| 持票人发起转让 | [07-transfer-outgoing.png](screens/student/07-transfer-outgoing.png) | 入口在可转让票背面；发起前展示接收人、活动与一次转让限制。 |
| 接收方处理邀请 | [08-transfer-incoming.png](screens/student/08-transfer-incoming.png) | “待接收转让”属于“我的门票”内部入口；接受前不放入可用票堆、不显示可用二维码。 |

**活动详情**沿用活动列表的蓝底、白色导航和单张暖白内容页。页内采用一幅较大的横向活动图，加标题、说明、时间、地点、报名截止与一个主操作；报名后操作变为当前状态。这里没有单独收录旧的纯白背景预览，因为它的页面外壳已经被统一蓝底方案取代。

票正面以暖白纸张、小标签、左对齐无衬线标题、大块留白和下部局部插图组成；不要把照片铺满整张票。正面的白边与叠放时露出的白边必须是同一张票的真实材质。日期、二维码和链上信息以票背为准。

## 主办方

| 场景 | 确认稿 | 交互要点 |
|---|---|---|
| 活动总览 | [01-event-overview.png](screens/organizer/01-event-overview.png) | 查看自己创建的活动；`Create event / 创建活动` 打开同页表单抽屉；进入单个活动管理。 |
| 单个活动管理 | [02-event-detail.png](screens/organizer/02-event-detail.png) | 查看报名/中签/领票/核销数字、抽签阶段和已确认的链上操作。图示为已抽签状态；满足截止条件且尚未抽签时显示执行抽签操作。 |

## 检票员

这是**同一界面的三个互斥状态**，不是三张同时展示的结果卡：

1. [等待扫码或输入票号](screens/inspector/01-scan.png)
2. [查询成功后核对并确认](screens/inspector/02-review.png)
3. [链上确认后的核销成功](screens/inspector/03-success.png)

扫描/输入先查询票。检票员看过活动、当前持票人和票状态后，再明确确认核销；成功结果只在 Fabric 交易确认后显示。失败时复用单一结果区域，展示服务端错误和重新扫描入口。

## 页面顺序

```text
学生：活动列表 → 活动详情 → 报名 → 我的报名 → 中签领票 → 我的门票
                                                    ├─ 堆叠 ↔ 2×2 平铺
                                                    ├─ 翻到竖长票背 → 滚动查看链上记录
                                                    └─ 发起转让 / 查看待接收邀请

主办方：活动总览 → 创建活动表单抽屉 / 单个活动管理 → 链上记录详情

检票员：扫码或输入 → 查询并核对 → 确认核销 → 单一结果 → 扫描下一张
```

具体实现约束见 [IMPLEMENTATION.md](IMPLEMENTATION.md)。
