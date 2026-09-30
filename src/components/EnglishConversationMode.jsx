import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { playAudio } from '../lib/audio.js';
import { getChildValue, setChildValue } from '../lib/childWorkspace.js';

function parseConversationJson(text) {
    const clean = String(text || '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
        question: String(parsed.question || '').trim(),
        chineseHint: String(parsed.chineseHint || '').trim(),
        sampleAnswer: String(parsed.sampleAnswer || '').trim(),
        level: String(parsed.level || 'easy').trim()
    };
}

function parseReviewJson(text) {
    const clean = String(text || '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const result = ['good', 'try_again', 'uncertain'].includes(parsed.result) ? parsed.result : 'uncertain';
    return {
        result,
        feedback: String(parsed.feedback || '').trim() || '我们再试一次。',
        betterAnswer: String(parsed.betterAnswer || '').trim()
    };
}

export default function EnglishConversationMode({ callLLM, addStar, voiceURI, feedbackVoiceURI, profileId, onBack }) {
    const [question, setQuestion] = useState(null);
    const [answer, setAnswer] = useState('');
    const [feedback, setFeedback] = useState('');
    const [busy, setBusy] = useState(false);
    const chineseVoice = feedbackVoiceURI || voiceURI;
    const [listening, setListening] = useState(false);
    const [history, setHistory] = useState(() => getChildValue(profileId, 'englishConversationHistory', []));
    const recognitionRef = useRef(null);

    useEffect(() => setChildValue(profileId, 'englishConversationHistory', history), [history, profileId]);

    useEffect(() => {
        setHistory(getChildValue(profileId, 'englishConversationHistory', []));
        setQuestion(null);
        setAnswer('');
        setFeedback('');
    }, [profileId]);

    useEffect(() => {
        if ('webkitSpeechRecognition' in window) {
            const recognition = new webkitSpeechRecognition();
            recognition.lang = 'en-US';
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.onresult = event => {
                setAnswer(event.results[0][0].transcript);
                setListening(false);
            };
            recognition.onend = () => setListening(false);
            recognitionRef.current = recognition;
        }
        return () => recognitionRef.current?.stop();
    }, []);

    const newQuestion = async () => {
        setBusy(true);
        setFeedback('');
        const prompt = `请给 5-8 岁中国小朋友出一个非常简单的英文口语问题。
要求：
- 问题必须短，适合孩子开口回答。
- 主题从颜色、食物、动物、家庭、喜欢什么里选。
- 返回 JSON，不要 Markdown。
{
  "question":"英文问题",
  "chineseHint":"中文提示",
  "sampleAnswer":"示范回答",
  "level":"easy"
}`;
        const res = await callLLM({ contents: [{ parts: [{ text: prompt }] }] });
        setBusy(false);
        if (res.error) {
            alert(res.error);
            return;
        }
        try {
            const parsed = parseConversationJson(res.text);
            setQuestion(parsed);
            setAnswer('');
            playAudio(parsed.question, voiceURI, 0, 'en');
        } catch {
            alert('AI 问题格式不正确，请重试。');
        }
    };

    const speakQuestion = () => {
        if (question?.question) playAudio(question.question, voiceURI, 0, 'en');
    };

    const startListening = () => {
        if (!recognitionRef.current) {
            alert('当前浏览器不支持英文语音识别，可以直接打字回答。');
            return;
        }
        if (listening) return;
        setListening(true);
        try {
            recognitionRef.current.start();
        } catch {
            setListening(false);
        }
    };

    const checkAnswer = async () => {
        if (!question || !answer.trim()) {
            alert('请先回答问题');
            return;
        }
        setBusy(true);
        setFeedback('AI 正在听你的英文回答...');
        const prompt = `请判断孩子的英文口语回答是否适合。
问题：${question.question}
中文提示：${question.chineseHint}
示范回答：${question.sampleAnswer}
孩子回答：${answer}

判断规则：
- 能回答问题，哪怕语法很简单，result 为 good。
- 跑题、完全不懂、关键词明显错，result 为 try_again。
- 无法判断，result 为 uncertain。

只返回 JSON：
{
  "result":"good|try_again|uncertain",
  "feedback":"中文反馈，温柔指出一个可改进点",
  "betterAnswer":"更自然的英文回答"
}`;
        const res = await callLLM({ contents: [{ parts: [{ text: prompt }] }] });
        setBusy(false);
        if (res.error) {
            setFeedback(res.error);
            return;
        }
        try {
            const review = parseReviewJson(res.text);
            const text = `${review.feedback}${review.betterAnswer ? ` 可以这样说：${review.betterAnswer}` : ''}`;
            setFeedback(text);
            setHistory(prev => [{ id: Date.now(), question, answer, review, createdAt: new Date().toISOString() }, ...prev].slice(0, 80));
            if (review.result === 'good') addStar();
            playAudio(text, chineseVoice);
        } catch {
            setFeedback('AI 反馈格式不正确，请重试。');
        }
    };

    return (
        <div className="h-full bg-slate-50 flex flex-col p-4 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
                <button onClick={onBack} className="text-slate-400 font-bold flex items-center gap-1"><Icon name="arrowLeft" size={18}/> 返回</button>
                <div className="font-bold text-slate-600">英文 AI 对话</div>
                <button onClick={newQuestion} disabled={busy} className="text-blue-500 font-bold text-sm">新问题</button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
                {question ? (
                    <>
                        <div className="bg-blue-50 rounded-2xl p-4">
                            <div className="text-xs text-blue-400 mb-1">AI asks</div>
                            <div className="text-2xl font-bold text-slate-800">{question.question}</div>
                            <div className="text-sm text-slate-400 mt-2">{question.chineseHint}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={speakQuestion} className="py-3 rounded-xl bg-slate-100 text-slate-500 font-bold">播放问题</button>
                            <button onClick={startListening} className={`py-3 rounded-xl font-bold ${listening ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}>{listening ? '正在听...' : '语音回答'}</button>
                        </div>
                        <textarea value={answer} onChange={e => setAnswer(e.target.value)} className="w-full p-3 rounded-xl border h-24" placeholder="孩子也可以打字回答，比如 I like apples." />
                        <button onClick={checkAnswer} disabled={busy} className="w-full py-3 rounded-xl bg-blue-500 text-white font-bold disabled:opacity-60">AI 判断回答</button>
                        {feedback && <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600">{feedback}</div>}
                        {question.sampleAnswer && <div className="text-xs text-slate-400">示范：{question.sampleAnswer}</div>}
                    </>
                ) : (
                    <div className="text-center py-10">
                        <button onClick={newQuestion} disabled={busy} className="px-6 py-4 rounded-2xl bg-blue-500 text-white font-bold shadow-lg">开始英文对话</button>
                        <div className="text-xs text-slate-400 mt-3">AI 会问一个简单英文问题，孩子可以说或打字回答。</div>
                    </div>
                )}
            </div>

            <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-4">
                <div className="font-bold text-slate-700 mb-2">对话记录</div>
                <div className="space-y-2 max-h-56 overflow-y-auto">
                    {history.length ? history.slice(0, 10).map(item => (
                        <div key={item.id} className="text-sm border-b border-slate-100 pb-2">
                            <div className="font-bold text-slate-600">{item.question.question}</div>
                            <div className="text-slate-400">回答：{item.answer}</div>
                        </div>
                    )) : <div className="text-slate-300 text-sm">暂无记录</div>}
                </div>
            </div>
        </div>
    );
}
