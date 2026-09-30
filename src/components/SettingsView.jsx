import { useEffect, useState } from 'react';
import { playAudio } from '../lib/audio.js';
import { useSpeechVoices } from '../hooks/useSpeechVoices.js';
import { loadReminder, saveReminder } from '../lib/reminder.js';
import { getVoiceDownloadGuide, supportsSpeechSynthesis } from '../lib/deviceVoiceGuide.js';
import { setVisionSupport } from '../lib/aiCapabilities.js';
import { callLLM as requestLLM, listModels } from '../lib/llm.js';

const DEFAULT_MODELS = ['gemini-3-flash-preview', 'gemini-3-pro-preview', 'gemini-2.0-flash-exp', 'gpt-4o-mini', 'gpt-4o', 'deepseek-chat'];

function VoiceDownloadGuide({ language, hasVoices }) {
    const guide = getVoiceDownloadGuide();
    const noVoiceSupport = !supportsSpeechSynthesis();
    const title = noVoiceSupport
        ? '当前浏览器不支持系统朗读'
        : hasVoices
            ? `想添加更多${language}声音？`
            : `还没有找到${language}声音`;

    return (
        <details open={!hasVoices || noVoiceSupport} className="mt-3 rounded-lg bg-white/70 border border-slate-100 p-3 text-xs text-slate-500">
            <summary className="cursor-pointer font-bold text-slate-600">{title}</summary>
            <div className="mt-2 leading-relaxed">
                <div>当前识别为：{guide.deviceName}</div>
                {noVoiceSupport ? (
                    <div className="mt-1">请使用 Safari、Chrome、Edge 等现代浏览器打开本应用。</div>
                ) : (
                    <ol className="list-decimal pl-4 mt-1 space-y-1">
                        {guide.steps.map(step => <li key={step}>{step}</li>)}
                    </ol>
                )}
            </div>
        </details>
    );
}

export default function SettingsView({
    provider, setProvider, baseUrl, setBaseUrl, apiKey, setApiKey, model, setModel,
    voiceURI, setVoiceURI, englishVoiceURI, setEnglishVoiceURI,
    profiles, activeProfileId, setActiveProfileId, addProfile, renameProfile, deleteProfile,
    exportActiveChildData, importActiveChildData, onBack
}) {
    const [p, setP] = useState(provider);
    const [url, setUrl] = useState(baseUrl);
    const [k, setK] = useState(apiKey);
    const [m, setM] = useState(model);
    const [vURI, setVURI] = useState(voiceURI);
    const [enURI, setEnURI] = useState(englishVoiceURI);
    const [isCustom, setIsCustom] = useState(false);
    const [customModel, setCustomModel] = useState('');
    const [aiTestStatus, setAiTestStatus] = useState({ text: '', vision: '' });
    const [fetchedModels, setFetchedModels] = useState([]);
    const [modelFetchStatus, setModelFetchStatus] = useState('');
    const [reminder, setReminder] = useState(() => loadReminder(activeProfileId));
    const voiceList = useSpeechVoices('zh');
    const englishVoiceList = useSpeechVoices('en');

    useEffect(() => {
        if (DEFAULT_MODELS.includes(model)) { setIsCustom(false); }
        else { setIsCustom(true); setCustomModel(model); setM('custom'); }
    }, []);

    useEffect(() => {
        setReminder(loadReminder(activeProfileId));
    }, [activeProfileId]);

    const handleProviderChange = (nextProvider) => {
        setP(nextProvider);
        if (nextProvider === 'gemini' && m !== 'custom' && !m.startsWith('gemini-')) {
            setM('gemini-3-flash-preview');
            setIsCustom(false);
        }
        if (nextProvider === 'openai' && m !== 'custom' && m.startsWith('gemini-')) {
            setM('gpt-4o-mini');
            setIsCustom(false);
        }
    };

    const testAi = async (kind) => {
        const finalModel = isCustom ? customModel.trim() : m;
        const finalUrl = url.trim() || 'https://api.openai.com/v1/chat/completions';
        if (!k.trim() || !finalModel) {
            setAiTestStatus(prev => ({ ...prev, [kind]: '请先填写 API Key 和模型名称' }));
            return;
        }
        const config = { provider: p, baseUrl: finalUrl, model: finalModel };
        // 注意：测试只用表单里的 config 发请求，不写回 localStorage。
        // 图片能力标记按 config 单独 key 存储（见 aiCapabilities），保存时写入的
        // provider/base_url/model 与此处一致，业务侧 getActiveVisionSupport()
        // 自然能读到；提前写回会导致“测了没保存、刷新后配置错乱”。
        setAiTestStatus(prev => ({ ...prev, [kind]: kind === 'vision' ? '正在测试图片能力...' : '正在测试文字能力...' }));
        const parts = kind === 'vision'
            ? [
                { text: '请回答图片是否可读取。只回答：可以。' },
                { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } }
            ]
            : [{ text: '请只回答：连接正常。' }];
        const result = await requestLLM({ provider: p, baseUrl: finalUrl, apiKey: k.trim(), model: finalModel, payload: { contents: [{ parts }] } });
        if (result.error) {
            const message = `测试失败：${result.error}`;
            setAiTestStatus(prev => ({ ...prev, [kind]: message }));
            if (kind === 'vision' && /image|vision|multimodal|图片|图像|不支持|unsupported/i.test(result.error)) {
                setVisionSupport(config, 'unsupported');
            }
            return;
        }
        if (kind === 'vision') setVisionSupport(config, 'supported');
        setAiTestStatus(prev => ({ ...prev, [kind]: '测试通过' }));
    };

    const fetchModels = async () => {
        if (!k.trim()) {
            setModelFetchStatus('请先填写 API Key');
            return;
        }
        setModelFetchStatus('正在拉取模型列表...');
        const result = await listModels({ provider: p, baseUrl: url.trim(), apiKey: k.trim() });
        if (result.error) {
            setModelFetchStatus(`拉取失败：${result.error}`);
            return;
        }
        setFetchedModels(result.models);
        setModelFetchStatus(`已找到 ${result.models.length} 个模型`);
    };

    const save = () => {
        const finalModel = isCustom ? customModel.trim() : m;
        if (!finalModel) { alert("模型名称不能为空"); return; }
        const finalUrl = url.trim() || 'https://api.openai.com/v1/chat/completions';
        setProvider(p); setBaseUrl(finalUrl); setApiKey(k); setModel(finalModel);
        setVoiceURI(vURI); setEnglishVoiceURI(enURI);
        saveReminder(activeProfileId, reminder);
        localStorage.setItem('llm_provider', p);
        localStorage.setItem('llm_base_url', finalUrl);
        localStorage.setItem('llm_api_key', k);
        localStorage.setItem('llm_model', finalModel);
        alert("保存成功"); onBack();
    };

    return (
        <div className="p-6 h-full bg-white animate-in slide-in-from-right overflow-y-auto">
            <h2 className="text-xl font-bold mb-6 text-slate-700">系统设置</h2>
            <div className="space-y-6">
                <div>
                    <label className="text-sm font-bold text-slate-600 mb-2 block">孩子档案</label>
                    <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 space-y-3">
                        <select value={activeProfileId} onChange={e => setActiveProfileId(e.target.value)} className="w-full p-3 bg-white border rounded-xl focus:border-orange-500 outline-none text-slate-700 font-medium shadow-sm">
                            {profiles.map(profile => (
                                <option key={profile.id} value={profile.id}>{profile.name}</option>
                            ))}
                        </select>
                        <div className="grid grid-cols-3 gap-2">
                            <button onClick={() => {
                                const name = prompt('新孩子名字：');
                                if (name) addProfile(name);
                            }} className="py-2 bg-orange-500 text-white rounded-xl text-sm font-bold">新增</button>
                            <button onClick={() => {
                                const current = profiles.find(profile => profile.id === activeProfileId);
                                const name = prompt('修改名字：', current?.name || '');
                                if (name) renameProfile(activeProfileId, name);
                            }} className="py-2 bg-white border border-orange-100 text-orange-500 rounded-xl text-sm font-bold">改名</button>
                            <button onClick={() => deleteProfile(activeProfileId)} className="py-2 bg-white border border-red-100 text-red-500 rounded-xl text-sm font-bold">删除</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={exportActiveChildData} className="py-2 bg-white border border-green-100 text-green-600 rounded-xl text-sm font-bold">完整学习备份</button>
                            <label className="py-2 bg-white border border-blue-100 text-blue-600 rounded-xl text-sm font-bold text-center cursor-pointer">
                                导入完整备份
                                <input type="file" className="hidden" accept=".json,application/json" onChange={async (e) => {
                                    await importActiveChildData(e.target.files?.[0]);
                                    e.target.value = '';
                                }} />
                            </label>
                        </div>
                    </div>
                </div>

                <div>
                    <label className="text-sm font-bold text-slate-600 mb-2 block">学习提醒</label>
                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 space-y-3">
                        <label className="flex items-center gap-2 text-sm text-slate-600 font-bold">
                            <input type="checkbox" checked={reminder.enabled} onChange={e => setReminder(prev => ({ ...prev, enabled: e.target.checked }))} />
                            打开应用时提醒学习
                        </label>
                        <input type="time" value={reminder.time} onChange={e => setReminder(prev => ({ ...prev, time: e.target.value }))} className="w-full p-3 bg-white border rounded-xl focus:border-blue-500 outline-none" />
                        <input value={reminder.message} onChange={e => setReminder(prev => ({ ...prev, message: e.target.value }))} className="w-full p-3 bg-white border rounded-xl focus:border-blue-500 outline-none text-sm" placeholder="提醒内容" />
                    </div>
                </div>

                <div>
                    <label className="text-sm font-bold text-slate-600 mb-2 block">AI 接口</label>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => handleProviderChange('gemini')} className={`py-3 rounded-xl font-bold ${p === 'gemini' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500'}`}>Gemini</button>
                            <button onClick={() => handleProviderChange('openai')} className={`py-3 rounded-xl font-bold ${p === 'openai' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500'}`}>OpenAI 兼容</button>
                        </div>
                        {p === 'openai' && (
                            <input value={url} onChange={e => setUrl(e.target.value)} className="w-full p-3 bg-white border rounded-xl focus:border-orange-500 outline-none text-sm" placeholder="https://api.openai.com/v1/chat/completions" />
                        )}
                        <input value={k} onChange={e => setK(e.target.value)} className="w-full p-3 bg-white border rounded-xl focus:border-orange-500 outline-none text-sm" placeholder="API Key" />
                        <select value={m} onChange={e => {
                            if (e.target.value === 'custom') { setIsCustom(true); setM('custom'); }
                            else { setIsCustom(false); setM(e.target.value); }
                        }} className="w-full p-3 bg-white border rounded-xl focus:border-orange-500 outline-none text-sm">
                            {p === 'gemini' ? (
                                <>
                                    <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
                                    <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
                                    <option value="gemini-2.0-flash-exp">gemini-2.0-flash-exp</option>
                                </>
                            ) : (
                                <>
                                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                                    <option value="gpt-4o">gpt-4o</option>
                                    <option value="deepseek-chat">deepseek-chat</option>
                                </>
                            )}
                            {fetchedModels.filter(modelId => !DEFAULT_MODELS.includes(modelId)).map(modelId => (
                                <option key={modelId} value={modelId}>{modelId}</option>
                            ))}
                            <option value="custom">自定义模型</option>
                        </select>
                        {isCustom && (
                            <input value={customModel} onChange={e => setCustomModel(e.target.value)} className="w-full p-3 bg-white border rounded-xl focus:border-orange-500 outline-none text-sm" placeholder="自定义模型名" />
                        )}
                        <div className="flex items-center gap-3">
                            <button onClick={fetchModels} className="shrink-0 py-2 px-3 rounded-lg bg-slate-100 text-slate-600 text-sm font-bold">拉取模型</button>
                            {modelFetchStatus && <div className={`text-xs ${modelFetchStatus.startsWith('拉取失败') ? 'text-red-500' : 'text-slate-500'}`}>{modelFetchStatus}</div>}
                        </div>
                        <div className="bg-slate-50 rounded-xl border border-slate-100 p-3 space-y-2">
                            <div className="text-sm font-bold text-slate-600">接口能力测试</div>
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => testAi('text')} className="py-2 rounded-lg bg-white border text-slate-600 text-sm font-bold">测试文字</button>
                                <button onClick={() => testAi('vision')} className="py-2 rounded-lg bg-indigo-500 text-white text-sm font-bold">测试图片</button>
                            </div>
                            {aiTestStatus.text && <div className={`text-xs ${aiTestStatus.text === '测试通过' ? 'text-green-600' : 'text-slate-500'}`}>文字：{aiTestStatus.text}</div>}
                            {aiTestStatus.vision && <div className={`text-xs ${aiTestStatus.vision === '测试通过' ? 'text-green-600' : 'text-slate-500'}`}>图片：{aiTestStatus.vision}</div>}
                            <div className="text-xs text-slate-400">通过图片测试后，拍照录题和拍照批改才适合交给孩子使用。</div>
                        </div>
                    </div>
                </div>

                <div>
                    <label className="text-sm font-bold text-slate-600 mb-2 block">中文语音</label>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <select value={vURI} onChange={e => { setVURI(e.target.value); playAudio("语音已切换", e.target.value); }} className="w-full p-3 bg-white border rounded-xl focus:border-orange-500 outline-none mb-3 text-slate-700 font-medium shadow-sm">
                            <option value="auto">自动选择中文语音</option>
                            {voiceList.map((v, i) => (
                                <option key={i} value={v.voiceURI}>{v.name} {v.localService ? '[本地]' : ''}</option>
                            ))}
                        </select>
                        <div className="text-xs text-slate-400">
                            {vURI === 'auto'
                                ? "当前模式：自动优先使用 Siri、Ting-Ting 或 Google 高质量中文语音。"
                                : "当前模式：已锁定为你选择的中文语音。"}
                        </div>
                        <VoiceDownloadGuide language="中文" hasVoices={voiceList.length > 0} />
                    </div>
                </div>

                <div>
                    <label className="text-sm font-bold text-slate-600 mb-2 block">英文语音</label>
                    <div className="bg-sky-50 p-4 rounded-xl border border-sky-100">
                        <select value={enURI} onChange={e => { setEnURI(e.target.value); playAudio("English voice ready", e.target.value, 0, 'en'); }} className="w-full p-3 bg-white border rounded-xl focus:border-sky-500 outline-none mb-3 text-slate-700 font-medium shadow-sm">
                            <option value="auto">自动选择英文语音</option>
                            {englishVoiceList.map((v, i) => (
                                <option key={i} value={v.voiceURI}>{v.name} {v.localService ? '[本地]' : ''}</option>
                            ))}
                        </select>
                        <div className="text-xs text-slate-400">
                            {enURI === 'auto'
                                ? "当前模式：英文听写和对话会自动选英文语音，不和中文抢同一个声音。"
                                : "当前模式：英文内容会固定使用你选的英文语音。"}
                        </div>
                        <VoiceDownloadGuide language="英文" hasVoices={englishVoiceList.length > 0} />
                    </div>
                </div>

                <div className="flex gap-3 pt-2">
                    <button onClick={onBack} className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-500 font-bold">返回</button>
                    <button onClick={save} className="flex-1 py-3 rounded-xl bg-orange-500 text-white font-bold shadow-lg shadow-orange-200">保存设置</button>
                </div>
            </div>
        </div>
    );
}
