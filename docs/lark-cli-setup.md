# Lark CLI 本地接入指南

本地起一个飞书 CLI，验证能不能成功调通飞书 API。**不涉及 router 服务器，不影响生产**。

## 前置条件

- 你企业的飞书管理员（最好是你自己），有"创建自建应用"的权限
- 本地 Node.js ≥ 18
- 一个能浏览器打开的环境（OAuth 用）

## 步骤 1：在飞书开放平台创建企业自建应用

1. 浏览器打开 **<https://open.feishu.cn/app>**（中国版）
   - 国际版用户：<https://open.larksuite.com/app>
2. 用飞书账号登录（**用你的工作账号，不是个人账号**）
3. 点 **「创建企业自建应用」**
4. 填写：
   - 应用名称：`router-bot`（或你喜欢的）
   - 应用描述：`Router 团队笔记本的飞书集成`
   - 应用图标：随便上传一个
5. 创建完进入应用详情页，**记下两个值**：
   - **App ID**：形如 `cli_a1b2c3d4e5f6g7h8`
   - **App Secret**：形如 `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

   位置：左侧菜单「凭证与基础信息」

> 申请到这两个值前，下面的步骤都跑不通。

## 步骤 2：开启机器人能力

1. 还在该应用详情页，左侧菜单进 **「应用功能」→「机器人」**
2. 点 **「启用」**
3. 这一步让你的应用可以作为机器人收发消息（后续 Phase 1 必需）

## 步骤 3：配置最小权限（scope）

左侧菜单进 **「权限管理」**，开启以下权限（先开最小一组够本地试手）：

| 权限 | 作用 |
|---|---|
| `im:message` | 收发单聊和群消息 |
| `im:message.history:readonly` | 读历史消息（群聊总结要用） |
| `contact:user.base:readonly` | 读用户基础信息 |
| `im:resource` | 上传图片/文件（卡片要用） |

**省事做法**：直接在权限管理里搜 `im:` 把全部即时通讯类权限都开了，反正企业自建应用不审核。

> ⚠️ 改了权限后必须**重新版本发布**，否则不生效。

## 步骤 4：发布应用到企业内

左侧菜单进 **「版本管理与发布」**：

1. 点 **「创建版本」**
2. 版本号：`1.0.0`
3. 可用范围：选「全部成员」（或限定到你自己测试）
4. 提交发布
5. 因为是企业自建应用，**自己企业的管理员审批一下立刻通过**（管理员就是你的话，1 分钟搞定）

> 应用未发布之前，bot 不能被拉进群。

## 步骤 5：本地装 Lark CLI

```bash
npm install -g @larksuite/cli
```

验证安装成功：
```bash
lark-cli --version
```

## 步骤 6：初始化 CLI 配置

```bash
lark-cli config init
```

按提示填：
- App ID：步骤 1 拿到的 `cli_xxx`
- App Secret：步骤 1 拿到的那串
- 域名：选 `feishu.cn`（中国版）或 `larksuite.com`（国际版）

配置文件存在 `~/.lark-cli/config.yaml`（如果将来要看的话）。

## 步骤 7：用户登录（OAuth）

```bash
lark-cli auth login
```

CLI 会打印一个 URL → 复制到浏览器打开 → 飞书账号登录授权 → 回到 CLI 看到 `Login successful`。

> 这一步是把"你"这个用户身份和 CLI 绑定，让你能用 `--as user` 模式调 API。

## 步骤 8：Hello World 验证

试几个简单命令：

```bash
# 查看你今天的日程（最简单的验证，不影响任何人）
lark-cli calendar +agenda

# 查看你的群列表
lark-cli im chat list --as user

# 列出你的部门同事
lark-cli contact +me
```

任何一条返回正常 JSON / 表格 → 接入成功。

## 步骤 9：把 bot 拉进一个测试群

1. 飞书里**新建一个群** `router-bot 测试群`（拉你自己 + 1-2 个同事，或就你一个人）
2. 群设置 → 群机器人 → **添加机器人** → 找到你刚创建的 `router-bot` → 添加
3. 现在群里能看到机器人加入提示

## 步骤 10：用 CLI 给群发条消息（最终验证）

```bash
# 先列出群拿到 chat_id
lark-cli im chat list --as user

# 找到刚才那个测试群的 chat_id（形如 oc_xxxxx），然后：
lark-cli im message send \
  --chat-id <chat_id> \
  --msg-type text \
  --content '{"text":"Hello from router-bot 🎉"}'
```

群里看到机器人发出 "Hello from router-bot 🎉" → **本地接入完成 ✅**

## 调试建议

- 命令报错 `permission denied` → 步骤 3 的权限没开 / 步骤 4 没发版本
- 命令报错 `bot not in chat` → bot 没拉进群（步骤 9）
- OAuth 卡住 → 检查浏览器能不能访问 `open.feishu.cn`，国内通常能直连
- CLI 找不到命令 → `npm root -g` 看一下 npm 全局路径在 PATH 里没有

## 接下来怎么用

接入成功后，可以本地探索这些飞书生态命令（不影响 router 服务器）：

```bash
# 列出所有可用命令
lark-cli --help

# 探索飞书事件订阅（Phase 1 群消息接收要用）
lark-cli event listen --help

# 探索飞书会议纪要（Phase 2 要用）
lark-cli minutes list --help

# 探索飞书日历（Phase 3 要用）
lark-cli calendar create --help
```

把这些命令的输出发给我，我们就能基于真实接口能力做下一步设计。

## 相关文档

- 飞书开放平台：<https://open.feishu.cn/document/home/index>
- Lark CLI GitHub：<https://github.com/larksuite/cli>
- 路线图：[docs/superpowers/specs/2026-04-24-lark-integration-roadmap.md](superpowers/specs/2026-04-24-lark-integration-roadmap.md)
