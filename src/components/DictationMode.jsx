import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { playAudio } from '../lib/audio.js';
import { compressImage } from '../lib/image.js';
import { getResultLabel, requestStructuredGrading } from '../lib/grading.js';
import { useDictationPlayback } from '../hooks/useDictationPlayback.js';
import { loadNotebook, resolveDictationMistake, saveNotebook, upsertDictationMistake } from '../lib/reviewNotebook.js';
import { getChildValue, setChildValue } from '../lib/childWorkspace.js';
import { getActiveAssignment, recordAssignmentAttempt } from '../lib/assignments.js';

export default function DictationMode({ callLLM, addStar, voiceURI, profileId, onBack }) {
            const assignment = getActiveAssignment(profileId);
            const assignmentWords = assignment?.subject === 'chineseDictation' ? assignment.items : null;
            const [words, setWords] = useState(() => assignmentWords?.length ? assignmentWords : getChildValue(profileId, 'dictationWords', ['无论', '船舱']));
            const [history, setHistory] = useState(() => getChildValue(profileId, 'dictationHistory', []));
            const [wrongWords, setWrongWords] = useState(() => getChildValue(profileId, 'dictationWrong', []));
            const [idx, setIdx] = useState(0);
            const [status, setStatus] = useState('idle');
            const [feedback, setFeedback] = useState('');
            const [gradeResult, setGradeResult] = useState('');
            const [lastCheckedWord, setLastCheckedWord] = useState('');
            const [showHint, setShowHint] = useState(false);
            const [hintCount, setHintCount] = useState(0); // 记录查看次数
            const [finished, setFinished] = useState(false);
            const [sessionResults, setSessionResults] = useState([]);
            const recognitionRef = useRef(null);
            const idxRef = useRef(idx);
            const { stopEverything, startPlay, requestAutoPlay, toggleHint } = useDictationPlayback({
                words,
                idx,
                idxRef,
                recognitionRef,
                voiceURI,
                setStatus,
                setShowHint,
                setHintCount
            });

            useEffect(() => {
                const currentAssignment = getActiveAssignment(profileId);
                setWords(currentAssignment?.subject === 'chineseDictation' && currentAssignment.items.length ? currentAssignment.items : getChildValue(profileId, 'dictationWords', ['无论', '船舱']));
                setHistory(getChildValue(profileId, 'dictationHistory', []));
                setWrongWords(getChildValue(profileId, 'dictationWrong', []));
                setIdx(0);
                setFeedback('');
                setGradeResult('');
                setLastCheckedWord('');
                setFinished(false);
                setSessionResults([]);
            }, [profileId]);
            useEffect(() => setChildValue(profileId, 'dictationWords', words), [profileId, words]);
            useEffect(() => setChildValue(profileId, 'dictationHistory', history), [history, profileId]);
            useEffect(() => setChildValue(profileId, 'dictationWrong', wrongWords), [profileId, wrongWords]);
            useEffect(() => { idxRef.current = idx; }, [idx]);

            // 新增：全屏触控唤醒 (极简版)
            // 专门解决 iOS 自动断开后无法重连的问题
            const handleTouchWake = () => {
                // 只有在等待指令(listening)时才响应，防止误触
                if (status === 'listening' && recognitionRef.current) {
                    try { 
                        // 尝试启动。如果已经在跑，浏览器会报错但无害；如果停了，这句就能救活它。
                        recognitionRef.current.start(); 
                        console.log("👆 触摸唤醒录音机");
                    } catch(e) {
                        // 如果 start 报错（比如已经在运行），我们忽略它，不影响流程
                    }
                }
            };

            useEffect(() => {
                if ('webkitSpeechRecognition' in window) {
                    const r = new webkitSpeechRecognition();
                    r.continuous = false; r.lang = 'zh-CN';
                    r.onend = () => {};
                    r.onresult = (e) => {
                        const cmd = e.results[0][0].transcript;
                        if (cmd.match(/下\s*一?\s*个|下一页|^\s*过\s*$|\bok\b/i)) goNext();
                        else if (cmd.match(/重读|重播|再听|再读|^\s*听\s*$/i)) startPlay(words[idx]);
                        else if (cmd.match(/^(看|看一下|看一眼|笔)$/i)) toggleHint(showHint, hintCount);
                    };
                    recognitionRef.current = r;
                }
                return () => { stopEverything(); if(recognitionRef.current) recognitionRef.current.stop(); };
            }, [idx, showHint, hintCount, startPlay, stopEverything, toggleHint, words]);

            const goNext = () => { 
                if(idx < words.length - 1) { 
                    stopEverything(); // 先停止当前的
                    setIdx(prev => prev + 1); // 切换索引
                    setStatus('idle'); 
                    setFeedback(''); 
                    setGradeResult('');
                    setLastCheckedWord('');
                    requestAutoPlay(); // 标记翻页后自动播放
                } else {
                    stopEverything();
                    setFinished(true);
                }
            };

            const restartSession = () => {
                stopEverything();
                setIdx(0);
                setStatus('idle');
                setFeedback('');
                setGradeResult('');
                setLastCheckedWord('');
                setFinished(false);
                setSessionResults([]);
            };

            const practiceWrongFromSummary = () => {
                if (!wrongWords.length) {
                    alert('还没有错题');
                    return;
                }
                stopEverything();
                setWords(wrongWords);
                setIdx(0);
                setStatus('idle');
                setFeedback('');
                setGradeResult('');
                setLastCheckedWord('');
                setFinished(false);
                setSessionResults([]);
            };

            const saveHistory = (word, grading) => {
                const { result, feedback, confidence, evidence, transcription, errorDetails } = grading;
                const sourceKey = `dictation:zh:${assignment?.id || 'library'}:${word}`;
                const record = { id: Date.now(), assignmentId: assignment?.id || null, word, result, feedback, confidence, evidence, transcription, errorDetails, createdAt: new Date().toISOString() };
                setHistory(prev => [record, ...prev].slice(0, 80));
                setSessionResults(prev => [...prev, { word, result }]);
                if (assignment?.id) recordAssignmentAttempt(profileId, assignment.id, { item: word, result, feedback, confidence, evidence, type: 'dictation' });
                if (result === 'wrong') {
                    setWrongWords(prev => prev.includes(word) ? prev : [word, ...prev].slice(0, 80));
                    const notebook = loadNotebook(profileId);
                    const saved = upsertDictationMistake(notebook, {
                        subject: '语文',
                        category: '错别字',
                        originalQuestion: `听写词语：${word}`,
                        wrongAnswer: '拍照批改未通过',
                        correctAnswer: word,
                        analysis: errorDetails.join('；') || '听写时没有正确写出目标词语。',
                        reviewTip: '下次先看一遍字形，再遮住重写。',
                        sourceKey,
                        assignmentId: assignment?.id || '',
                        assignmentTitle: assignment?.title || '',
                        gradingResult: result,
                        gradingEvidence: evidence,
                        gradingConfidence: confidence,
                        gradingTranscription: transcription,
                        gradingErrorDetails: errorDetails,
                        tags: ['听写']
                    });
                    if (saved.ok) saveNotebook(profileId, saved.state);
                } else if (result === 'correct') {
                    const notebook = loadNotebook(profileId);
                    const saved = resolveDictationMistake(notebook, sourceKey, feedback);
                    if (saved.ok) saveNotebook(profileId, saved.state);
                }
            };

            const markWrong = () => {
                const word = lastCheckedWord || words[idx];
                saveHistory(word, { result: 'wrong', feedback: feedback || '家长确认这次需要复习。', confidence: 'high', evidence: '家长手动确认。', transcription: '', errorDetails: ['家长手动标记为错误'] });
                setGradeResult('wrong');
                alert(`已加入错题：${word}`);
            };

            const markCorrect = () => {
                const word = lastCheckedWord || words[idx];
                saveHistory(word, { result: 'correct', feedback: feedback || '家长确认这次写对了。', confidence: 'high', evidence: '家长手动确认。', transcription: '', errorDetails: [] });
                setWrongWords(prev => prev.filter(item => item !== word));
                setGradeResult('correct');
                alert(`已记录通过：${word}`);
            };
            
            const handleCheck = async (e) => {
                const file = e.target.files[0]; if(!file) return;
                const checkedWord = words[idx];
                setStatus('grading'); setFeedback('👀 批改中...');
                let base64;
                try {
                    base64 = await compressImage(file);
                } catch (err) {
                    setStatus('idle'); setFeedback(err.message || '图片处理失败，请重试。'); return;
                }
                const prompt = `检查作业是否正确写出了词语“${checkedWord}”。
请只返回 JSON，不要 Markdown，不要代码块：
{"schemaVersion":1,"result":"correct|wrong|uncertain","confidence":"high|medium|low","transcription":"图片中识别到的孩子书写，无法识别则空","evidence":"判断依据","errorDetails":["具体错字或错误，正确时为空数组"],"feedback":"给5岁小朋友的一句话温柔点评"}
判断规则：
- 清楚写对目标词语，result 为 correct
- 明显没写、写错字、少字、多字，result 为 wrong
- 图片模糊、遮挡、无法判断，result 为 uncertain`;
                const res = await requestStructuredGrading(callLLM, [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: base64 } }]);
                setStatus(recognitionRef.current ? 'listening' : 'idle');
                setLastCheckedWord(checkedWord);
                if (res.error) {
                    setGradeResult('uncertain');
                    setFeedback(res.error);
                    return;
                }
                if (res.grading) {
                    const parsed = res.grading;
                    setGradeResult(parsed.result);
                    setFeedback(parsed.feedback);
                    saveHistory(checkedWord, parsed);
                    if (parsed.result === 'correct') {
                        setWrongWords(prev => prev.filter(item => item !== checkedWord));
                        addStar();
                    }
                    playAudio(parsed.feedback, voiceURI);
                }
            };

            const handlePhotoImportWords = async (e) => {
                const file = e.target.files[0]; if(!file) return;
                let base64;
                try {
                    base64 = await compressImage(file);
                } catch (err) {
                    alert(err.message || '图片处理失败，请重试。');
                    return;
                }
                setStatus('grading'); setFeedback('🔍 正在提取词语...');
                
                const prompt = `提取图片中所有的中文词语（例如：春天、无论、开心）。请忽略单纯的页码、标题或无关文字。请返回 JSON 字符串数组，例如: ["词语1", "词语2"]`;

                const res = await callLLM({ contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64 } }] }] });
                if (res.error || !res.text) {
                    alert(res.error || '识别失败');
                    setStatus('idle'); setFeedback(''); setGradeResult('');
                    return;
                }
                
                try {
                    const cleanJson = res.text.replace(/```json|```/g, '').trim();
                    const list = JSON.parse(cleanJson);
                    
                    if (Array.isArray(list) && list.length > 0) {
                        const newWords = list.filter(w => !words.includes(w));
                        if(newWords.length > 0) {
                            if(confirm(`识别到 ${list.length} 个词，其中 ${newWords.length} 个是新的。\n要添加到当前列表吗？(点击取消则覆盖当前列表)`)) {
                                setWords([...words, ...newWords]);
                            } else {
                                setWords(list); 
                                setIdx(0);
                            }
                            alert("✅ 词库导入成功！");
                        } else { alert("词语都重复了，无需添加。"); }
                    } else { alert("没找到合适的词语。"); }
                } catch(e) { alert("识别失败"); }
                setStatus('idle'); setFeedback(''); setGradeResult('');
            };

            const handleImport = () => {
                const text = prompt("输入新词库（用空格分隔）：", words.join(" "));
                if(text) {
                    const list = text.split(/[\s,，]+/).filter(w=>w.trim());
                    const uniqueList = [...new Set(list)];
                    if(uniqueList.length) { 
                        setWords(uniqueList); 
                        setIdx(0); 
                        alert(`已导入 ${uniqueList.length} 个词`); 
                    }
                }
            };

            const parseWordText = (text) => {
                try {
                    const json = JSON.parse(text);
                    const list = Array.isArray(json) ? json : json.words;
                    if (Array.isArray(list)) return [...new Set(list.map(item => String(item).trim()).filter(Boolean))];
                } catch(e) {}
                return [...new Set(text.split(/[\s,，、;；\n\r]+/).map(item => item.trim()).filter(Boolean))];
            };

            const handleFileImport = async (e) => {
                const file = e.target.files[0]; if(!file) return;
                const text = await file.text();
                const list = parseWordText(text);
                e.target.value = '';
                if (!list.length) {
                    alert('没有识别到词语');
                    return;
                }
                if(confirm(`识别到 ${list.length} 个词。确定覆盖当前词库吗？`)) {
                    setWords(list);
                    setIdx(0);
                    setFeedback('');
                    setGradeResult('');
                    alert('词库导入成功');
                }
            };

            const exportWords = () => {
                const blob = new Blob([JSON.stringify({ words }, null, 2)], { type: 'application/json;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `dictation-words-${profileId}.json`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 2000);
            };

            const practiceWrongWords = () => {
                if (!wrongWords.length) {
                    alert('还没有错题');
                    return;
                }
                if (!confirm('将当前练习词库切换为错题本？')) return;
                setWords(wrongWords);
                setIdx(0);
                setStatus('idle');
                setFeedback('');
                setGradeResult('');
                setFinished(false);
                setSessionResults([]);
            };

            const clearWrongWords = () => {
                if (!wrongWords.length) return;
                if (confirm('清空错题本？')) setWrongWords([]);
            };

            const clearHistory = () => {
                if (!history.length) return;
                if (confirm('清空听写历史？')) setHistory([]);
            };

            // 总结按"词"统计（同一词多次批改只算最后一次），避免批改次数失真
            const latestByWord = new Map();
            sessionResults.forEach(item => latestByWord.set(item.word, item.result));
            const latestResults = [...latestByWord.values()];
            const correctCount = latestResults.filter(result => result === 'correct').length;
            const wrongCount = latestResults.filter(result => result === 'wrong').length;
            const uncertainCount = latestResults.filter(result => result === 'uncertain').length;

            if (finished) {
                return (
                    <div className="h-full flex flex-col p-4 bg-slate-50 relative overflow-y-auto">
                        <div className="flex justify-between items-center mb-6">
                            <button onClick={onBack} className="text-slate-400 font-bold"><Icon name="arrowLeft" size={20}/></button>
                            <div className="text-slate-500 font-bold">听写总结</div>
                            <div className="w-5" />
                        </div>
                        <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
                            <div className="text-center">
                                <div className="text-3xl font-bold text-slate-800 mb-2">本轮完成</div>
                                <div className="text-sm text-slate-400">共 {words.length} 个词</div>
                            </div>
                            <div className="grid grid-cols-3 gap-3 text-center">
                                <div className="bg-green-50 rounded-xl p-3"><div className="text-2xl font-bold text-green-600">{correctCount}</div><div className="text-xs text-green-500">正确</div></div>
                                <div className="bg-red-50 rounded-xl p-3"><div className="text-2xl font-bold text-red-500">{wrongCount}</div><div className="text-xs text-red-400">错误</div></div>
                                <div className="bg-yellow-50 rounded-xl p-3"><div className="text-2xl font-bold text-yellow-600">{uncertainCount}</div><div className="text-xs text-yellow-500">待确认</div></div>
                            </div>
                            {wrongWords.length > 0 && (
                                <div>
                                    <div className="font-bold text-slate-700 mb-2">错词</div>
                                    <div className="flex flex-wrap gap-2">
                                        {wrongWords.slice(0, 20).map(word => <span key={word} className="px-2 py-1 rounded-full bg-red-50 text-red-500 text-xs">{word}</span>)}
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
                <div 
                    className="h-full flex flex-col p-4 bg-slate-50 relative"
                    onClick={handleTouchWake} // 绑定全屏点击
                >
                    <div className="flex justify-between items-center mb-6">
                        <button onClick={onBack} className="text-slate-400 font-bold"><Icon name="arrowLeft" size={20}/></button>
                        <div className="text-slate-500 font-bold">听写: 第 {idx+1}/{words.length} 个</div>
                    </div>

                    <div className="flex-1 flex flex-col items-center pt-8">
                        <div className="flex flex-wrap justify-center gap-3 mb-8">
                            {words[idx].split('').map((char, i) => (
                                <div key={i} className="tian-zi-ge w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center shadow-sm">
                                    <span className={`tian-zi-ge-content font-kaiti text-7xl text-slate-800 transition-opacity duration-300 ${showHint ? 'opacity-30' : 'opacity-0'}`}>
                                        {char}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div className="flex flex-col items-center gap-2 h-20">
                            {status === 'playing' && <div className="text-orange-500 font-bold animate-pulse">正在读...</div>}
                            {status === 'listening' && (
                                <div className="flex flex-col items-center gap-2 animate-in zoom-in">
                                    <div className="text-green-600 font-bold bg-green-50 px-4 py-2 rounded-full border border-green-200 flex items-center gap-2 shadow-sm">
                                        <div className="w-3 h-3 bg-green-500 rounded-full mic-active"></div>
                                        请书写 (喊: 下一个)
                                    </div>
                                    <div className="text-xs text-slate-400">👆 iOS如果不灵，请拍一下屏幕再喊</div>
                                </div>
                            )}
                            {status === 'grading' && <div className="text-indigo-500 font-bold animate-bounce">🤖 正在批改...</div>}
                            {status === 'idle' && <div className="text-slate-400 text-sm">准备开始</div>}
                        </div>
                        {feedback && (
                            <div className="bg-white p-4 rounded-xl shadow border-l-4 border-orange-400 mt-4 text-sm text-slate-600 animate-in slide-in-from-bottom-2 w-full max-w-md">
                                <div className="flex items-start gap-2">
                                    {gradeResult && <span className={`shrink-0 px-2 py-1 rounded-full text-xs font-bold ${gradeResult === 'correct' ? 'bg-green-50 text-green-600' : gradeResult === 'wrong' ? 'bg-red-50 text-red-500' : 'bg-yellow-50 text-yellow-600'}`}>{getResultLabel(gradeResult)}</span>}
                                    <div>{feedback}</div>
                                </div>
                                {lastCheckedWord && (
                                    <div className="grid grid-cols-2 gap-2 mt-3">
                                        <button onClick={markCorrect} className="py-2 rounded-lg bg-green-50 text-green-600 font-bold">记录通过</button>
                                        <button onClick={markWrong} className="py-2 rounded-lg bg-red-50 text-red-500 font-bold">加入错题</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="mt-auto grid grid-cols-2 gap-3 pb-6 relative z-10"> {/* 底部按钮区 */}
                        {status === 'idle' ? 
                            <button onClick={() => startPlay(words[idx])} className="col-span-2 bg-orange-500 text-white py-4 rounded-2xl shadow-lg font-bold text-lg active:scale-95 transition-transform">▶ 开始</button> :
                            <>
                                <button onClick={() => startPlay(words[idx])} disabled={status === 'grading'} className="bg-white text-orange-500 border-2 border-orange-100 py-3 rounded-xl font-bold active:scale-95 disabled:opacity-60">↺ 重读</button>
                                <label className={`bg-indigo-500 text-white py-3 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 cursor-pointer active:scale-95 ${status === 'grading' ? 'opacity-60 pointer-events-none' : ''}`}><Icon name="camera" size={20}/> 批改<input type="file" className="hidden" accept="image/*" onChange={handleCheck} /></label>
                                <button onClick={() => toggleHint(showHint, hintCount)} className="col-span-2 bg-slate-100 text-slate-500 py-3 rounded-xl font-bold active:scale-95">{showHint?'隐藏': (hintCount===0 ? '看一眼 (3秒)' : '看一眼 (1秒)')}</button>
                                <button onClick={goNext} disabled={status === 'grading'} className="col-span-2 bg-green-500 text-white py-3 rounded-xl font-bold shadow-lg active:scale-95 disabled:opacity-60">下一个 ⏭</button>
                            </>
                        }
                        
                        <div className="col-span-2 flex justify-center gap-4 mt-2 text-xs text-slate-400">
                            <label className="cursor-pointer hover:text-orange-500 flex items-center gap-1">
                                <Icon name="camera" size={14}/> 拍照导入词库
                                <input type="file" className="hidden" accept="image/*" onChange={handlePhotoImportWords} />
                            </label>
                            <span className="text-slate-300">|</span>
                            <button onClick={handleImport} className="hover:text-orange-500">手动编辑</button>
                            <span className="text-slate-300">|</span>
                            <label className="cursor-pointer hover:text-orange-500">
                                文件导入
                                <input type="file" className="hidden" accept=".txt,.json,application/json,text/plain" onChange={handleFileImport} />
                            </label>
                            <span className="text-slate-300">|</span>
                            <button onClick={exportWords} className="hover:text-orange-500">导出</button>
                        </div>
                        <div className="col-span-2 bg-white rounded-2xl border border-slate-100 p-3 text-xs text-slate-500">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-slate-600">错题 {wrongWords.length} 个 / 历史 {history.length} 条</span>
                                <div className="flex gap-3">
                                    <button onClick={practiceWrongWords} className="text-orange-500 font-bold">错题再练</button>
                                    <button onClick={clearWrongWords} className="text-slate-400 font-bold">清错题</button>
                                    <button onClick={clearHistory} className="text-slate-400 font-bold">清历史</button>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2 max-h-16 overflow-y-auto">
                                {wrongWords.length ? wrongWords.slice(0, 12).map(word => <span key={word} className="bg-red-50 text-red-500 px-2 py-1 rounded-full">{word}</span>) : <span className="text-slate-300">暂无错题</span>}
                            </div>
                            <div className="mt-3 border-t border-slate-100 pt-2 space-y-1 max-h-20 overflow-y-auto">
                                {history.length ? history.slice(0, 5).map(record => (
                                    <div key={record.id} className="flex justify-between gap-2">
                                        <span className={record.result === 'wrong' ? 'text-red-500' : record.result === 'correct' ? 'text-green-600' : record.result === 'uncertain' ? 'text-yellow-600' : 'text-slate-500'}>{record.word} · {getResultLabel(record.result)}</span>
                                        <span className="text-slate-300">{new Date(record.createdAt).toLocaleDateString()}</span>
                                    </div>
                                )) : <div className="text-slate-300">暂无听写历史</div>}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

