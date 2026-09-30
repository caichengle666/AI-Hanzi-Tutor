// Cloudflare Worker 入口：
// 1. /api/llm —— OpenAI 兼容接口的同源代理（解决第三方中转站不开放浏览器 CORS 的问题）
// 2. 其他请求 —— 交给静态资源（SPA，index.html 兜底）

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

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/api/llm' || url.pathname.startsWith('/api/llm/')) {
            return handleLlmProxy(request);
        }
        return env.ASSETS.fetch(request);
    },
};
