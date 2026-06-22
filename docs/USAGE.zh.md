# Router 使用指南

> 🌐 **Language** · [English](./USAGE.md) · **中文**

Router 是一个给 Claude 用的团队共享笔记。你平时怎么和 Claude 聊天都不变，只需要在某些时刻说一句"同步"，Claude 就会自动把对话里最有价值的部分整理成一条 entry，发到团队的 Router，队友都能看到。

**线上地址**：<https://router.feedling.app>

网页右上角 Settings 里可以切换界面语言（English / 中文）。

---

## 目录

- [3 分钟上手](#3-分钟上手)
- [同步的三种方式](#同步的三种方式)
- [同步之后发生什么](#同步之后发生什么)
- [浏览和查找](#浏览和查找)
- [Channels — 频道和订阅](#channels--频道和订阅)
- [Channel Skill — 让 Claude 懂你的频道](#channel-skill--让-claude-懂你的频道)
- [Webhook Skill — 推送到飞书 / HTTP](#webhook-skill--推送到飞书--http)
- [个人通知 webhook — 被 @ 时通知到飞书](#个人通知-webhook--被--时通知到飞书)
- [反馈入口](#反馈入口)
- [常见问题](#常见问题)

---

## 3 分钟上手

### Step 1：创建账号 / 加入团队

访问 <https://router.feedling.app/register>：

- **Create a Team**：填个 handle（只允许小写字母、数字、下划线，比如 `alex`）+ 团队名 → 拿到一个 secret key。**务必保存好**，这是你的身份凭证
- **Join a Team**：粘贴 admin 给你的 invite 链接，或者手动填邀请码

### Step 2：连接 Claude

进 Settings 页面 → "Connect Claude" 区块，按你用的客户端选一个：

- **Claude Code (CLI)**：一键复制命令到终端执行，长这样
  ```
  claude mcp add router --transport sse --scope user "https://router.feedling.app/mcp/sse?key=你的KEY"
  ```
- **Claude Desktop / Web**：复制 MCP URL 去 Settings → Connectors → Add custom connector 添加
- **OpenAI Codex**：在项目根目录创建 `.codex/config.json`：
  ```json
  {
    "mcpServers": {
      "router": {
        "type": "sse",
        "url": "https://router.feedling.app/mcp/sse?key=你的KEY"
      }
    }
  }
  ```
- **Cursor / Windsurf**：同样支持 MCP，在各自的 Settings → MCP 配置里添加 SSE 类型的 server，URL 填上面那个即可

**就这样**。Router 的使用 skill 会从服务端自动下发到 Claude，不用复制任何 CLAUDE.md。其他 MCP 客户端（Codex / Cursor 等）同样会拿到工具列表，但各客户端对 MCP instructions 的支持程度不同——如果发现 Codex 不会自动同步，可以手动告诉它"说同步的时候调 router_write"。

### Step 3：试一下

打开 Claude，随便聊几句技术话题，结束时说："**同步一下**"。Claude 会自动生成摘要、打标签、发布到 Router。刷新 <https://router.feedling.app> 就能看到。

---

## 同步的三种方式

Router 的核心操作就是"同步"——把对话里有价值的结论写到团队笔记里。有三种触发方式：

### ① 主动同步（立即写入，不问你）

对 Claude 说下面任何一句，都会立刻生成摘要并发布：

| 中文 | 英文 |
|------|------|
| "同步" / "同步一下" / "记一下" | "sync" / "push to router" / "sync to router" |

想指定频道也行：
```
同步到 #feedling
push to #design
```

### ② Claude 主动问你（需要确认）

你没说同步，但对话里出现了"值得记"的信号，Claude 会在回复末尾轻轻问一句：

> "要同步到 Router 吗？"

触发信号包括：

- **决策落地**："就用这个方案" / "定了" / "就这样"
- **洞察 / 发现**："原来是..." / "我发现" / "有意思"
- **问题解决**：bug 修好、功能跑通、部署成功
- **对话收尾**："好了" / "搞定" / "差不多了"

你答 "好" / "是" / "同步" → 立即写入；答 "不用" → 跳过，同一段对话不会再问第二次。

### ③ 什么都不会触发的情况

- 纯执行操作：改文件、跑命令、修 typo
- 闲聊、不涉及技术或决策
- 你明确说了"不用记" / "别同步"

---

## 同步之后发生什么

Claude 的回复里一定会告诉你四件事：

```
✅ 已同步到 Router（如果指定了 channel，会说明哪个）
📝 写入的摘要（你可以核对准不准）
🏷️ 使用的标签 + 为什么选这些（例如："复用 #feedling #frontend，新增 #postgres"）
🔗 Entry ID + 发布时间 + 查看链接
```

**15 分钟暂存期**：同步后的 entry 进入 15 分钟的暂存期，这段时间：
- 只有你自己能看到它
- 你可以在 Dashboard 直接删除
- 你可以点 "Publish now" 立即提前发布
- 超过 15 分钟自动发布给团队

暂存时长可以在 Settings → Publishing Delay 改，甚至可以改成 0（立即发布）。

---

## 浏览和查找

登录后的 <https://router.feedling.app> 就是 Dashboard：

### 筛选

- **点标签**：点任何一个 `#tag` 就按这个标签筛选，再点就取消
- **点作者**：点卡片里的 @handle 就只看这个人的 entry
- **搜索**：右下角的放大镜按钮，支持关键词或 `@username`
- **标签预设**：把常用的标签组合保存成预设，一键切换

### 导航

顶部的 nav：

- **🔔 Notifications**：有人评论你的 entry 或 @ 你时，未读数会显示红点
- **Channels**：看所有频道、订阅/退订、管理 channel skill
- **Members**：看团队成员和他们最近的 entry
- **Bookmarks**：你收藏的 entry
- **Guide**：这份说明文档
- **Settings**：个人资料、连接 Claude、暂存时长、通知 webhook
- **Profile**:你自己的主页

### Entry 卡片上的操作

每条 entry 右上角有一排图标：

- **📖 Bookmark**：收藏
- **📋 Copy**：复制摘要文本
- **🔗 Share**（只对已发布的 entry 显示）：复制一个链接，发给任何人点开都能看到这条 entry 详情
- **✏️ Edit**、**👁️ Hide**、**🗑️ Delete**（只对自己的 entry 显示）

---

## Channels — 频道和订阅

Channel 是团队内部的子话题分组。比如你可能有：

- `#feedling` — feedling 这个项目的所有讨论
- `#design` — 设计决策
- `#feedback` — 用户反馈（Router 会在你首次提交反馈时自动创建）
- `#daily` — 每日工作日报

### 使用方式

- **写入**：告诉 Claude "同步到 #feedling"，Claude 会把 entry 发到这个频道
- **订阅**：进 `/channels` → 点一个 channel → Join（open channel）或用邀请码
- **退订**：同一页 Leave
- **浏览**：Dashboard 上可以按 channel 筛选

### Channel 的权限

- **Open channel**：任何人都能 join
- **Invite-only**：需要 admin 生成邀请码

---

## Channel Skill — 让 Claude 懂你的频道

这是 Router 最强大的功能。你可以给每个 channel 写一份**"频道指令书"**，告诉 Claude：
- 这个频道的背景和术语表
- 写入前需要先查什么（比如查相关的历史 entry）
- 输出应该是什么格式
- 应该打哪些 tag
- 默认视角是前端还是后端

**Claude 在往这个 channel 写东西之前，会强制读完这份 skill 并执行里面的指令**。

### 例子

给 `#feedling` channel 加一份 skill，内容如下：

```markdown
## 背景
Feedling 是信息流产品，技术栈 React + Next.js 16。
核心模块：infinite-scroll、story-card、tag-bar。

## 术语表
- "infinite-scroll" 不要写成 "infinite scroll"
- "story card" 不要叫 "卡片"

## 写作前先做这些
- 查一下这个 channel 最近一周的 entry，看看有没有类似主题
  的讨论，找到就在 summary 里引用（"续 @alex 的 xxx"）

## 格式和标签
- 技术决策：问题 / 备选方案 / 最终选择 / 为什么
- 涉及性能或加载的必加 #perf
- 涉及无障碍的必加 #a11y
- 不使用表情符号

## 默认视角
默认是 frontend 视角，除非内容明确是后端
```

下次你说"同步到 #feedling"，Claude 会：

1. 读到这份 skill
2. 自己调用 Router 的搜索工具查最近一周的相关 entry
3. 按规则整理 summary、加正确的标签、控制语气
4. 最终回复里明确告诉你："**按 \"背景与术语\"、\"写作规则\" skill 整理了内容**"

### 怎么创建 Channel Skill

进 `/channels/<id>` → Skills tab → Create skill → 选 **📖 Channel Skill** → 按 `👉` 提示填你的内容

### 重要特性

- **团队任何成员都能编辑**，不是只有 admin
- **修改立即生效**，不需要你或队友重连 Claude
- **可以写多个**：一个管背景、一个管格式、一个管语气，Claude 会全部读完叠加应用
- **用自然语言描述意图**：不需要写任何代码或函数名，Claude 自己知道该调用什么工具

---

## Webhook Skill — 推送到飞书 / HTTP

第二种 skill：entry 写入这个 channel 时，server 会自动 POST 到你指定的 URL。可以用来：

- 推送到飞书群机器人（群里所有人收到通知）
- 推送到飞书多维表格（自动新增一行，做成"反馈表格"）
- 推送到 Slack、Telegram、任何接 webhook 的工具
- 自定义 HTTP 接口

### 怎么创建

`/channels/<id>` → Skills tab → Create skill → 选 **🔔 Webhook Skill**：

- **Webhook URL**：粘贴目标 webhook 地址
- **飞书消息格式**：Card（富文本，推荐）或 Plain text
- **触发条件**（可选）：
  - **Tags**：只有包含这些 tag 中的 **任意一个** 才触发
  - **Authors**：只有这些作者写的才触发
  - **留空**：所有 entry 都触发
  - Tags 和 Authors 之间也是 OR（满足任一条件就 fire）

### 消息内容

推出去的消息一定会包含：
- Channel 名和 @handle
- Summary 正文
- 标签
- **查看详情链接**（直接跳到该 entry 的详情页）
- 时间戳

### 一个常见用法：反馈自动进飞书表格

1. 反馈会自动进 `#feedback` 频道（你不用建）
2. 给 `#feedback` 加一个 Webhook Skill，URL 填你的飞书多维表格 webhook
3. 从此每条反馈 → entry 落库 → 自动 POST 到飞书 → 表格自动多一行
4. 你可以在飞书里直接管理（标记已处理、加备注、分配人）

---

## 个人通知 webhook — 被 @ 时通知到飞书

前面的 webhook skill 是"整个 channel 的通知"，这个是"**只通知你自己**"。

当有人在你的 entry 下评论、或在评论里 @ 了你，Router 会 POST 一条消息到你配的个人 webhook。

### 怎么配

**Settings 页 → "个人通知 Webhook" → 填 URL → Save**。

### 用飞书接收的推荐做法

Lark 没有真正的"个人 webhook"，但可以用一个简单技巧做到同样效果：

1. 在飞书里**新建一个群，只拉你自己一个人**
2. 群设置 → 群机器人 → 添加机器人 → 自定义机器人 → 复制 webhook URL
3. 粘到 Router 的个人通知 webhook 设置里

这样之后别人 @ 你时，消息会发到这个只有你一个人的群，移动端会正常震动弹窗——体验上就是个人 DM。

### 支持哪些平台

后端会自动识别飞书 webhook 地址并发标准飞书 text 消息；其他 URL 会 POST 通用 JSON：

```json
{
  "type": "mention",
  "fromHandle": "alex",
  "recipient": "你",
  "preview": "评论前 80 字"
}
```

所以 Slack bot / Telegram bot / 邮件转 webhook / 任意 HTTP 接口都能接。

### 哪些操作不会走 webhook

- 浏览器打开/关闭 Router 页面 — 不影响
- 你自己 @ 自己、自己评论自己的 entry — 不会触发
- Entry 还在 15 分钟暂存期 — 暂不触发（等发布后或手动发布时才触发）

---

## 反馈入口

Dashboard 右下角除了搜索按钮，还有一个 **💬 反馈按钮**，点开后：

- 选分类：🐛 Bug / 💡 Idea / 🎨 UX / 💬 Other
- 写正文
- Cmd+Enter 提交

反馈会以 entry 的形式进入团队的 `#feedback` channel，和普通 entry 一样可以评论、标签、分享链接。想让反馈自动进飞书表格？给 `#feedback` 加一个 Webhook Skill 就行（见上一节）。

---

## 常见问题

### Q：Claude 说"要同步到 Router 吗"，我没回答就跳过了，怎么办？

再说一句 "同步" 即可，Claude 立即补上。

### Q：我不小心同步了不该同步的东西

15 分钟内进 Dashboard，找到那条 entry，点删除按钮。发布后的 entry 也能删除，只是队友可能已经看到了。

### Q：为什么我 Claude 里看不到新加的 Channel Skill？

Channel Skill 是**服务端每次 `router_write` 时现查数据库**的，不需要重连 Claude。修改立即生效。

### Q：为什么我 Claude 里看不到新的 Tool Skill？

Tool Skill 在 v1 是关闭状态，没有 UI 入口。

### Q：什么时候需要重连 MCP？

几乎不需要。只有**我们升级 Router 协议**（加新工具 / 改工具参数）时才需要一次性重连，大约几周一次。日常的 skill 增删改都不需要。

### Q：同步的 entry 会自动带上项目信息吗？

如果你在 Claude Code 的某个项目目录下（有 `.git/` 或 `CLAUDE.md`），Claude 会自动在 summary 前加 `[project: <repo> @ <branch>]`。

### Q：可以手动发布吗？

可以。Dashboard 上每条暂存中的 entry 旁边有 "Publish now" 按钮，点了立即发布，同样会触发所有 webhook skill。

### Q：我的 secret key 丢了怎么办？

没有找回机制 —— 这是设计决定（无密码、无邮箱强绑定）。建议首次注册时就把 key 存到密码管理器或 Lark 收藏里。丢了只能重新注册一个账号，加入团队需要 admin 重新邀请你。

---

## 下一步

- 登录后花 5 分钟浏览 `/channels`，订阅感兴趣的 channel
- 进 Settings 配一下 [个人通知 webhook](#个人通知-webhook--被--时通知到飞书)，别人 @ 你时就能立即看到
- 找一个你参与的项目 channel，给它写一份 [Channel Skill](#channel-skill--让-claude-懂你的频道)，让 Claude 按你的项目语境整理内容
- 把想改进的东西通过[反馈入口](#反馈入口)告诉我们
