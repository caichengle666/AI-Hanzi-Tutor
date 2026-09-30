import { useEffect, useState } from 'react';
import { callLLM as requestLLM } from './lib/llm.js';
import Icon from './components/Icon.jsx';
import HomeView from './components/HomeView.jsx';
import SettingsView from './components/SettingsView.jsx';
import LearnMode from './components/LearnMode.jsx';
import DictationMode from './components/DictationMode.jsx';
import ReviewNotebookView from './components/ReviewNotebookView.jsx';
import EnglishDictationMode from './components/EnglishDictationMode.jsx';
import EnglishConversationMode from './components/EnglishConversationMode.jsx';
import AssignmentsView from './components/AssignmentsView.jsx';
import { useLocalStorageState } from './hooks/useLocalStorageState.js';
import { useWakeLock } from './hooks/useWakeLock.js';
import { collectChildData, describeChildBackup, downloadJson, parseChildBackup, restoreChildData } from './lib/childData.js';
import { getChildValue, getChildWorkspaceStatus, hydrateChildWorkspace, retryChildWorkspace, setChildValue } from './lib/childWorkspace.js';
import { loadReminder, notifyStudyReminder, shouldNotify } from './lib/reminder.js';

export default function App() {
    const [mode, setMode] = useState('home');
    const [profiles, setProfiles] = useState(() => {
        const saved = localStorage.getItem('child_profiles');
        if (saved) return JSON.parse(saved);
        return [{ id: 'default', name: '默认孩子' }];
    });
    const [activeProfileId, setActiveProfileId] = useLocalStorageState('active_child_profile', 'default');
    const [stars, setStars] = useState('0');
    const [provider, setProvider] = useLocalStorageState('llm_provider', 'gemini');
    const [baseUrl, setBaseUrl] = useLocalStorageState('llm_base_url', 'https://api.openai.com/v1/chat/completions');
    const [apiKey, setApiKey] = useState(() => localStorage.getItem('llm_api_key') || localStorage.getItem('gemini_key') || '');
    const [model, setModel] = useState(() => localStorage.getItem('llm_model') || localStorage.getItem('gemini_model') || 'gemini-3-flash-preview');
    const [voiceURI, setVoiceURI] = useLocalStorageState('app_voice_uri', 'auto');
    const [englishVoiceURI, setEnglishVoiceURI] = useLocalStorageState('app_english_voice_uri', 'auto');
    const [workspaceReady, setWorkspaceReady] = useState(false);
    const [workspaceError, setWorkspaceError] = useState('');
    const [workspaceVersion, setWorkspaceVersion] = useState(0);
    const [saveStatus, setSaveStatus] = useState({ state: 'idle' });

    useWakeLock(['dictation', 'englishDictation', 'englishConversation'].includes(mode));

    const activeProfile = profiles.find(profile => profile.id === activeProfileId) || profiles[0];
    const profileId = activeProfile?.id || 'default';

    useEffect(() => {
        let active = true;
        setWorkspaceReady(false);
        setWorkspaceError('');
        hydrateChildWorkspace(profileId)
            .then(() => { if (active) setWorkspaceReady(true); })
            .catch(() => { if (active) setWorkspaceError('孩子数据无法读取，请检查浏览器存储权限后重试。'); });
        return () => { active = false; };
    }, [profileId]);

    useEffect(() => {
        localStorage.setItem('child_profiles', JSON.stringify(profiles));
    }, [profiles]);

    useEffect(() => {
        if (!profiles.some(profile => profile.id === activeProfileId)) {
            setActiveProfileId(profiles[0]?.id || 'default');
        }
    }, [activeProfileId, profiles, setActiveProfileId]);

    useEffect(() => {
        if (workspaceReady) setStars(getChildValue(profileId, 'stars', '0'));
    }, [profileId, workspaceReady]);

    useEffect(() => {
        if (!workspaceReady) return undefined;
        const updateStatus = () => setSaveStatus(getChildWorkspaceStatus(profileId));
        updateStatus();
        const timer = window.setInterval(updateStatus, 1000);
        return () => window.clearInterval(timer);
    }, [profileId, workspaceReady]);

    useEffect(() => {
        if (workspaceReady) setChildValue(profileId, 'stars', stars);
    }, [profileId, stars, workspaceReady]);

    useEffect(() => localStorage.setItem('llm_api_key', apiKey), [apiKey]);
    useEffect(() => localStorage.setItem('llm_model', model), [model]);

    useEffect(() => {
        if (!workspaceReady) return;
        const reminder = loadReminder(profileId);
        if (shouldNotify(reminder)) {
            notifyStudyReminder(profileId, activeProfile?.name, reminder);
        }
    }, [activeProfile?.name, profileId, workspaceReady]);

    const addStar = () => setStars(s => String(parseInt(s || '0') + 1));
    const retrySave = async () => {
        await retryChildWorkspace(profileId);
        setSaveStatus(getChildWorkspaceStatus(profileId));
    };
    // useLocalStorageState 存取的是字符串，布尔开关统一按字符串 'true' 解析
    const [viaProxyRaw, setViaProxyRaw] = useLocalStorageState('llm_via_proxy', 'true');
    const viaProxy = viaProxyRaw === true || viaProxyRaw === 'true';
    const setViaProxy = (v) => setViaProxyRaw(v ? 'true' : 'false');
    const callLLM = (payload) => requestLLM({ provider, baseUrl, apiKey, model, payload, viaProxy });
    const addProfile = (name) => {
        const trimmedName = name.trim();
        if (!trimmedName) return;
        const profile = { id: `child_${Date.now()}`, name: trimmedName };
        setProfiles(prev => [...prev, profile]);
        setActiveProfileId(profile.id);
    };
    const renameProfile = (profileIdToRename, name) => {
        const trimmedName = name.trim();
        if (!trimmedName) return;
        setProfiles(prev => prev.map(profile => profile.id === profileIdToRename ? { ...profile, name: trimmedName } : profile));
    };
    const deleteProfile = (profileIdToDelete) => {
        if (profiles.length <= 1) {
            alert('至少保留一个孩子档案');
            return;
        }
        if (!confirm('删除这个孩子档案？对应的星星、词库、错题和听写历史也会保留在本机，但不会再显示。')) return;
        const nextProfiles = profiles.filter(profile => profile.id !== profileIdToDelete);
        setProfiles(nextProfiles);
        if (activeProfileId === profileIdToDelete) setActiveProfileId(nextProfiles[0].id);
    };
    const exportActiveChildData = () => {
        const backup = collectChildData(activeProfile);
        downloadJson(`ai-hanzi-${activeProfile.name}-${profileId}.json`, backup);
    };
    const importActiveChildData = async (file) => {
        if (!file) return;
        const text = await file.text();
        const parsed = parseChildBackup(text);
        if (!parsed.ok) {
            alert(parsed.error);
            return;
        }
        const backup = parsed.backup;
        const preview = describeChildBackup(backup);
        const confirmed = confirm([
            `准备恢复到：${activeProfile.name}`,
            `备份孩子：${preview.childName}`,
            `导出时间：${preview.exportedAt}`,
            `识字卡：${preview.hanziCards} 张，中文词：${preview.chineseWords} 个，英文项：${preview.englishItems} 个，错题：${preview.mistakes} 条`,
            '',
            '继续将替换当前孩子的全部学习数据，且不可撤销。'
        ].join('\n'));
        if (!confirmed) return;
        try {
            await restoreChildData(profileId, backup);
            setStars(getChildValue(profileId, 'stars', '0'));
            alert(`已恢复 ${activeProfile.name} 的数据`);
        } catch (error) {
            alert(error.message || '恢复失败，请检查备份文件。');
        }
    };

    return (
        <div className="min-h-screen flex flex-col w-full md:max-w-5xl mx-auto bg-orange-50 shadow-2xl relative overflow-hidden transition-all duration-300">
            <header className="bg-white/90 backdrop-blur p-4 md:px-8 shadow-sm flex justify-between items-center z-50 sticky top-0">
                <div className="flex items-center gap-3 cursor-pointer active:scale-95 transition-transform" onClick={() => setMode('home')}>
                    <div className="bg-orange-500 p-2 rounded-xl text-white shadow-orange-200 shadow-md"><Icon name="home" size={24} /></div>
                    <span className="font-bold text-slate-700 text-lg md:text-xl tracking-tight">AI全能识字</span>
                </div>
                <div className="flex items-center gap-4">
                    {saveStatus.state === 'error' && <button onClick={retrySave} className="text-xs font-bold text-red-500 bg-red-50 border border-red-100 px-2 py-1 rounded-lg">保存失败，重试</button>}
                    <div className="bg-yellow-100 text-yellow-700 px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-1.5 shadow-sm border border-yellow-200">
                        <Icon name="star" size={16} className="fill-yellow-500 text-yellow-500"/> <span className="pt-0.5">{parseInt(stars || '0')}</span>
                    </div>
                    <button onClick={() => setMode('settings')} className="text-slate-400 hover:text-orange-500 p-2 hover:bg-orange-50 rounded-full transition-all"><Icon name="settings" size={24} /></button>
                </div>
            </header>
            <div className="flex-1 overflow-hidden relative flex flex-col">
                {mode === 'home' && <HomeView key={`${profileId}-${workspaceVersion}`} setMode={setMode} profiles={profiles} activeProfileId={profileId} setActiveProfileId={setActiveProfileId} />}
                {!workspaceReady && mode !== 'home' && <div className="flex-1 flex items-center justify-center text-slate-400 font-bold">正在加载孩子的数据...</div>}
                {workspaceError && <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500 font-bold p-6 text-center"><div>{workspaceError}</div><button onClick={() => window.location.reload()} className="px-4 py-2 bg-orange-500 text-white rounded-xl">重新加载</button></div>}
                {workspaceReady && mode === 'settings' && <SettingsView provider={provider} setProvider={setProvider} baseUrl={baseUrl} setBaseUrl={setBaseUrl} apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} viaProxy={viaProxy} setViaProxy={setViaProxy} voiceURI={voiceURI} setVoiceURI={setVoiceURI} englishVoiceURI={englishVoiceURI} setEnglishVoiceURI={setEnglishVoiceURI} profiles={profiles} activeProfileId={profileId} setActiveProfileId={setActiveProfileId} addProfile={addProfile} renameProfile={renameProfile} deleteProfile={deleteProfile} exportActiveChildData={exportActiveChildData} importActiveChildData={importActiveChildData} onBack={() => setMode('home')} />}
                {workspaceReady && mode === 'assignments' && <AssignmentsView profileId={profileId} onChanged={() => setWorkspaceVersion(version => version + 1)} onBack={() => setMode('home')} />}
                {workspaceReady && mode === 'learn' && <LearnMode callLLM={callLLM} addStar={addStar} voiceURI={voiceURI} profileId={profileId} onBack={() => setMode('home')} />}
                {workspaceReady && mode === 'dictation' && <DictationMode callLLM={callLLM} addStar={addStar} voiceURI={voiceURI} profileId={profileId} onBack={() => setMode('home')} />}
                {workspaceReady && mode === 'review' && <ReviewNotebookView callLLM={callLLM} profile={activeProfile} voiceURI={voiceURI} onBack={() => setMode('home')} />}
                {workspaceReady && mode === 'englishDictation' && <EnglishDictationMode callLLM={callLLM} addStar={addStar} voiceURI={englishVoiceURI} feedbackVoiceURI={voiceURI} profileId={profileId} onBack={() => setMode('home')} />}
                {workspaceReady && mode === 'englishConversation' && <EnglishConversationMode callLLM={callLLM} addStar={addStar} voiceURI={englishVoiceURI} feedbackVoiceURI={voiceURI} profileId={profileId} onBack={() => setMode('home')} />}
            </div>
        </div>
    );
}
