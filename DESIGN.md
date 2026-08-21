# DESIGN.md

## 气质与意象
深夜的高性能跑道与数据实验室：近黑背景、单一青柠色（lime）强调、等宽与压缩字体制造的工程仪表感。整体基调**克制、确定、高性能**——像一块专业运动手表的屏幕，而非常见的健身打卡 App 或浅色校医院报告。Coach 是默认首页；评估、计划、群体（教师）从悬浮/底部导航进入。

## 视觉策略
- Coach-first：空状态是一句宣言 + 七枚建议提问芯片 + 三张「一眼数据卡」；回答以打字机流式呈现
- 内容单列居中（coach 820px，assessment 1240px），大量留白；数据用图表与等宽数字呈现
- 图标使用 lucide 线性图标，统一 1.75 stroke
- 不使用 streak、火焰、排行榜、勋章等游戏化元素（产品红线）

## 配色（dark-only，:root 与 .dark 完全一致）
- 背景：近黑 `#080908`；表面 `#101210` / `#0B0C0B`；面板渐变 `linear-gradient(180deg,#101210,#0B0D0B)`
- 唯一强调色：青柠 `#C8FF3D`（主色 / 主序列 / 活跃态），文字反色 `#0A0B0A`
- 中性文本：`#F2F4EF`（主）/ `#8C918A`（muted）/ `#5C6158`（disabled）
- 描边：`#1E211B`（hairline）/ `#2A2E25`（border-strong，交互态）
- 状态色：
  - 向好 / 达成：青柠
  - 平稳 / 中段：暖黄 `#E8C55A`（points 60–79）
  - 需关注 / 未达标：陶土橙 `#FF7A45`（points < 60、未达线、风险）；不使用纯红，不做"失败"羞辱
- 图表：chart-1 青柠、chart-2 陶土橙、chart-3 暖黄、chart-4/5 灰绿

## 字体
- 标题 Display：`Archivo` 700/800，负字距 -0.02em
- 正文：`Barlow` + `Noto Sans SC`
- 标签/按钮：`Barlow Condensed`，大写、0.08–0.14em 字距
- 数字 / 元信息 / 溯源：`JetBrains Mono`，tabular-nums
- 通过 `@import`（`fonts.googleapis.cn` 中国大陆域名）在 `globals.css` 顶部（`@import 'tailwindcss'` 之前）引入

## 圆角与阴影
- 基准 `--radius: 1rem`；胶囊 `999px`；composer / stage cards `18px`；数据/面板卡 `16px`；glance 卡 `14px`
- 卡片 1px 描边，极轻或无阴影；导航与 composer 用 `backdrop-filter: blur` + `0 18px 50px -18px rgba(0,0,0,.9)`

## 动效与交互
- 性格：干脆、确定；`cubic-bezier(.2,.8,.2,1)` / ease-out，180–280ms
- 一次性进入：`rise`/`fade`；数字 count-up（1.4s）；环形 ringDraw、雷达 pathDraw、柱条 barFill（错峰 0.1–0.3s）
- 环境背景：两枚模糊径向光晕（青柠 + 冷蓝），`drift` 22s/28s 缓慢漂移，`pointer-events:none`
- 导航点：风险点在 at_risk 时 `pulseDot` 呼吸；流式光标 `blink` 1s step-end
- 尊重 `prefers-reduced-motion`
- 可点元素 `cursor-pointer`；悬停只改颜色/边框或 chip 的 `-2px` 位移，不做卡片缩放

## 组件规范
- Top bar：34px 青柠 `A` 瓦片 + APTAMS / VERIFIED FITNESS INTELLIGENCE；右侧风险胶囊（学生）+ 身份胶囊（渐变头像）+ 语言选择 + 登出
- AppNav：桌面悬浮胶囊（Coach/Score/Plan/Cohort，活跃点 + 青柠文字）；移动端底部四格 dock（◆ ◎ ▲ ≡）
- Coach 用户气泡：青柠实底、`18px 18px 4px 18px` 非对称圆角；助手回合：28px `◆` 头像 + 16px/1.65 正文，句后溯源芯片 `✓/~ /◐`
- 评分：>=80 青柠，>=60 暖黄，<60 陶土橙；pass 线为 60 分环形缺口

## 设计禁忌
- 禁止：科技蓝+紫渐变、玻璃拟态大面积、浅色主题、霓虹仪表盘
- 禁止：红色失败徽标、排行榜、连续打卡、体重/卡路里数值目标
- 禁止：临床/诊断式口吻；改为方向性、建议性、escalation 给老师/校医
- 禁止：在教师端出现学生心情/睡眠/屏幕时间等原始自报数据（架构红线）
- 禁止：在组件里硬编码 hex 语义色——通过 `globals.css` 令牌（`bg-primary`/`text-warn`/`border-border-strong` 等）使用；图表内联 fill 仅用于精确的设计规格色

## 实现令牌（globals.css）
- `@theme inline` 暴露 `--color-surface-0/2/3`、`--color-border-strong`、`--color-hairline`、`--color-mid`、`--color-warn`、`--font-display/--font-condensed` 给 Tailwind
- 所有颜色走 shadcn 语义变量；`--panel-grad` 为面板渐变，`--warn-soft` 为橙色文本
