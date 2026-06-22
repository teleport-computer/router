# Lark Phase 0 — 本地起服务

OAuth 流程需要公网回调 URL。本地开发用 ngrok。

## 一次性配置

### 1. 飞书开放平台申请应用

1. 浏览器打开 https://open.feishu.cn/app
2. 「创建企业自建应用」→ 填名称 / 描述 / 图标
3. 应用详情页 → 左侧「凭证与基础信息」记下 **App ID** + **App Secret**

### 2. 配置权限

「权限管理」开启（其他 phase 的 scope 一并开了省后续发版）：

- `contact:user.id:readonly` —— Phase 0 必需，绑定核心
- `contact:user.base:readonly` —— Phase 0 必需，姓名 + 头像
- 其他 `im:*` / `calendar:*` / `task:*` / `vc:*` / `minutes:*` —— 后续 phase 用

### 3. 配置回调 URL

「安全设置」→「重定向 URL」加：

```
https://<your-ngrok>.ngrok-free.dev/api/lark/callback
```

ngrok URL 起来后回填（见 §4）。

「版本管理与发布」→ 创建版本 → 提交（自建应用秒批）。

> ⚠️ ngrok 免费版每次重启 URL 会变。每次变都要回飞书 console 改回调 + 重新发版 + 改 `server/.env`。

### 4. 起 ngrok

```bash
brew install ngrok
ngrok config add-authtoken <your-token>   # 一次性，从 https://dashboard.ngrok.com/get-started/your-authtoken 拿
ngrok http 3000   # ⚠️ 必须是 3000 (Next.js)，不是 3001 (server)
```

记下 ngrok 给的 https URL，回 §3 填进飞书 console + 重新发版。

### 5. 配置 `server/.env`

末尾追加：

```
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
LARK_DOMAIN=https://open.feishu.cn
LARK_REDIRECT_URI=https://<your-ngrok>.ngrok-free.dev/api/lark/callback
LARK_STATE_SECRET=<openssl rand -hex 32 生成>
```

`LARK_STATE_SECRET` 是 HMAC 签名密钥（防 CSRF），跟飞书无关，本地随机生成即可。

## 起服务

```bash
# 终端 1 — server (:3001)
cd server && npm run dev

# 终端 2 — Next.js (:3000)，/api/* 经 next.config.ts rewrite 转 :3001
cd web && pnpm dev

# 终端 3 — ngrok 隧道转 :3000 (Next.js)
ngrok http 3000
```

Postgres：`server/.env` 已有 `DATABASE_URL`，确认 docker postgres 跑着：

```bash
docker ps | grep postgres
docker exec -i teamwork-pg psql -U postgres -d teamwork < server/src/schema.sql  # 应用 schema (幂等)
```

## 验证

打开 `https://<your-ngrok>.ngrok-free.dev/`：

1. 用 secret_key 登录（`/register` 拿一个，或导入已有）
2. 进 `/settings/lark` → 看到「未绑定 → [连接飞书账号]」
3. 点「连接飞书账号」→ 飞书授权页 → 「同意」→ 跳回 `/settings/lark?status=success` → ✅ 已绑定

完整 9 组验收测试见 [spec §10.3](superpowers/specs/2026-04-27-lark-phase-0-account-binding-design.md#103-本地测试方法验收清单)。

## 常见问题

| 症状 | 修法 |
|---|---|
| `redirect_uri_mismatch` | 飞书 console 没加 ngrok URL，或 ngrok 重启 URL 变了忘了改 + 重新发版 |
| callback 后 ngrok 显示 404 | 确认 `ngrok http 3000` 不是 3001；并且 `web/next.config.ts` 有 `/api/*` rewrite |
| `/api/*` 502 | server 没起 / `NEXT_PUBLIC_API_URL` 跟 server 端口对不上 |
| `invalid_state` | state 5 分钟过期 / 重启 server 后 nonce set 清空 / `LARK_STATE_SECRET` 改过 |
| 飞书提示「应用未发版」 | §3 没发版，或修改 scope 后忘了重新发版 |

## 相关文档

- [Lark Phase 0 spec](superpowers/specs/2026-04-27-lark-phase-0-account-binding-design.md)
- [Lark CLI 本地接入指南](lark-cli-setup.md) — 仅用作个人探索飞书 API；跟服务端 OAuth 是不同身份，不冲突
