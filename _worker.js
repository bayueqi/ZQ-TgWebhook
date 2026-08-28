/**
 * Cloudflare Worker: 通用 Webhook -> Telegram 通知转发器
 *
 * 环境变量(在 Cloudflare 仪表板 -> Settings -> Variables 中配置):
 *   TG_BOT_TOKEN    : Telegram Bot Token(从 @BotFather 获取)
 *   TG_CHAT_ID      : 目标聊天 ID(个人/群组/频道,如 123456789 或 -1001234567890)
 *   WEBHOOK_SECRET  : 鉴权密钥(客户端需通过请求头或参数携带)
 *
 * 调用方式:
 *   POST https://<worker>.workers.dev/
 *   Header: X-Webhook-Secret: <WEBHOOK_SECRET>
 *   Body : 任意 JSON 或表单或纯文本
 *
 *   也支持:
 *     - Authorization: Bearer <WEBHOOK_SECRET>
 *     - 查询参数 ?secret=<WEBHOOK_SECRET>
 *     - 路径 /health 健康检查
 */

const TELEGRAM_API = "https://api.telegram.org";

// ---- CORS: 允许任何域调用,方便管理后台浏览器端"测试通知"按钮不被拦截 ----
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Webhook-Secret, Authorization, Accept, Origin, User-Agent",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    // 处理 CORS 预检(浏览器跨域 POST 前自动发的 OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ---- 基础校验 ----
    if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) {
      return json(500, { ok: false, error: "Missing TG_BOT_TOKEN or TG_CHAT_ID env vars" });
    }

    const url = new URL(request.url);

    // 健康检查
    if (url.pathname === "/health") {
      return json(200, { ok: true, service: "webhook-to-telegram", time: new Date().toISOString() });
    }

    // 仅允许 POST(转发)与 GET(健康)
    if (request.method !== "POST") {
      return json(405, { ok: false, error: "Method not allowed, use POST" });
    }

    // ---- 鉴权 ----
    const secret =
      request.headers.get("X-Webhook-Secret") ||
      (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "") ||
      url.searchParams.get("secret");

    if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
      return json(401, { ok: false, error: "Unauthorized: invalid or missing secret" });
    }

    // ---- 解析请求体 ----
    let payload;
    try {
      const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
      if (contentType.includes("application/json")) {
        payload = await request.json();
      } else if (contentType.includes("form")) {
        const form = await request.formData();
        payload = Object.fromEntries(form.entries());
      } else {
        payload = await request.text();
      }
    } catch (err) {
      payload = null;
    }

    // ---- 组装 Telegram 消息 ----
    const text = formatMessage(payload, request);

    // ---- 调用 Telegram Bot API ----
    const tgResp = await fetch(`${TELEGRAM_API}/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TG_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const tgData = await tgResp.json();
    if (!tgData.ok) {
      return json(502, { ok: false, error: "Telegram API error", detail: tgData });
    }

    return json(200, { ok: true, message_id: tgData.result?.message_id });
  },
};

// ---- 工具函数 ----
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function formatMessage(payload, request) {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const lines = [];
  lines.push("🔔 <b>Webhook 通知</b>");
  lines.push(`🕒 ${escapeHtml(now)}`);
  lines.push(`📡 <b>来源:</b> ${escapeHtml(request.headers.get("CF-Connecting-IP") || "unknown")}`);
  lines.push("");

  if (payload === null || payload === undefined || payload === "") {
    lines.push("<i>(空请求体)</i>");
  } else if (typeof payload === "string") {
    lines.push("📝 <b>内容:</b>");
    lines.push(`<pre>${escapeHtml(truncate(payload, 3500))}</pre>`);
  } else if (typeof payload === "object") {
    lines.push("📦 <b>数据:</b>");
    const pretty = JSON.stringify(payload, null, 2);
    lines.push(`<pre>${escapeHtml(truncate(pretty, 3500))}</pre>`);
  }

  return lines.join("\n");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + "\n...(truncated)" : str;
}
