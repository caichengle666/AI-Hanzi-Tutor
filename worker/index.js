// Cloudflare Worker 入口：
// 1. /api/llm  —— OpenAI 兼容接口的同源代理（解决第三方中转站不开放浏览器 CORS 的问题）
// 2. /api/sync —— D1 云同步（孩子档案、生字本、错题本），用家庭同步码区分家庭，见 handleSync
// 3. 其他请求  —— 交给静态资源（SPA，index.html 兜底）

const ALLOWED_PATH_SUFFIXES = ['/chat/completions', '/models'];
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function isPrivateHostname(hostname) {
    const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!h || h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '169.254.169.254') return true;
    if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (/^::ffff:(127\.|10\.|192\.168\.)/.test(h)) return true;
    return false;
}

// 代理目标白名单：只允许 OpenAI 兼容的两个接口路径，防止被当成通用代理滥用。
export function isProxyTargetAllowed(target) {
    let url;
    try {
        url = new URL(String(target || ''));
    } catch {
        return false;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (isPrivateHostname(url.hostname)) return false;
    const path = url.pathname.replace(/\/+$/, '');
    return ALLOWED_PATH_SUFFIXES.some(suffix => path === suffix || path.endsWith(suffix));
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function jsonEnvelope(obj) {
    return new Response(JSON.stringify(obj), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
}

async function handleLlmProxy(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
        return jsonEnvelope({ ok: false, status: 405, error: '仅支持 POST' });
    }
    let payload = null;
    try {
        payload = await request.json();
    } catch {
        return jsonEnvelope({ ok: false, status: 400, error: '请求体不是合法 JSON' });
    }
    const { target, apiKey, method, body } = payload || {};
    if (!target || !isProxyTargetAllowed(target)) {
        return jsonEnvelope({ ok: false, status: 400, error: '不允许的代理目标' });
    }
    if (!apiKey || typeof apiKey !== 'string') {
        return jsonEnvelope({ ok: false, status: 400, error: '缺少 API Key' });
    }
    const upstreamMethod = method === 'GET' ? 'GET' : 'POST';
    const headers = { Authorization: `Bearer ${apiKey}` };
    let upstreamBody;
    if (upstreamMethod === 'POST') {
        headers['Content-Type'] = 'application/json';
        const raw = typeof body === 'string' ? body : JSON.stringify(body ?? {});
        if (raw.length > MAX_BODY_BYTES) {
            return jsonEnvelope({ ok: false, status: 413, error: '请求体过大' });
        }
        upstreamBody = raw;
    }
    let upstream;
    try {
        upstream = await fetch(target, { method: upstreamMethod, headers, body: upstreamBody });
    } catch {
        return jsonEnvelope({ ok: false, status: 502, error: '上游连接失败' });
    }
    const text = await upstream.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch {
        // 上游没返回 JSON，按失败处理
    }
    const upstreamError = data && data.error
        ? (typeof data.error === 'string' ? data.error : data.error.message)
        : null;
    if (!upstream.ok || upstreamError || data === null) {
        return jsonEnvelope({ ok: false, status: upstream.status, error: upstreamError || `上游返回 ${upstream.status}` });
    }
    return jsonEnvelope({ ok: true, status: upstream.status, data });
}


// ---------------- D1 云同步 ----------------
// 设计：零服务端配置。家长在每台设备的设置里填同一个“家庭同步码”，
// 前端把它做 SHA-256 得到 X-Sync-Key 发过来；服务端再 hash 一次作为 family 主键，
// 数据库里不保存可直接使用的同步码。每个孩子的工作区是一整行 JSON，按 updatedAt 后写者胜。
// 表在第一次请求时自动建好；D1 数据库由 wrangler deploy 按 wrangler.jsonc 的 binding 自动创建。

const SYNC_MAX_BYTES = 1_800_000; // D1 单行上限约 2MB，留余量
const SYNC_RATE_PER_MINUTE = 120;
const PROFILE_ID_RE = /^[A-Za-z0-9_\-]{1,64}$/;
let schemaReady = null;

function syncJson(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isSyncKeyValid(key) {
    return /^[a-f0-9]{64}$/.test(String(key || ''));
}

export function isSameOrigin(request) {
    const origin = request.headers.get('Origin');
    if (!origin) return true;
    try {
        return new URL(origin).host === new URL(request.url).host;
    } catch {
        return false;
    }
}

const syncHits = new Map();
export function syncRateLimited(ip, now = Date.now(), limit = SYNC_RATE_PER_MINUTE) {
    const list = (syncHits.get(ip) || []).filter(t => t > now - 60_000);
    list.push(now);
    syncHits.set(ip, list);
    if (syncHits.size > 5000) syncHits.clear();
    return list.length > limit;
}

function ensureSchema(db) {
    if (!schemaReady) {
        schemaReady = db.prepare(
            'CREATE TABLE IF NOT EXISTS workspaces (family TEXT NOT NULL, profile_id TEXT NOT NULL, updated_at TEXT NOT NULL, device TEXT, data TEXT NOT NULL, PRIMARY KEY (family, profile_id))'
        ).run().catch(error => { schemaReady = null; throw error; });
    }
    return schemaReady;
}

async function handleSync(request, env, url) {
    if (!env.DB) return syncJson({ ok: false, error: '服务器还没有绑定 D1 数据库（重新部署一次即可自动创建）' }, 503);
    if (!isSameOrigin(request)) return syncJson({ ok: false, error: '不允许跨站调用' }, 403);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (syncRateLimited(ip)) return syncJson({ ok: false, error: '同步太频繁，请稍后再试' }, 429);
    const syncKey = request.headers.get('X-Sync-Key');
    if (!isSyncKeyValid(syncKey)) return syncJson({ ok: false, error: '缺少家庭同步码' }, 401);
    const family = await sha256Hex(`family:${syncKey}`);
    await ensureSchema(env.DB);

    const rest = url.pathname.replace(/^\/api\/sync\/?/, '').replace(/\/+$/, '');

    if (request.method === 'GET' && !rest) {
        const { results } = await env.DB
            .prepare('SELECT profile_id, updated_at, data FROM workspaces WHERE family = ?')
            .bind(family)
            .all();
        const items = (results || []).map(row => {
            let data = null;
            try { data = JSON.parse(row.data); } catch { /* 坏数据跳过 */ }
            return { profileId: row.profile_id, updatedAt: row.updated_at, data };
        }).filter(item => item.data !== null);
        return syncJson({ ok: true, items });
    }

    if (request.method === 'PUT' && rest) {
        const profileId = decodeURIComponent(rest);
        if (!PROFILE_ID_RE.test(profileId)) return syncJson({ ok: false, error: '档案 ID 不合法' }, 400);
        const raw = await request.text();
        if (raw.length > SYNC_MAX_BYTES) return syncJson({ ok: false, error: '这个孩子的数据太大，超过云同步上限' }, 413);
        let body;
        try { body = JSON.parse(raw); } catch { return syncJson({ ok: false, error: '请求体不是合法 JSON' }, 400); }
        const updatedAt = String(body?.updatedAt || '');
        if (!updatedAt || Number.isNaN(Date.parse(updatedAt)) || body.data === undefined) {
            return syncJson({ ok: false, error: '缺少 updatedAt 或 data' }, 400);
        }
        const data = JSON.stringify(body.data);
        // 只有比云端新才覆盖（后写者胜），旧数据不会冲掉新数据
        await env.DB.prepare(
            `INSERT INTO workspaces (family, profile_id, updated_at, device, data) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (family, profile_id) DO UPDATE SET updated_at = excluded.updated_at, device = excluded.device, data = excluded.data
             WHERE excluded.updated_at > workspaces.updated_at`
        ).bind(family, profileId, updatedAt, String(body.device || '').slice(0, 64), data).run();
        const row = await env.DB
            .prepare('SELECT updated_at, data FROM workspaces WHERE family = ? AND profile_id = ?')
            .bind(family, profileId)
            .first();
        const applied = row?.updated_at === updatedAt;
        return syncJson({
            ok: true,
            applied,
            updatedAt: row?.updated_at,
            // 云端更新时把云端版本带回去，前端直接采用
            data: applied ? undefined : JSON.parse(row.data)
        });
    }

    return syncJson({ ok: false, error: '接口不存在' }, 404);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/api/llm' || url.pathname.startsWith('/api/llm/')) {
            return handleLlmProxy(request);
        }
        if (url.pathname === '/api/sync' || url.pathname.startsWith('/api/sync/')) {
            try {
                return await handleSync(request, env, url);
            } catch {
                return syncJson({ ok: false, error: '云同步服务出错，请稍后再试' }, 500);
            }
        }
        return env.ASSETS.fetch(request);
    },
};
