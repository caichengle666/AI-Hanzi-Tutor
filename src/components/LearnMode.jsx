import { useEffect, useRef, useState } from 'react';
import HanziWriter from 'hanzi-writer';
import Icon from './Icon.jsx';
import { playAudio } from '../lib/audio.js';
import { compressImage } from '../lib/image.js';
import { sanitizeHtml, renderMarkdown } from '../lib/html.js';
import { getChildValue, setChildValue } from '../lib/childWorkspace.js';

export default function LearnMode({ callLLM, addStar, profileId, onBack }) {
            const [cards, setCards] = useState(() => getChildValue(profileId, 'hanziCards', [{ id: 1, hanzi: '爸', pinyin: 'bà' }, { id: 2, hanzi: '妈', pinyin: 'mā' }]));
            const [view, setView] = useState('gallery'); 
            const [curIdx, setCurIdx] = useState(0);
            const [aiStatus, setAiStatus] = useState('idle');
            const [aiResult, setAiResult] = useState('');
            const [batchModal, setBatchModal] = useState(false);
            const [batchText, setBatchText] = useState('');
            const [isWriting, setIsWriting] = useState(false); 
            const [isEditing, setIsEditing] = useState(false);
            
            const [storyModal, setStoryModal] = useState(false);
            const [storyContent, setStoryContent] = useState('');
            const [isStoryLoading, setIsStoryLoading] = useState(false);

            // --- 新增：AI 聊天状态 ---
            const [chatMode, setChatMode] = useState(false);
            const [chatHistory, setChatHistory] = useState([]);
            const [chatInput, setChatInput] = useState('');
            const chatBoxRef = useRef(null);

            const writerRef = useRef(null);

            useEffect(() => {
                setCards(getChildValue(profileId, 'hanziCards', [{ id: 1, hanzi: '爸', pinyin: 'bà' }, { id: 2, hanzi: '妈', pinyin: 'mā' }]));
                setCurIdx(0);
                setView('gallery');
            }, [profileId]);

            useEffect(() => setChildValue(profileId, 'hanziCards', cards), [cards, profileId]);

            useEffect(() => {
                setIsWriting(false); setAiResult(''); setChatMode(false); setChatHistory([]); // 切换字时重置聊天
                chatTokenRef.current += 1; // 作废上一汉字的 pending 回复
                const target = document.getElementById('hanzi-target'); if(target) target.innerHTML = '';
            }, [curIdx]);

            // --- AI 聊天逻辑 ---
            const [isRecording, setIsRecording] = useState(false);
            const chatRecognitionRef = useRef(null);
            // 聊天会话序号：切换汉字时递增，旧汉字的 pending 回复回来时直接丢弃
            const chatTokenRef = useRef(0);

            useEffect(() => {
                // 初始化语音识别
                if ('webkitSpeechRecognition' in window) {
                    const r = new webkitSpeechRecognition();
                    r.continuous = false; 
                    r.lang = 'zh-CN';
                    r.interimResults = true; // 实时显示结果
                    
                    r.onstart = () => setIsRecording(true);
                    r.onend = () => setIsRecording(false);
                    r.onresult = (e) => {
                        const transcript = Array.from(e.results)
                            .map(result => result[0])
                            .map(result => result.transcript)
                            .join('');
                        setChatInput(transcript); // 实时上屏
                        
                        // 如果是最终结果，且不为空，可以选择自动发送（这里为了确认准确，暂不自动发送）
                        // if (e.results[0].isFinal) { ... }
                    };
                    chatRecognitionRef.current = r;
                }
                return () => { if(chatRecognitionRef.current) chatRecognitionRef.current.abort(); };
            }, []);

            const toggleVoiceInput = () => {
                if (!chatRecognitionRef.current) { alert("抱歉，您的浏览器不支持语音输入"); return; }
                
                if (isRecording) {
                    chatRecognitionRef.current.stop();
                } else {
                    setChatInput(''); // 清空之前的
                    chatRecognitionRef.current.start();
                }
            };

            const handleStartChat = () => {
                setChatMode(true);
                const char = cards[curIdx].hanzi;
                // 初始欢迎语
                setChatHistory([{
                    role: 'ai', 
                    content: `你好呀！我是汉字“${char}”。你想问我什么问题吗？比如“你为什么长这个样子？”或者“你可以组什么词？”`
                }]);
            };

            const handleSendMessage = async () => {
                if(!chatInput.trim()) return;
                const char = cards[curIdx].hanzi;
                const userMsg = chatInput;
                const token = chatTokenRef.current; // 快照：回复回来时校验是否还是同一汉字
                setChatInput('');
                setChatHistory(prev => [...prev, {role: 'user', content: userMsg}, {role: 'ai', content: '...', loading: true}]);
                
                // 滚动到底部
                setTimeout(() => chatBoxRef.current?.scrollTo({top: 9999, behavior: 'smooth'}), 100);

                const prompt = `你现在必须扮演汉字“${char}”。
你的性格：活泼、可爱、像个老朋友。
用户（5岁小朋友）问你：“${userMsg}”
请用第一人称“我”来回答。答案要简短（50字以内），充满童趣。
不要说教，要好玩。`;

                const res = await callLLM({ contents: [{ parts: [{ text: prompt }] }] });
                
                // 用户已切换到别的汉字：丢弃这条迟到的回复
                if (chatTokenRef.current !== token) return;

                setChatHistory(prev => {
                    const newHist = [...prev];
                    newHist.pop(); // 移除 loading
                    if(res.text) {
                        newHist.push({role: 'ai', content: res.text});
                        playAudio(res.text); // 自动朗读回复
                    } else {
                        newHist.push({role: 'ai', content: "哎呀，我刚才走神了，没听清你说什么..."});
                    }
                    return newHist;
                });
                setTimeout(() => chatBoxRef.current?.scrollTo({top: 9999, behavior: 'smooth'}), 100);
            };

            const renderWriter = () => {
                const target = document.getElementById('hanzi-target');
                if(!target) return;
                setIsWriting(true); target.innerHTML = ''; 
                writerRef.current = HanziWriter.create('hanzi-target', cards[curIdx].hanzi, {
                    width: 260, height: 260, padding: 5, strokeColor: '#334155', radicalColor: '#ea580c', showOutline: true
                });
                writerRef.current.animateCharacter();
            };

            const handleExplain = async () => {
                setAiStatus('loading'); setAiResult('');
                const char = cards[curIdx].hanzi;
                const prompt = `你是一个严谨的语文老师。请给5岁孩子解释汉字“${char}”。
请严格按照以下 JSON 格式返回，不要包含 markdown 代码块标记：
{
  "explanation": "一句充满童趣的解释",
  "idioms": [
    {"word": "成语1", "meaning": "简单好懂的意思"},
    {"word": "成语2", "meaning": "简单好懂的意思"}
  ]
}
重要规则：
1. 返回的成语必须包含汉字“${char}”，严禁使用同音字或形近字。
2. 解释要适合5岁孩子听。
3. 如果找不到合适的成语，idioms 数组留空。`;
                
                const res = await callLLM({ contents: [{ parts: [{ text: prompt }] }] });
                setAiStatus('idle');
                if(res.text) {
                    try {
                        const cleanJson = res.text.replace(/```json|```/g, '').trim();
                        const data = JSON.parse(cleanJson);
                        const validIdioms = data.idioms.filter(item => item.word.includes(char));
                        
                        let displayHtml = `<div class="space-y-4"><div><span class="text-orange-500 font-bold">💡 意思：</span><span class="text-slate-700">${data.explanation}</span></div>`;
                        if (validIdioms.length > 0) {
                            displayHtml += `<div><div class="text-orange-500 font-bold mb-1">📖 成语学习：</div><div class="space-y-2">`;
                            validIdioms.forEach(item => {
                                displayHtml += `<div class="bg-orange-50 p-2 rounded-lg border border-orange-100"><span class="font-bold text-slate-800 text-lg">【${item.word}】</span><div class="text-slate-600 text-xs mt-1 leading-relaxed">${item.meaning}</div></div>`;
                            });
                            displayHtml += `</div></div>`;
                        }
                        displayHtml += `</div>`;
                        setAiResult(displayHtml);
                        let speakText = `意思是：${data.explanation}。`;
                        if (validIdioms.length > 0) speakText += `成语有：${validIdioms.map(i => i.word + "，" + i.meaning).join("。")}`;
                        playAudio(speakText);
                    } catch (e) {
                        setAiResult(`<div class="p-2 text-slate-600">${res.text}</div>`);
                        playAudio(res.text);
                    }
                }
            };

            const handleSimilar = async () => {
                setAiStatus('loading'); setAiResult('');
                const char = cards[curIdx].hanzi;
                const prompt = `请找出2-3个容易和汉字“${char}”混淆的形近字或音近字。请用简单易懂的语言告诉5岁孩子怎么区分它们。请使用Markdown格式，重点文字加粗。`;
                const res = await callLLM({ contents: [{ parts: [{ text: prompt }] }] });
                setAiStatus('idle');
                if(res.text) { 
                    setAiResult(`<div class="markdown-body text-xs leading-relaxed">${renderMarkdown(res.text)}</div>`); 
                    const speakText = res.text.replace(/[*#`_~\[\]]/g, ''); 
                    playAudio(speakText);
                }
            };

            const handleGenerateStory = async () => {
                if(cards.length === 0) return;
                setIsStoryLoading(true); setStoryModal(true); setStoryContent('');
                const shuffled = [...cards].sort(() => 0.5 - Math.random());
                const selected = shuffled.slice(0, 8).map(c => c.hanzi);
                const prompt = `请用以下这些汉字编一个适合5岁小朋友听的短童话故事（150字以内）：${selected.join('，')}。
                要求：1. 故事情节有趣、有反转。2. 必须用到上面提供的字。3. 将用到的这些字用 **加粗** 标记出来。4. 最后给故事起个可爱的名字。`;
                const res = await callLLM({ contents: [{ parts: [{ text: prompt }] }] });
                setIsStoryLoading(false);
                if(res.text) { 
                    setStoryContent(res.text); 
                    const title = res.text.split('\n')[0].replace(/[#*]/g, '');
                    playAudio(`故事时间：${title}`);
                }
            };

            const handlePhotoAdd = async (e) => {
                const file = e.target.files[0]; if(!file) return;
                setAiStatus('loading');
                let base64;
                try {
                    base64 = await compressImage(file);
                } catch (err) {
                    setAiStatus('idle');
                    alert(err.message || '图片处理失败，请重试。');
                    return;
                }
                const prompt = `请识别图片中所有的简体中文字符（不包含标点符号）。请返回一个 JSON 数组，每个对象包含 "hanzi" (汉字) 和 "pinyin" (拼音带声调)。例如: [{"hanzi": "爸", "pinyin": "bà"}]`;
                const res = await callLLM({ contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64 } }] }] });
                setAiStatus('idle');
                if (res.error || !res.text) {
                    alert(res.error || '识别失败，请重试。');
                    return;
                }
                try {
                    const cleanJson = res.text.replace(/```json|```/g, '').trim();
                    const list = JSON.parse(cleanJson);
                    if (Array.isArray(list)) {
                        const existingChars = new Set(cards.map(c => c.hanzi));
                        const newItems = list.filter(item => !existingChars.has(item.hanzi));
                        if (newItems.length > 0) {
                            const itemsToAdd = newItems.map(i => ({id: Date.now() + Math.random(), ...i}));
                            setCards(prev => [...prev, ...itemsToAdd]);
                            alert(`✅ 成功添加 ${newItems.length} 个新字！\n(已过滤 ${list.length - newItems.length} 个重复字)`);
                        } else { alert("👀 图片里的字好像都学过了哦！(全部重复)"); }
                    }
                } catch (e) { alert("识别失败，请重试。"); }
            };

            const handleBatchImport = async () => {
                if(!batchText) return;
                setAiStatus('loading');
                const inputChars = batchText.replace(/[^\u4e00-\u9fa5]/g, '').split('').filter((v,i,a)=>a.indexOf(v)===i);
                const existingChars = new Set(cards.map(c => c.hanzi));
                const newChars = inputChars.filter(char => !existingChars.has(char));

                if (newChars.length === 0) {
                    setAiStatus('idle');
                    alert("您输入的字都已经学过了哦！");
                    return;
                }

                const prompt = `Give pinyin for chars: ${newChars.join('')}. Return JSON array: [{"hanzi":"字","pinyin":"py"}]`;
                const res = await callLLM({ contents: [{ parts: [{ text: prompt }] }] });
                setAiStatus('idle');
                if (res.error || !res.text) {
                    alert(res.error || '识别失败，请重试。');
                    return;
                }
                
                try {
                    const list = JSON.parse(res.text.replace(/```json|```/g, '').trim());
                    const newCards = list.map(i=>({id: Date.now() + Math.random(), ...i}));
                    setCards(prev => [...prev, ...newCards]);
                    setBatchModal(false); setBatchText(''); 
                    alert(`成功添加 ${newCards.length} 个新字！\n(自动过滤了 ${inputChars.length - newChars.length} 个重复字)`);
                } catch(e) {
                     const newCards = newChars.map(c=>({id: Date.now() + Math.random(), hanzi:c, pinyin:''}));
                     setCards(prev => [...prev, ...newCards]);
                     setBatchModal(false);
                }
            };
            
            const deleteCard = (e, id) => {
                e.stopPropagation(); 
                if(confirm("确定要删除这个字吗？")) {
                    setCards(prev => prev.filter(c => c.id !== id));
                    if(view === 'card' && cards[curIdx]?.id === id) setView('gallery');
                }
            };

            const updatePinyin = (id, newPinyin) => {
                setCards(cards.map(c => c.id === id ? { ...c, pinyin: newPinyin } : c));
            };

            if(view === 'gallery') return (
                <div className="h-full flex flex-col p-4 md:p-8 animate-in fade-in relative overflow-hidden">
                    <div className="flex justify-between items-center mb-6">
                        <button onClick={onBack} className="text-slate-500 font-bold flex items-center gap-2 hover:text-slate-700 transition-colors"><div className="bg-white p-2 rounded-full shadow-sm"><Icon name="arrowLeft" size={20}/></div> 返回首页</button>
                        <div className="flex gap-3">
                             <button onClick={() => setIsEditing(!isEditing)} className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm ${isEditing ? 'bg-red-500 text-white shadow-red-200' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{isEditing ? <><Icon name="check" size={18}/> 完成</> : <><Icon name="edit" size={18}/> 管理</>}</button>
                             <button onClick={() => setView('list')} className="bg-white text-slate-600 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 shadow-sm"><Icon name="list" size={18}/> 列表</button>
                        </div>
                    </div>
                    
                    <div className="mb-6">
                         <button onClick={handleGenerateStory} className="w-full bg-gradient-to-r from-pink-500 to-purple-500 text-white p-4 md:p-6 rounded-2xl shadow-lg shadow-pink-200 flex items-center justify-center gap-3 font-bold active:scale-95 hover:shadow-xl transition-all group">
                             <div className="bg-white/20 p-2 rounded-full group-hover:rotate-12 transition-transform"><Icon name="book" size={24}/></div>
                             <span className="text-lg">AI 创意绘本 (用生字讲故事)</span>
                         </button>
                    </div>

                    <div className="flex-1 overflow-y-auto no-scrollbar grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-4 md:gap-6 pb-24 content-start">
                        {cards.map((c, i) => (
                            <div key={c.id} onClick={() => {if(!isEditing) {setCurIdx(i); setView('card');}}} className={`aspect-square bg-white rounded-2xl shadow-sm border-2 flex flex-col items-center justify-center font-kaiti text-3xl md:text-4xl text-slate-700 relative transition-all group cursor-pointer ${isEditing ? 'shake border-red-200' : 'border-slate-100 hover:border-orange-200 hover:shadow-md active:scale-95'}`}>
                                <span className="text-xs md:text-sm font-sans text-slate-300 mb-1 group-hover:text-orange-300 transition-colors">{c.pinyin}</span>{c.hanzi}
                                {isEditing && <button onClick={(e) => deleteCard(e, c.id)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-2 shadow-md z-20 animate-in zoom-in hover:bg-red-600 transition-colors"><Icon name="trash" size={14}/></button>}
                            </div>
                        ))}
                        <label className="aspect-square bg-indigo-50 border-2 border-dashed border-indigo-200 rounded-2xl flex flex-col items-center justify-center text-indigo-400 cursor-pointer active:bg-indigo-100 hover:border-indigo-400 hover:text-indigo-500 transition-all">
                             {aiStatus === 'loading' ? <span className="animate-spin text-3xl">⏳</span> : <Icon name="camera" size={36}/>}
                             <span className="text-xs md:text-sm font-bold mt-2">拍照加字</span>
                             <input type="file" className="hidden" accept="image/*" onChange={handlePhotoAdd} />
                        </label>
                        <div onClick={() => setBatchModal(true)} className="aspect-square bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400 cursor-pointer active:bg-slate-100 hover:border-slate-400 hover:text-slate-500 transition-all">
                             <span className="text-3xl mb-1">+</span><span className="text-xs md:text-sm font-bold">手动/批量</span>
                        </div>
                    </div>

                    {storyModal && (
                        <div className="absolute inset-0 bg-white z-50 flex flex-col animate-in slide-in-from-bottom">
                            <div className="p-4 border-b flex justify-between items-center bg-pink-50">
                                <h3 className="font-bold text-pink-600 flex items-center gap-2"><Icon name="sparkles" size={18}/> AI 故事会</h3>
                                <button onClick={() => setStoryModal(false)} className="bg-white p-2 rounded-full shadow text-slate-400"><Icon name="x" size={20}/></button>
                            </div>
                            <div className="flex-1 p-6 overflow-y-auto">
                                {isStoryLoading ? (
                                    <div className="flex flex-col items-center justify-center h-full text-pink-400 space-y-4">
                                        <div className="animate-spin text-4xl">✨</div>
                                        <p>正在把生字变成故事...</p>
                                    </div>
                                ) : (
                                    <div className="markdown-body text-slate-700 leading-relaxed font-kaiti text-lg" dangerouslySetInnerHTML={{__html: renderMarkdown(storyContent)}}></div>
                                )}
                            </div>
                            {!isStoryLoading && (
                                <div className="p-4 border-t flex justify-center">
                                     <button onClick={() => playAudio(storyContent.replace(/[#*]/g, ''))} className="bg-pink-500 text-white px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2 active:scale-95"><Icon name="mic" size={20}/> 朗读故事</button>
                                </div>
                            )}
                        </div>
                    )}

                    {batchModal && <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl p-6 w-full"><h3 className="font-bold mb-2">输入汉字</h3><textarea value={batchText} onChange={e=>setBatchText(e.target.value)} className="w-full border p-2 h-24 rounded-xl mb-4 text-lg" placeholder="天地玄黄..."></textarea><div className="flex justify-end gap-2"><button onClick={()=>setBatchModal(false)} className="px-4 py-2 text-slate-500 font-bold">取消</button><button onClick={handleBatchImport} className="px-4 py-2 bg-indigo-500 text-white rounded-lg font-bold shadow">{aiStatus==='loading'?'...':'确定'}</button></div></div></div>}
                </div>
            );

            if(view === 'list') return (
                <div className="h-full flex flex-col p-4 md:p-8 bg-slate-50 animate-in slide-in-from-right relative z-20">
                    <div className="flex justify-between items-center mb-6 max-w-4xl mx-auto w-full">
                        <button onClick={() => setView('gallery')} className="text-slate-500 font-bold flex items-center gap-2 hover:text-slate-700"><div className="bg-white p-2 rounded-full shadow-sm"><Icon name="arrowLeft" size={20}/></div> 返回画廊</button>
                        <span className="text-sm font-bold text-slate-400 bg-white px-3 py-1 rounded-full border">共 {cards.length} 个字</span>
                    </div>
                    <div className="flex-1 overflow-y-auto no-scrollbar pb-8 max-w-4xl mx-auto w-full">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {cards.map((card) => (
                            <div key={card.id} className="flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                                <div className="w-14 h-14 bg-orange-50 rounded-xl flex items-center justify-center text-3xl font-bold text-slate-700 font-kaiti border border-orange-100">{card.hanzi}</div>
                                <div className="flex-1">
                                    <div className="text-xs text-slate-400 mb-1">拼音修正</div>
                                    <input type="text" value={card.pinyin} onChange={(e) => updatePinyin(card.id, e.target.value)} className="w-full bg-slate-50 border-b border-transparent focus:border-orange-400 outline-none px-2 py-1 text-slate-700 font-mono rounded text-lg"/>
                                </div>
                                <button onClick={(e) => deleteCard(e, card.id)} className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"><Icon name="trash" size={20} /></button>
                            </div>
                        ))}
                        </div>
                    </div>
                </div>
            );

            return (
                <div className="h-full flex flex-col p-4 md:p-8 relative">
                    {/* Header */}
                    <div className="w-full flex justify-between items-center mb-4 md:mb-0">
                        <button onClick={() => setView('gallery')} className="p-3 bg-white rounded-xl shadow-sm hover:shadow text-slate-500 transition-all"><Icon name="home" size={20}/></button>
                        <span className="text-sm font-bold text-slate-300 bg-white/50 px-3 py-1 rounded-full md:hidden">{curIdx+1}/{cards.length}</span>
                        <button onClick={(e) => deleteCard(e, cards[curIdx].id)} className="p-3 bg-red-50 text-red-400 rounded-xl shadow-sm hover:bg-red-100 transition-all"><Icon name="trash" size={20}/></button>
                    </div>

                    {/* Main Content Area: Responsive Split */}
                    <div className="flex-1 w-full flex flex-col md:flex-row items-center md:items-start md:justify-center gap-6 md:gap-12 mt-2 md:mt-8 overflow-hidden">
                        
                        {/* Left Column: TianZiGe & Nav */}
                        <div className="flex flex-col items-center gap-6 relative z-10 shrink-0">
                            <div className="tian-zi-ge rounded-[2.5rem] shadow-2xl aspect-[3/4] flex flex-col items-center relative transition-all bg-white w-[80vw] max-w-xs md:w-96 md:h-[32rem]">
                                <div className="mt-8 md:mt-12 text-6xl md:text-7xl font-mono font-bold text-orange-400 tian-zi-ge-content tracking-wider">{cards[curIdx].pinyin}</div>
                                <div className="flex-1 w-full flex items-center justify-center relative cursor-pointer tian-zi-ge-content" onClick={() => playAudio(cards[curIdx].hanzi)}>
                                    <div id="hanzi-target"></div>
                                    {!isWriting && <div className="text-[200px] md:text-[240px] font-kaiti font-bold text-slate-800 absolute inset-0 flex items-center justify-center pointer-events-none pb-4 select-none">{cards[curIdx].hanzi}</div>}
                                </div>
                            </div>
                            
                            <div className="flex gap-12 text-slate-300">
                                <button onClick={()=>{setCurIdx((i)=>(i-1+cards.length)%cards.length)}} className="p-4 bg-white rounded-full shadow-lg hover:bg-orange-50 hover:text-orange-400 active:scale-95 transition-all"><Icon name="arrowLeft" size={28}/></button>
                                <div className="hidden md:flex flex-col items-center justify-center text-xs font-bold text-slate-300">
                                    <span>{curIdx+1}</span>
                                    <div className="w-8 h-1 bg-slate-200 rounded-full my-1"></div>
                                    <span>{cards.length}</span>
                                </div>
                                <button onClick={()=>{setCurIdx((i)=>(i+1)%cards.length)}} className="p-4 bg-white rounded-full shadow-lg hover:bg-orange-50 hover:text-orange-400 active:scale-95 transition-all"><Icon name="arrowLeft" size={28} className="rotate-180"/></button>
                            </div>
                        </div>

                        {/* Right Column: Controls & AI Result */}
                        <div className="w-full max-w-sm md:max-w-md md:h-[32rem] md:flex md:flex-col gap-4 relative">
                            {/* Action Buttons Grid */}
                            {!chatMode ? (
                                <div className="grid grid-cols-4 md:grid-cols-2 gap-3 md:gap-4 shrink-0">
                                    <button onClick={renderWriter} className="flex flex-col md:flex-row items-center justify-center md:gap-3 h-16 md:h-20 bg-green-500 text-white rounded-2xl shadow-lg shadow-green-200 active:scale-95 transition-transform hover:bg-green-600">
                                        <Icon name="pen" size={24}/>
                                        <span className="text-[10px] md:text-base font-bold mt-1 md:mt-0">写一写</span>
                                    </button>
                                    <button onClick={() => playAudio(cards[curIdx].hanzi)} className="flex flex-col md:flex-row items-center justify-center md:gap-3 h-16 md:h-20 bg-orange-500 text-white rounded-2xl shadow-lg shadow-orange-200 active:scale-95 transition-transform hover:bg-orange-600">
                                        <Icon name="mic" size={24}/>
                                        <span className="text-[10px] md:text-base font-bold mt-1 md:mt-0">听读音</span>
                                    </button>
                                    <button onClick={handleExplain} disabled={aiStatus==='loading'} className="flex flex-col md:flex-row items-center justify-center md:gap-3 h-16 md:h-20 bg-indigo-500 text-white rounded-2xl shadow-lg shadow-indigo-200 active:scale-95 transition-transform hover:bg-indigo-600">
                                        <Icon name="sparkles" size={24}/>
                                        <span className="text-[10px] md:text-base font-bold mt-1 md:mt-0">AI讲解</span>
                                    </button>
                                    <button onClick={handleStartChat} className="flex flex-col md:flex-row items-center justify-center md:gap-3 h-16 md:h-20 bg-sky-500 text-white rounded-2xl shadow-lg shadow-sky-200 active:scale-95 transition-transform hover:bg-sky-600">
                                        <Icon name="chat" size={24}/>
                                        <span className="text-[10px] md:text-base font-bold mt-1 md:mt-0">聊聊天</span>
                                    </button>
                                </div>
                            ) : null}

                            {/* Chat Interface */}
                            {chatMode && (
                                <div className="absolute inset-0 z-30 flex flex-col bg-white rounded-3xl shadow-xl overflow-hidden border border-sky-100 animate-in zoom-in-95 duration-200">
                                    <div className="bg-sky-50 p-3 flex justify-between items-center border-b border-sky-100">
                                        <div className="flex items-center gap-2 text-sky-600 font-bold">
                                            <div className="w-8 h-8 bg-sky-200 rounded-full flex items-center justify-center text-white">🤖</div>
                                            我是“{cards[curIdx].hanzi}”
                                        </div>
                                        <button onClick={()=>setChatMode(false)} className="text-slate-400 hover:text-red-500 p-1"><Icon name="x" size={20}/></button>
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50" ref={chatBoxRef}>
                                        {chatHistory.map((msg, i) => (
                                            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[80%] p-3 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-sky-500 text-white rounded-tr-none' : 'bg-white text-slate-700 shadow-sm rounded-tl-none border border-slate-100'}`}>
                                                    {msg.loading ? <span className="animate-pulse">...</span> : msg.content}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="p-2 bg-white border-t flex gap-2 items-center">
                                        <button 
                                            onClick={toggleVoiceInput}
                                            className={`p-3 rounded-xl flex items-center justify-center transition-all ${isRecording ? 'bg-red-500 text-white mic-active shadow-red-300 shadow-lg' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                                        >
                                            <Icon name="mic" size={20}/>
                                        </button>
                                        <input 
                                            value={chatInput} 
                                            onChange={e=>setChatInput(e.target.value)} 
                                            onKeyDown={e=>e.key==='Enter'&&handleSendMessage()}
                                            placeholder={isRecording ? "正在听你说..." : "打字或按语音..."}
                                            className={`flex-1 bg-slate-100 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 transition-all ${isRecording ? 'ring-2 ring-red-200 bg-red-50 placeholder-red-400' : 'ring-sky-200'}`}
                                        />
                                        <button onClick={handleSendMessage} className="bg-sky-500 text-white px-4 py-2 rounded-xl font-bold text-sm active:scale-95 shadow-md shadow-sky-200">发送</button>
                                    </div>
                                </div>
                            )}

                            {/* AI Result Area (Desktop: Takes remaining height; Mobile: Overlay at bottom) */}
                            <div className={`
                                ${aiResult && !chatMode ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none hidden'}
                                transition-all duration-300 ease-out origin-bottom md:origin-top
                                fixed bottom-0 left-0 right-0 md:static md:w-full md:flex-1
                                bg-white/95 backdrop-blur md:bg-white md:backdrop-blur-none
                                p-5 md:p-6 rounded-t-3xl md:rounded-3xl border-t md:border border-orange-100 md:shadow-sm
                                z-50 md:z-0 max-h-[60vh] md:max-h-none overflow-y-auto
                            `}>
                                <div className="flex justify-between items-center mb-3 sticky top-0 bg-white/95 py-2 border-b border-slate-100">
                                    <span className="text-orange-500 font-bold flex items-center gap-2 text-lg">
                                        <Icon name="brain" size={20}/> 
                                        AI 老师说
                                    </span>
                                    <button onClick={()=>setAiResult('')} className="w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors">×</button>
                                </div>
                                <div className="text-sm md:text-base leading-relaxed text-slate-600 font-medium space-y-2 pb-8 md:pb-0" dangerouslySetInnerHTML={{__html: sanitizeHtml(aiResult)}}></div>
                            </div>
                            
                            {/* Empty State for Desktop (Placeholder) */}
                            {!aiResult && !chatMode && (
                                <div className="hidden md:flex flex-1 bg-white/50 border-2 border-dashed border-slate-200 rounded-3xl items-center justify-center text-slate-300 flex-col gap-2">
                                    <Icon name="sparkles" size={32} className="opacity-50"/>
                                    <p className="text-sm font-bold">点击上方按钮开始学习</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        // --- 听写模式 (已修复连读Bug，并优化首字发音) ---
