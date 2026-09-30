import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { playAudio } from '../lib/audio.js';
import { compressImage } from '../lib/image.js';
import { getActiveVisionSupport } from '../lib/aiCapabilities.js';
import { getResultLabel, requestStructuredGrading } from '../lib/grading.js';
import { loadNotebook, resolveDictationMistake, saveNotebook, upsertDictationMistake } from '../lib/reviewNotebook.js';
import { getChildValue, setChildValue } from '../lib/childWorkspace.js';
import { getActiveAssignment, recordAssignmentAttempt } from '../lib/assignments.js';

const DEFAULT_ITEMS = [
    { text: 'apple', meaning: '苹果', type: 'word' },
    { text: 'book', meaning: '书', type: 'word' },
    { text: 'I like apples.', meaning: '我喜欢苹果。', type: 'sentence' }
];

export function parseEnglishItems(text) {
    try {
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : parsed.items;
        if (Array.isArray(list)) {
            return list.map(item => typeof item === 'string' ? { text: item, meaning: '', type: 'word' } : {
                text: String(item.text || item.word || '').trim(),
                meaning: String(item.meaning || '').trim(),
                type: item.type === 'sentence' ? 'sentence' : 'word'
            }).filter(item => item.text);
        }
    } catch {}
    return text.split(/[\n,，;；]+/).map(line => line.trim()).filter(Boolean).map(line => {
        // 只按第一个分隔符切分，释义里的冒号要保留
        const sepIndex = line.search(/[|：:]/);
        const english = sepIndex === -1 ? line : line.slice(0, sepIndex);
        const meaning = sepIndex === -1 ? '' : line.slice(sepIndex + 1);
        return { text: english.trim(), meaning: meaning.trim(), type: english.includes(' ') ? 'sentence' : 'word' };
    });
}

export default function EnglishDictationMode({ callLLM, addStar, voiceURI, feedbackVoiceURI, profileId, onBack }) {
    const assignment = getActiveAssignment(profileId);
    const assignmentItems = assignment?.subject === 'englishDictation' ? parseEnglishItems(assignment.items.join('\n')) : null;
    const [items, setItems] = useState(() => assignmentItems?.length ? assignmentItems : getChildValue(profileId, 'englishDictationItems', DEFAULT_ITEMS));
    const [wrongItems, setWrongItems] = useState(() => getChildValue(profileId, 'englishWrongItems', []));
    const [history, setHistory] = useState(() => getChildValue(profileId, 'englishDictationHistory', []));
    const [idx, setIdx] = useState(0);
    const [feedback, setFeedback] = useState('');
    const [result, setResult] = useState('');
    const [busy, setBusy] = useState(false);
    const [finished, setFinished] = useState(false);
    const [sessionResults, setSessionResults] = useState([]);
    const chineseVoice = feedbackVoiceURI || voiceURI;
    const visionSupport = getActiveVisionSupport();

    const current = items[idx] || items[0] || DEFAULT_ITEMS[0];
    const progressText = useMemo(() => `${Math.min(idx + 1, items.length)}/${items.length || 0}`, [idx, items.length]);

    useEffect(() => setChildValue(profileId, 'englishDictationItems', items), [items, profileId]);
    useEffect(() => setChildValue(profileId, 'englishWrongItems', wrongItems), [profileId, wrongItems]);
    useEffect(() => setChildValue(profileId, 'englishDictationHistory', history), [history, profileId]);

    useEffect(() => {
        const currentAssignment = getActiveAssignment(profileId);
        const currentItems = currentAssignment?.subject === 'englishDictation' ? parseEnglishItems(currentAssignment.items.join('\n')) : null;
        setItems(currentItems?.length ? currentItems : getChildValue(profileId, 'englishDictationItems', DEFAULT_ITEMS));
        setWrongItems(getChildValue(profileId, 'englishWrongItems', []));
        setHistory(getChildValue(profileId, 'englishDictationHistory', []));
        setIdx(0);
        setFeedback('');
        setResult('');
        setFinished(false);
        setSessionResults([]);
    }, [profileId]);

    const speakCurrent = () => {
        if (!current) return;
        playAudio(current.text, voiceURI, 0, 'en');
    };

    const saveWrongToNotebook = (item, grading, childAnswer) => {
        const notebook = loadNotebook(profileId);
        const saved = upsertDictationMistake(notebook, {
            subject: '英语',
            category: item.type === 'sentence' ? '句型' : '单词拼写',
            originalQuestion: `英文听写：${item.meaning ? `${item.meaning} / ` : ''}${item.text}`,
            wrongAnswer: childAnswer,
            correctAnswer: item.text,
            analysis: grading.errorDetails.join('；') || '英文听写没有写对。',
            reviewTip: '先听发音，再看拼写规律，最后遮住重写。',
            sourceKey: `dictation:en:${assignment?.id || 'library'}:${item.text.toLowerCase()}`,
            assignmentId: assignment?.id || '',
            assignmentTitle: assignment?.title || '',
            gradingResult: grading.result,
            gradingEvidence: grading.evidence,
            gradingConfidence: grading.confidence,
            gradingTranscription: grading.transcription,
            gradingErrorDetails: grading.errorDetails,
            tags: ['英文听写']
        });
        if (saved.ok) saveNotebook(profileId, saved.state);
    };

    const recordResult = (item, grading, childAnswer = '拍照批改') => {
        const { result: nextResult, feedback: text } = grading;
        const sourceKey = `dictation:en:${assignment?.id || 'library'}:${item.text.toLowerCase()}`;
        const record = { id: Date.now(), assignmentId: assignment?.id || null, item, answer: childAnswer, result: nextResult, feedback: text, confidence: grading.confidence, evidence: grading.evidence, transcription: grading.transcription, errorDetails: grading.errorDetails, createdAt: new Date().toISOString() };
        setHistory(prev => [record, ...prev].slice(0, 100));
        setSessionResults(prev => [...prev, { text: item.text, result: nextResult }]);
        if (assignment?.id) recordAssignmentAttempt(profileId, assignment.id, { item: item.text, answer: childAnswer, result: nextResult, feedback: text, confidence: grading.confidence, evidence: grading.evidence, type: 'englishDictation' });
        if (nextResult === 'wrong') {
            setWrongItems(prev => prev.some(w => w.text === item.text) ? prev : [item, ...prev].slice(0, 100));
            saveWrongToNotebook(item, grading, childAnswer);
        }
        if (nextResult === 'correct') {
            setWrongItems(prev => prev.filter(w => w.text !== item.text));
            const notebook = loadNotebook(profileId);
            const saved = resolveDictationMistake(notebook, sourceKey, text);
            if (saved.ok) saveNotebook(profileId, saved.state);
            addStar();
        }
    };

    const checkPhoto = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (visionSupport === 'unsupported') {
            setFeedback('当前模型未通过图片能力测试，请在系统设置中更换或测试模型。');
            setResult('uncertain');
            return;
        }
        setBusy(true);
        setFeedback('AI 正在查看英文听写作业...');
        let base64;
        try {
            base64 = await compressImage(file);
        } catch (err) {
            setBusy(false);
            setFeedback(err.message || '图片处理失败，请重试。');
            setResult('uncertain');
            return;
        }
        const prompt = `请批改孩子的英文听写。
目标：${current.text}
中文意思：${current.meaning || '无'}

判断规则：
- 图片中清楚写出目标英文，大小写或标点的小差异不影响，result 为 correct。
- 单词拼错、漏词、多词、句子结构明显错误，result 为 wrong。
- 图片模糊、遮挡、没有写目标英文时，result 为 uncertain。

请只返回 JSON：
{"schemaVersion":1,"result":"correct|wrong|uncertain","confidence":"high|medium|low","transcription":"图片中识别到的孩子书写，无法识别则空","evidence":"判断依据","errorDetails":["具体拼写或句子错误，正确时为空数组"],"feedback":"给小朋友的一句话中文反馈，顺便指出一个拼写记忆点"}`;
        const res = await requestStructuredGrading(callLLM, [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: base64 } }]);
        setBusy(false);
        if (res.error) {
            setFeedback(res.error);
            setResult('uncertain');
            return;
        }
        const parsed = res.grading;
        setResult(parsed.result);
        setFeedback(parsed.feedback);
        recordResult(current, parsed, '拍照批改');
        playAudio(parsed.feedback, chineseVoice);
    };

    const next = () => {
        setFeedback('');
        setResult('');
        if (idx < items.length - 1) setIdx(prev => prev + 1);
        else setFinished(true);
    };

    const restartSession = () => {
        setIdx(0);
        setFeedback('');
        setResult('');
        setFinished(false);
        setSessionResults([]);
    };

    const practiceWrongFromSummary = () => {
        if (!wrongItems.length) {
            alert('还没有英文错词');
            return;
        }
        setItems(wrongItems);
        setIdx(0);
        setFeedback('');
        setResult('');
        setFinished(false);
        setSessionResults([]);
    };

    const editItems = () => {
        const text = prompt('输入英文词/句，一行一个；可写成 apple:苹果', items.map(item => `${item.text}${item.meaning ? `:${item.meaning}` : ''}`).join('\n'));
        if (!text) return;
        const list = parseEnglishItems(text);
        if (!list.length) {
            alert('没有识别到英文内容');
            return;
        }
        setItems(list);
        setIdx(0);
        setFinished(false);
        setSessionResults([]);
    };

    const practiceWrong = () => {
        if (!wrongItems.length) {
            alert('还没有英文错词');
            return;
        }
        setItems(wrongItems);
        setIdx(0);
        setFeedback('');
        setResult('');
        setFinished(false);
        setSessionResults([]);
    };

    // 总结按"题"统计（同一题多次批改只算最后一次）
    const latestByItem = new Map();
    sessionResults.forEach(item => latestByItem.set(item.text, item.result));
    const latestResults = [...latestByItem.values()];
    const correctCount = latestResults.filter(result => result === 'correct').length;
    const wrongCount = latestResults.filter(result => result === 'wrong').length;
    const uncertainCount = latestResults.filter(result => result === 'uncertain').length;

    if (finished) {
        return (
            <div className="h-full bg-slate-50 flex flex-col p-4 overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <button onClick={onBack} className="text-slate-400 font-bold flex items-center gap-1"><Icon name="arrowLeft" size={18}/> 返回</button>
                    <div className="font-bold text-slate-600">英文听写总结</div>
                    <div className="w-10" />
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
                    <div className="text-center">
                        <div className="text-3xl font-bold text-slate-800 mb-2">本轮完成</div>
                        <div className="text-sm text-slate-400">共 {items.length} 题</div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="bg-green-50 rounded-xl p-3"><div className="text-2xl font-bold text-green-600">{correctCount}</div><div className="text-xs text-green-500">正确</div></div>
                        <div className="bg-red-50 rounded-xl p-3"><div className="text-2xl font-bold text-red-500">{wrongCount}</div><div className="text-xs text-red-400">错误</div></div>
                        <div className="bg-yellow-50 rounded-xl p-3"><div className="text-2xl font-bold text-yellow-600">{uncertainCount}</div><div className="text-xs text-yellow-500">待确认</div></div>
                    </div>
                    {wrongItems.length > 0 && (
                        <div>
                            <div className="font-bold text-slate-700 mb-2">错词</div>
                            <div className="flex flex-wrap gap-2">
                                {wrongItems.slice(0, 20).map(item => <span key={item.text} className="px-2 py-1 rounded-full bg-red-50 text-red-500 text-xs">{item.text}</span>)}
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-1 gap-3">
                        <button onClick={practiceWrongFromSummary} className="py-3 rounded-xl bg-orange-500 text-white font-bold">错词再练</button>
                        <button onClick={restartSession} className="py-3 rounded-xl bg-blue-500 text-white font-bold">再听一轮</button>
                        <button onClick={onBack} className="py-3 rounded-xl bg-slate-100 text-slate-500 font-bold">回首页</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full bg-slate-50 flex flex-col p-4 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
                <button onClick={onBack} className="text-slate-400 font-bold flex items-center gap-1"><Icon name="arrowLeft" size={18}/> 返回</button>
                <div className="font-bold text-slate-600">英文听写 {progressText}</div>
                <button onClick={editItems} className="text-blue-500 font-bold text-sm">编辑词库</button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
                <div className="text-center">
                    <div className="text-xs text-slate-400 mb-2">{current.type === 'sentence' ? '短句听写' : '单词听写'} {current.meaning ? `· ${current.meaning}` : ''}</div>
                    <button onClick={speakCurrent} className="w-24 h-24 rounded-full bg-blue-500 text-white text-3xl shadow-lg active:scale-95">▶</button>
                    <div className="text-xs text-slate-400 mt-3">先听英文，在纸上写下答案，再拍照批改</div>
                </div>
                {feedback && (
                    <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600 flex gap-2">
                        {result && <span className={`shrink-0 px-2 py-1 rounded-full text-xs font-bold ${result === 'correct' ? 'bg-green-50 text-green-600' : result === 'wrong' ? 'bg-red-50 text-red-500' : 'bg-yellow-50 text-yellow-600'}`}>{getResultLabel(result)}</span>}
                        <span>{feedback}</span>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                    {visionSupport === 'unsupported' ? (
                        <button onClick={() => setFeedback('当前模型未通过图片能力测试，请在系统设置中更换或测试模型。')} className="py-3 rounded-xl bg-slate-100 text-slate-400 font-bold">图片不可用</button>
                    ) : (
                        <label className={`py-3 rounded-xl bg-blue-500 text-white font-bold text-center cursor-pointer ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
                            {busy ? '批改中' : '拍照批改'}
                            <input type="file" className="hidden" accept="image/*" capture="environment" onChange={checkPhoto} />
                        </label>
                    )}
                    <button onClick={next} disabled={busy} className="py-3 rounded-xl bg-green-500 text-white font-bold disabled:opacity-60">下一个</button>
                    <button onClick={speakCurrent} className="py-3 rounded-xl bg-slate-100 text-slate-500 font-bold">重听</button>
                    <button onClick={practiceWrong} className="py-3 rounded-xl bg-orange-50 text-orange-500 font-bold">错词再练</button>
                </div>
            </div>

            <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-4">
                <div className="font-bold text-slate-700 mb-2">英文错词 {wrongItems.length} 个</div>
                <div className="flex flex-wrap gap-2">
                    {wrongItems.length ? wrongItems.slice(0, 20).map(item => <span key={item.text} className="px-2 py-1 rounded-full bg-red-50 text-red-500 text-xs">{item.text}</span>) : <span className="text-slate-300 text-sm">暂无错词</span>}
                </div>
            </div>
        </div>
    );
}
