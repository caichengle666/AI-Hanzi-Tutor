// SSR 冒烟测试：把每个页面组件 renderToString 一遍，
// 只要 render 路径上有引用错误、未定义变量、坏的初始化逻辑就会直接抛出来。
// （useEffect 不参与 SSR，交互逻辑由单测覆盖）
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

function installBrowserStubs() {
    const store = new Map();
    const localStorageStub = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
    };
    Object.defineProperty(globalThis, 'localStorage', { value: localStorageStub, configurable: true });
    if (!globalThis.window) Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
    if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-smoke' }, configurable: true });
}

beforeAll(() => {
    installBrowserStubs();
});

const noop = () => {};
const callLLM = async () => ({ text: '' });

describe('页面组件 SSR 冒烟', () => {
    it('App 首屏可渲染', async () => {
        const { default: App } = await import('../../App.jsx');
        const html = renderToString(React.createElement(App));
        expect(html.length).toBeGreaterThan(100);
    });

    it('学习模式可渲染', async () => {
        const { default: LearnMode } = await import('../../components/LearnMode.jsx');
        const html = renderToString(React.createElement(LearnMode, { callLLM, addStar: noop, profileId: 'smoke', onBack: noop }));
        expect(html.length).toBeGreaterThan(100);
    });

    it('中文听写可渲染', async () => {
        const { default: DictationMode } = await import('../../components/DictationMode.jsx');
        const html = renderToString(React.createElement(DictationMode, { callLLM, addStar: noop, voiceURI: 'auto', profileId: 'smoke', onBack: noop }));
        expect(html.length).toBeGreaterThan(100);
    });

    it('英文听写可渲染', async () => {
        const { default: EnglishDictationMode } = await import('../../components/EnglishDictationMode.jsx');
        const html = renderToString(React.createElement(EnglishDictationMode, { callLLM, addStar: noop, voiceURI: 'auto', profileId: 'smoke', onBack: noop }));
        expect(html.length).toBeGreaterThan(100);
    });

    it('英文对话可渲染', async () => {
        const { default: EnglishConversationMode } = await import('../../components/EnglishConversationMode.jsx');
        const html = renderToString(React.createElement(EnglishConversationMode, { callLLM, addStar: noop, voiceURI: 'auto', profileId: 'smoke', onBack: noop }));
        expect(html.length).toBeGreaterThan(100);
    });

    it('错题本可渲染', async () => {
        const { default: ReviewNotebookView } = await import('../../components/ReviewNotebookView.jsx');
        const html = renderToString(React.createElement(ReviewNotebookView, { callLLM, profile: { id: 'smoke', name: '测试' }, voiceURI: 'auto', onBack: noop }));
        expect(html.length).toBeGreaterThan(100);
    });

    it('设置页可渲染', async () => {
        const { default: SettingsView } = await import('../../components/SettingsView.jsx');
        const html = renderToString(React.createElement(SettingsView, {
            provider: 'openai', setProvider: noop, baseUrl: '', setBaseUrl: noop,
            apiKey: '', setApiKey: noop, model: 'gpt-4o', setModel: noop,
            voiceURI: 'auto', setVoiceURI: noop, englishVoiceURI: 'auto', setEnglishVoiceURI: noop,
            profiles: [], activeProfileId: 'smoke', setActiveProfileId: noop,
            addProfile: noop, renameProfile: noop, deleteProfile: noop,
            exportActiveChildData: noop, importActiveChildData: noop, onBack: noop
        }));
        expect(html.length).toBeGreaterThan(100);
    });

    it('作业页可渲染', async () => {
        const { default: AssignmentsView } = await import('../../components/AssignmentsView.jsx');
        const html = renderToString(React.createElement(AssignmentsView, { profileId: 'smoke', onChanged: noop, onBack: noop }));
        expect(html.length).toBeGreaterThan(100);
    });
});
