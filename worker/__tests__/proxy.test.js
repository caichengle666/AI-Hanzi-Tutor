import { describe, expect, it } from 'vitest';
import { isProxyTargetAllowed } from '../index.js';

describe('isProxyTargetAllowed 代理目标白名单', () => {
    it('放行 OpenAI 兼容的两个接口', () => {
        expect(isProxyTargetAllowed('https://oc2.021800.xyz/v1/chat/completions')).toBe(true);
        expect(isProxyTargetAllowed('https://oc2.021800.xyz/v1/models')).toBe(true);
        expect(isProxyTargetAllowed('https://api.openai.com/v1/chat/completions/')).toBe(true);
        expect(isProxyTargetAllowed('http://192.0.2.1:8080/v1/models')).toBe(true);
    });
    it('拦截非接口路径', () => {
        expect(isProxyTargetAllowed('https://oc2.021800.xyz/')).toBe(false);
        expect(isProxyTargetAllowed('https://oc2.021800.xyz/v1')).toBe(false);
        expect(isProxyTargetAllowed('https://example.com/admin')).toBe(false);
        expect(isProxyTargetAllowed('not-a-url')).toBe(false);
        expect(isProxyTargetAllowed('')).toBe(false);
    });
    it('拦截非 http(s) 协议', () => {
        expect(isProxyTargetAllowed('ftp://example.com/v1/models')).toBe(false);
        expect(isProxyTargetAllowed('file:///etc/passwd')).toBe(false);
    });
    it('拦截内网与本地地址（防 SSRF）', () => {
        expect(isProxyTargetAllowed('http://localhost/v1/models')).toBe(false);
        expect(isProxyTargetAllowed('http://127.0.0.1/v1/models')).toBe(false);
        expect(isProxyTargetAllowed('http://10.0.0.5/v1/models')).toBe(false);
        expect(isProxyTargetAllowed('http://192.168.1.1/v1/models')).toBe(false);
        expect(isProxyTargetAllowed('http://172.20.0.1/v1/models')).toBe(false);
        expect(isProxyTargetAllowed('http://169.254.169.254/v1/models')).toBe(false);
    });
});

import worker, { isSameOrigin, isSyncKeyValid, syncRateLimited } from '../index.js';

describe('D1 云同步保护', () => {
    it('同步 key 必须是 64 位十六进制', () => {
        expect(isSyncKeyValid('a'.repeat(64))).toBe(true);
        expect(isSyncKeyValid('abc')).toBe(false);
        expect(isSyncKeyValid('')).toBe(false);
    });
    it('拒绝跨站 Origin', () => {
        expect(isSameOrigin(new Request('https://a.com/api/sync', { headers: { Origin: 'https://evil.com' } }))).toBe(false);
        expect(isSameOrigin(new Request('https://a.com/api/sync', { headers: { Origin: 'https://a.com' } }))).toBe(true);
    });
    it('按 IP 限流', () => {
        for (let i = 0; i < 2; i++) expect(syncRateLimited('ip-t', 1000 + i, 2)).toBe(false);
        expect(syncRateLimited('ip-t', 1005, 2)).toBe(true);
    });
    it('没绑定 D1 时给出明确提示', async () => {
        const res = await worker.fetch(new Request('https://a.com/api/sync'), {});
        expect(res.status).toBe(503);
    });
});
