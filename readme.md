# ZQ-TgWebhook · Webhook → Telegram 通知转发器

部署在 **Cloudflare Workers** 上的通用 webhook 接收器,把任意来源的事件通知自动转发到 Telegram 聊天 / 群 / 频道。零服务器、零成本、全球边缘节点加速。

项目名称:`ZQ-TgWebhook`。

---

## 特性

- ✅ 一键对接任意来源 webhook,支持 JSON / 表单 / 纯文本
- 🔐 三种鉴权方式:`X-Webhook-Secret` 头 / `Authorization: Bearer` / `?secret=` 查询参数
- 🌐 支持 **CORS + OPTIONS 预检**(浏览器端"测试通知"按钮不再被拦截)
- 🔒 敏感信息通过 Cloudflare **Secret** 类型变量管理,代码零硬编码
- 💬 Telegram 消息自动 HTML 格式化,带时间戳与来源 IP
- ✂️ 超长内容自动截断(适配 Telegram 4096 字符上限)
- 🩺 内置 `/health` 健康检查端点
- 🧱 返回标准 HTTP 状态码,方便排障

## 文件结构

```
.
├── _worker.js   # Worker 主程序
└── readme.md    # 本文档
```

---

## 一、准备 Telegram Bot

### 1. 创建机器人
在 Telegram 搜索 **@BotFather**,发送:
```
/newbot
```
按提示设置名称与 username,拿到 **Bot Token**(形如 `1234567890:AAFxxxx...`)。

### 2. 获取 Chat ID
- **个人接收**:先在 Telegram 里给机器人任意发一条消息
- **群 / 频道接收**:把机器人加入群或频道,在群里发一条消息(频道需设机器人为管理员,有发消息权限)

然后在浏览器打开:
```
https://api.telegram.org/bot<你的Token>/getUpdates
```
找到返回 JSON 里的 `result[*].message.chat.id`:
- 个人号为正整数,如 `1234567890`
- **超级群 / 频道以 `-100` 开头**,如 `-1001234567890`
- 没看到结果 → 确认机器人收到过消息,或发一条新消息再刷新

> 提示:群里加了机器人后要先在群里说句话,`getUpdates` 里才会出现这个群的 `chat.id`。

---

## 二、部署到 Cloudflare Workers

### 方式 A:仪表板上传(最简单,推荐)

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. **Workers & Pages** → **Create application** → **Create Worker**
3. Worker 名称填 **ZQ-TgWebhook**(Cloudflare 会自动追加 `.workers.dev` 子域)
4. 进入在线编辑器,把 `_worker.js` 内容粘贴覆盖 → 点 **Deploy**
5. 部署完成后,回到 **Workers & Pages → ZQ-TgWebhook → 绑定**(可选),绑定自定义域名(如 `webhook.yourdomain.com`)

### 方式 B:Wrangler CLI

```bash
npm i -g wrangler
wrangler login
wrangler deploy
```

可选 `wrangler.toml`(使用 CLI 部署才需要):

```toml
name = "ZQ-TgWebhook"
main = "_worker.js"
compatibility_date = "2024-09-01"
```

绑定自定义域名的推荐做法:在 Cloudflare 仪表板里操作,SSL/TLS 模式用「Full」即可。

---

## 三、配置环境变量

进入 Worker 页面 → **设置 → 变量和密钥(Runtime variables and secrets)**,点「+ 添加变量」,按下面表格填:

| 名称 | 值示例 | 类型建议 |
|------|--------|----------|
| `TG_BOT_TOKEN` | `1234567890:AAFxxxx...` | **🔐 密钥(Secret)** |
| `TG_CHAT_ID` | `-1001234567890` | 文本 或 密钥 |
| `WEBHOOK_SECRET` | 建议使用 UUID v4 或 32 位以上随机串 | **🔐 密钥(Secret)** |

生成密钥示例(任选一种):

```bash
# UUID v4
node -e "console.log(crypto.randomUUID())"
# 32 字节十六进制
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> 💡 **为什么要选「密钥」类型**:密钥类型在保存后界面以掩码显示、不随配置导出、不在日志里出现明文,能防止 `TG_BOT_TOKEN` 被别人看到直接接管 Bot。

---

## 四、验证部署

> 以下所有示例中的 **`<YOUR_DOMAIN>`** 替换为你的 Worker 域名(例:`zq-tgwebhook.xxx.workers.dev` 或自定义绑定的 `webhook.yourdomain.com`);**`<YOUR_SECRET>`** 替换为你在环境变量 `WEBHOOK_SECRET` 中设置的值。

### 健康检查

浏览器打开加 `/health`:

```
https://<YOUR_DOMAIN>/health
```

看到下面的响应就是部署成功:
```json
{ "ok": true, "service": "ZQ-TgWebhook", "time": "2026-08-28T11:00:05.469Z" }
```

### 手动发送通知(命令行)

```bash
# Windows PowerShell
irm -Method Post https://<YOUR_DOMAIN>/ `
  -Headers @{"X-Webhook-Secret"="<YOUR_SECRET>";"Content-Type"="application/json"} `
  -Body '{"event":"test","msg":"hello"}'

# curl / Git Bash
curl -X POST https://<YOUR_DOMAIN>/ \
  -H "X-Webhook-Secret: <YOUR_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"event":"test","msg":"hello"}'
```

成功会返回 `{"ok":true,"message_id":x}`,Telegram 群里弹出消息。

---

## 五、支持的三种鉴权方式

任何一种都可以,**按对接平台支持的能力选择最方便的**。

### ① 请求头 `X-Webhook-Secret`(首选,平台支持自定义头就用这个)

```http
POST / HTTP/1.1
Host: <YOUR_DOMAIN>
X-Webhook-Secret: <YOUR_SECRET>
Content-Type: application/json

{"event":"deploy","status":"success"}
```

### ② `Authorization: Bearer`

```http
POST / HTTP/1.1
Host: <YOUR_DOMAIN>
Authorization: Bearer <YOUR_SECRET>
Content-Type: application/json

{"event":"deploy","status":"success"}
```

### ③ 查询参数 `?secret=`(平台不支持自定义头就用这个,最通用)

```
POST https://<YOUR_DOMAIN>/?secret=<YOUR_SECRET>
```

⚠️ 用查询参数时密钥会出现在第三方服务的调用日志 / 访问日志里,适合内部平台;敏感场景用 ① / ②。

---

## 六、常见对接场景(照着填就行)

把下面示例里的 `<YOUR_DOMAIN>` 和 `<YOUR_SECRET>` 换成真实值即可。

### 场景 A:有「自定义请求头(JSON)」字段的后台

例如某面板的 **Webhook 通知配置**:

| 字段 | 填法 |
|------|------|
| Webhook 通知 URL | `https://<YOUR_DOMAIN>/` |
| 请求方法 | `POST` |
| 自定义请求头 | `{"X-Webhook-Secret":"<YOUR_SECRET>","Content-Type":"application/json"}` |
| 消息模板 | 默认就好:`{"title":"{{title}}","content":"{{content}}","timestamp":"{{timestamp}}"}` |

> 🔧 提示:如果你点击后台的「测试通知」按钮出现 `TypeError: Failed to fetch`,那是浏览器 CORS 被拦截 — 请确认使用的是本仓库带 CORS 支持的 `_worker.js` 新版并已重新部署。

### 场景 B:只有「名称 + URL + 签名密钥」的简单后台

例如某平台的 **管理员 Webhook 端点配置**:

| 字段 | 填法 |
|------|------|
| 名称 | `ZQ-TgWebhook`(随便填,自己认得就好) |
| URL | `https://<YOUR_DOMAIN>/?secret=<YOUR_SECRET>` |
| 签名密钥 | **留空不填**(见下方说明) |
| 启用 | ✅ 勾上 |

关于「签名密钥」:这类平台会用密钥算出一个 `X-Flare-Signature`(类似 GitHub 的 `X-Hub-Signature`)请求头,接收方需要用相同密钥再算一遍来验签。当前 Worker 只做等值 Secret 校验,不处理 HMAC 签名,所以放空不影响使用。如果以后需要严格验签,可以在 `_worker.js` 里加一个 HMAC 校验分支。

**如果你碰到的平台强制签名密钥不能为空**,就填和 `WEBHOOK_SECRET` 同一个值,保存后不影响转发逻辑。

### 场景 C:UptimeRobot 等 URL 唯一选项的服务

直接填带 secret 的 URL:
```
https://<YOUR_DOMAIN>/?secret=<YOUR_SECRET>
```

### 场景 D:CI/CD 脚本里用

```bash
curl -X POST https://<YOUR_DOMAIN>/ \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"event\":\"deploy\",\"app\":\"$APP_NAME\",\"status\":\"$DEPLOY_STATUS\",\"commit\":\"$GIT_SHA\"}"
```

---

## 七、错误码速查

| HTTP 状态码 | 含义 | 排查方向 |
|-------------|------|----------|
| 200 `{"ok":true,"message_id":...}` | ✅ 成功,Telegram 已接收 | 正常 |
| 401 `Unauthorized` | Secret 没传或值不对 | 确认大小写、`?secret=`、头名称拼写、多空格 |
| 405 `Method not allowed` | 用了 GET 访问 / 路径 | 用 POST 或加 `/health` 做健康检查 |
| 500 `Missing TG_BOT_TOKEN ...` | 环境变量没配好 | 回到 Cloudflare 设置→变量,检查是否保存成功、变量名拼写一致 |
| 502 `Telegram API error` | 调 Telegram 失败 | 看 `detail` 字段;常见是 Bot Token 失效 / Chat ID 格式错 / 机器人被禁言或没加进群 |
| 浏览器端 `Failed to fetch` | CORS 被拦 | 确认用的是带 CORS 头的新版 `_worker.js` 并已重新部署;Cloudflare 建议部署后等 10s 再试 |

---

## 八、Telegram 消息样式

发 JSON:
```json
{ "event": "订单通知", "order_id": "#20260828-042", "amount": "¥128.00", "status": "已支付" }
```

Telegram 收到:
```
🔔 Webhook 通知
🕒 2026-08-28 11:00:06 UTC
📡 来源: 1.2.3.4

📦 数据:
{
  "event": "订单通知",
  "order_id": "#20260828-042",
  "amount": "¥128.00",
  "status": "已支付"
}
```

---

## 九、安全建议

- `TG_BOT_TOKEN` 与 `WEBHOOK_SECRET` 一定用 **Secret / 密钥** 类型保存,不要用明文「文本」类型
- 建议每 3~6 个月轮换一次 `WEBHOOK_SECRET`
- 如需严格限制来源,在 Cloudflare 侧叠加 **WAF 规则**(只允许特定 IP 段 / ASN / Region 访问)
- Bot 不要加入无关群;频道里给机器人管理员权限时,只开「发送消息」即可,别给多余权限
- 对接的第三方平台里,优先用请求头传 secret,次选用 URL 参数

---

## 十、可扩展方向

需要以下能力可以在 `_worker.js` 基础上扩展:

- 特定服务格式化模板(GitHub / GitLab / 支付回调 / UptimeRobot 等)
- 多 Chat ID 分发(按事件类型或关键字路由到不同群)
- 消息去重(Cloudflare KV 存近期消息指纹)
- 失败自动重试(Cloudflare Queues)
- HMAC 签名校验(对接 `X-Flare-Signature` / `X-Hub-Signature-256` 类平台)
- 多个 `WEBHOOK_SECRET` 共存,按密钥分租户

---

## 许可证

MIT
