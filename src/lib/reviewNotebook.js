import { getChildValue, setChildValue } from './childWorkspace.js';

export const SUBJECTS = ['语文', '数学', '英语'];
export const STATUSES = ['未复习', '已复习', '已掌握', '需再次复习'];
export const SOURCES = ['manual', 'dictation', 'photo', 'voice'];
export const CATEGORY_MAP = {
    语文: ['错别字', '多音字', '阅读理解', '文言文翻译', '古诗文', '病句'],
    数学: ['计算错误', '概念错误', '单位错误', '应用题', '几何题'],
    英语: ['单词拼写', '句型', '语法', '阅读理解', '翻译']
};

const emptyState = {
    mistakes: [],
    reviewSessions: [],
    reviewAttempts: [],
    exports: [],
    auditLogs: [],
    reminder: null,
    autoExport: null
};

function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function today() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthStart() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function summarizeDiagram(diagram) {
    if (!diagram || typeof diagram !== 'object' || !diagram.type) return '';
    return [
        `类型：${diagram.type}`,
        diagram.title ? `标题：${diagram.title}` : '',
        diagram.formula ? `公式：${diagram.formula}` : '',
        diagram.question ? `问题：${diagram.question}` : ''
    ].filter(Boolean).join('；');
}

function normalizeDate(value) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : today();
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeTags(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
    return String(value || '').split(/[,\uFF0C、\s]+/).map(item => item.trim()).filter(Boolean);
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[，。！？；：“”"'（）()、,.!?;:]/g, '');
}

function ngrams(text, n = 2) {
    const chars = Array.from(text);
    if (!chars.length) return new Set();
    if (chars.length < n) return new Set([chars.join('')]);
    const set = new Set();
    for (let i = 0; i <= chars.length - n; i += 1) set.add(chars.slice(i, i + n).join(''));
    return set;
}

function similarity(a, b) {
    const left = ngrams(normalizeText(a));
    const right = ngrams(normalizeText(b));
    const union = new Set([...left, ...right]);
    if (!union.size) return 0;
    let same = 0;
    left.forEach(item => { if (right.has(item)) same += 1; });
    return same / union.size;
}

function addAudit(state, action, detail = '') {
    return {
        ...state,
        auditLogs: [
            { id: makeId('audit'), action, detail, createdAt: new Date().toISOString() },
            ...ensureArray(state.auditLogs)
        ].slice(0, 80)
    };
}

function normalizeState(value) {
    return {
        ...emptyState,
        ...(value && typeof value === 'object' ? value : {}),
        mistakes: ensureArray(value?.mistakes),
        reviewSessions: ensureArray(value?.reviewSessions),
        reviewAttempts: ensureArray(value?.reviewAttempts),
        exports: ensureArray(value?.exports),
        auditLogs: ensureArray(value?.auditLogs)
    };
}

export function loadNotebook(profileId) {
    try {
        return normalizeState(getChildValue(profileId, 'reviewNotebook', null));
    } catch {
        return { ...emptyState };
    }
}

export function saveNotebook(profileId, state) {
    const normalized = normalizeState(state);
    setChildValue(profileId, 'reviewNotebook', normalized);
    return normalized;
}

export function guessSubject(text) {
    const content = String(text || '');
    if (/[\d+\-*/=]|单位|应用题|方程|几何|计算|厘米|米|千克|kg|cm|m\b/i.test(content)) return '数学';
    if (/[A-Za-z]{3,}|because|grammar|word|sentence|拼写|句型|语法|时态|阅读/i.test(content)) return '英语';
    return '语文';
}

export function guessCategory(subject, text) {
    const content = String(text || '');
    if (subject === '数学') {
        if (/单位|kg|cm|米|千克/i.test(content)) return '单位错误';
        if (/几何|面积|周长|角/.test(content)) return '几何题';
        if (/概念/.test(content)) return '概念错误';
        if (/应用题/.test(content)) return '应用题';
        return '计算错误';
    }
    if (subject === '英语') {
        if (/语法|时态|be动词/i.test(content)) return '语法';
        if (/阅读/.test(content)) return '阅读理解';
        if (/翻译/.test(content)) return '翻译';
        if (/句型/.test(content)) return '句型';
        return '单词拼写';
    }
    if (/多音字/.test(content)) return '多音字';
    if (/文言文|翻译/.test(content)) return '文言文翻译';
    if (/阅读/.test(content)) return '阅读理解';
    if (/病句/.test(content)) return '病句';
    if (/古诗|诗词/.test(content)) return '古诗文';
    return '错别字';
}

export function normalizeDraft(input = {}) {
    const subject = SUBJECTS.includes(input.subject) ? input.subject : guessSubject(input.originalQuestion || input.rawText);
    return {
        recordDate: normalizeDate(input.recordDate),
        subject,
        category: String(input.category || '').trim() || guessCategory(subject, input.originalQuestion || input.rawText),
        originalQuestion: String(input.originalQuestion || input.rawText || '').trim(),
        wrongAnswer: String(input.wrongAnswer || '').trim(),
        correctAnswer: String(input.correctAnswer || '').trim(),
        analysis: String(input.analysis || '').trim(),
        reviewTip: String(input.reviewTip || '').trim(),
        source: SOURCES.includes(input.source) ? input.source : 'manual',
        sourceKey: String(input.sourceKey || '').trim(),
        assignmentId: String(input.assignmentId || '').trim(),
        assignmentTitle: String(input.assignmentTitle || '').trim(),
        lastDictationResult: String(input.lastDictationResult || '').trim(),
        lastDictationFeedback: String(input.lastDictationFeedback || '').trim(),
        lastDictationAt: String(input.lastDictationAt || '').trim(),
        gradingResult: String(input.gradingResult || '').trim(),
        gradingEvidence: String(input.gradingEvidence || '').trim(),
        gradingConfidence: String(input.gradingConfidence || '').trim(),
        gradingTranscription: String(input.gradingTranscription || '').trim(),
        gradingErrorDetails: ensureArray(input.gradingErrorDetails).map(item => String(item).trim()).filter(Boolean),
        status: STATUSES.includes(input.status) ? input.status : '未复习',
        tags: normalizeTags(input.tags)
    };
}

export function createMistake(state, input) {
    const draft = normalizeDraft(input);
    if (!draft.originalQuestion) return { ok: false, error: '错题内容不能为空。' };
    const record = {
        id: makeId('mistake'),
        ...draft,
        reviewCount: 0,
        lastReviewedAt: null,
        relatedMistakeId: input.relatedMistakeId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    return { ok: true, record, state: addAudit({ ...state, mistakes: [record, ...ensureArray(state.mistakes)] }, '新增错题', record.originalQuestion) };
}

export function updateMistake(state, mistakeId, input) {
    const current = state.mistakes.find(item => item.id === mistakeId);
    if (!current) return { ok: false, error: '错题不存在。' };
    const next = {
        ...current,
        ...input,
        ...normalizeDraft({ ...current, ...input }),
        updatedAt: new Date().toISOString()
    };
    return {
        ok: true,
        record: next,
        state: addAudit({ ...state, mistakes: state.mistakes.map(item => item.id === mistakeId ? next : item) }, '更新错题', next.originalQuestion)
    };
}

export function deleteMistake(state, mistakeId) {
    const target = state.mistakes.find(item => item.id === mistakeId);
    if (!target) return { ok: false, error: '错题不存在。' };
    return {
        ok: true,
        state: addAudit({
            ...state,
            mistakes: state.mistakes.filter(item => item.id !== mistakeId).map(item => item.relatedMistakeId === mistakeId ? { ...item, relatedMistakeId: null } : item)
        }, '删除错题', target.originalQuestion)
    };
}

export function upsertDictationMistake(state, input) {
    const sourceKey = String(input.sourceKey || '').trim();
    const current = sourceKey ? state.mistakes.find(item => item.sourceKey === sourceKey) : null;
    if (current) {
        return updateMistake(state, current.id, {
            ...input,
            source: 'dictation',
            sourceKey,
            status: '需再次复习',
            lastDictationResult: 'wrong',
            lastDictationAt: new Date().toISOString()
        });
    }
    return createMistake(state, {
        ...input,
        source: 'dictation',
        sourceKey,
        status: '需再次复习',
        lastDictationResult: 'wrong',
        lastDictationAt: new Date().toISOString()
    });
}

export function resolveDictationMistake(state, sourceKey, feedback = '') {
    const current = state.mistakes.find(item => item.sourceKey === sourceKey);
    if (!current) return { ok: true, state, record: null };
    return updateMistake(state, current.id, {
        ...current,
        status: '已掌握',
        lastDictationResult: 'correct',
        lastDictationFeedback: feedback,
        lastDictationAt: new Date().toISOString()
    });
}

export function filterMistakes(state, filters = {}) {
    const keyword = String(filters.keyword || '').trim().toLowerCase();
    return ensureArray(state.mistakes).filter(item => {
        if (filters.startDate && item.recordDate < filters.startDate) return false;
        if (filters.endDate && item.recordDate > filters.endDate) return false;
        if (filters.subject && filters.subject !== 'all' && item.subject !== filters.subject) return false;
        if (filters.status && filters.status !== 'all' && item.status !== filters.status) return false;
        if (keyword && ![item.originalQuestion, item.wrongAnswer, item.correctAnswer, item.category, ...(item.tags || [])].join(' ').toLowerCase().includes(keyword)) return false;
        return true;
    }).sort((a, b) => b.recordDate.localeCompare(a.recordDate) || b.createdAt.localeCompare(a.createdAt));
}

export function detectDuplicates(state, input, threshold = 0.58) {
    const draft = normalizeDraft(input);
    if (!draft.originalQuestion) return [];
    return ensureArray(state.mistakes)
        .map(record => {
            const score = Math.min(1,
                similarity(record.originalQuestion, draft.originalQuestion) * 0.55 +
                similarity(record.wrongAnswer, draft.wrongAnswer) * 0.12 +
                (record.subject === draft.subject ? 0.2 : 0) +
                (record.category === draft.category ? 0.13 : 0)
            );
            return { record, score };
        })
        .filter(item => item.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
}

export function startReviewSession(state, mistakeIds) {
    const ids = [...new Set(ensureArray(mistakeIds).filter(Boolean))];
    if (!ids.length) return { ok: false, error: '没有可复习的错题。' };
    const session = {
        id: makeId('review_session'),
        mistakeIds: ids,
        reviewedMistakeIds: [],
        skippedMistakeIds: [],
        correctMistakeIds: [],
        incorrectMistakeIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null
    };
    return { ok: true, session, state: addAudit({ ...state, reviewSessions: [session, ...state.reviewSessions] }, '开始复习', `${ids.length} 题`) };
}

export function getTodayReviewMistakeIds(state) {
    return ensureArray(state.mistakes)
        .filter(item => item.status === '需再次复习' || item.status === '未复习')
        .sort((a, b) => {
            const priority = (a.status === '需再次复习' ? 0 : 1) - (b.status === '需再次复习' ? 0 : 1);
            if (priority !== 0) return priority;
            return a.recordDate.localeCompare(b.recordDate);
        })
        .map(item => item.id);
}

export function getReviewProgress(session) {
    const reviewed = new Set(ensureArray(session?.reviewedMistakeIds));
    const pendingMistakeIds = ensureArray(session?.mistakeIds).filter(id => !reviewed.has(id));
    return {
        totalCount: ensureArray(session?.mistakeIds).length,
        reviewedCount: reviewed.size,
        pendingCount: pendingMistakeIds.length,
        pendingMistakeIds,
        isComplete: ensureArray(session?.mistakeIds).length > 0 && pendingMistakeIds.length === 0
    };
}

export function summarizeReviewSession(state, sessionId) {
    const session = state.reviewSessions.find(item => item.id === sessionId);
    if (!session) {
        return { totalCount: 0, correctCount: 0, wrongCount: 0, skippedCount: 0, masteredCount: 0, needReviewCount: 0 };
    }
    const ids = new Set(session.mistakeIds || []);
    const attempts = ensureArray(state.reviewAttempts).filter(item => item.sessionId === sessionId);
    return {
        totalCount: ids.size,
        correctCount: attempts.filter(item => item.isCorrect).length,
        wrongCount: attempts.filter(item => !item.isCorrect).length,
        skippedCount: ensureArray(session.skippedMistakeIds).length,
        masteredCount: state.mistakes.filter(item => ids.has(item.id) && item.status === '已掌握').length,
        needReviewCount: state.mistakes.filter(item => ids.has(item.id) && item.status === '需再次复习').length
    };
}

export function submitReviewAnswer(state, sessionId, mistakeId, userAnswer, judgement = null) {
    const session = state.reviewSessions.find(item => item.id === sessionId);
    const mistake = state.mistakes.find(item => item.id === mistakeId);
    if (!session || !mistake) return { ok: false, error: '复习记录不存在。' };
    const isCorrect = typeof judgement?.isCorrect === 'boolean'
        ? judgement.isCorrect
        : normalizeText(userAnswer) && normalizeText(userAnswer) === normalizeText(mistake.correctAnswer || mistake.originalQuestion);
    const attempt = {
        id: makeId('review_attempt'),
        sessionId,
        mistakeId,
        userAnswer: String(userAnswer || '').trim(),
        correctAnswerSnapshot: mistake.correctAnswer || mistake.originalQuestion,
        isCorrect,
        judgementSource: judgement?.source || 'local',
        feedback: String(judgement?.feedback || '').trim(),
        createdAt: new Date().toISOString()
    };
    const reviewedMistakeIds = [...new Set([...session.reviewedMistakeIds, mistakeId])];
    const nextSession = {
        ...session,
        reviewedMistakeIds,
        correctMistakeIds: isCorrect ? [...new Set([...session.correctMistakeIds, mistakeId])] : session.correctMistakeIds.filter(id => id !== mistakeId),
        incorrectMistakeIds: isCorrect ? session.incorrectMistakeIds.filter(id => id !== mistakeId) : [...new Set([...session.incorrectMistakeIds, mistakeId])],
        updatedAt: new Date().toISOString()
    };
    const progress = getReviewProgress(nextSession);
    if (progress.isComplete) nextSession.completedAt = new Date().toISOString();
    const nextMistake = {
        ...mistake,
        status: (judgement?.shouldMaster && isCorrect) ? '已掌握' : (isCorrect ? '已复习' : '需再次复习'),
        reviewCount: Number(mistake.reviewCount || 0) + 1,
        lastReviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    return {
        ok: true,
        attempt,
        session: nextSession,
        state: {
            ...state,
            mistakes: state.mistakes.map(item => item.id === mistakeId ? nextMistake : item),
            reviewSessions: state.reviewSessions.map(item => item.id === sessionId ? nextSession : item),
            reviewAttempts: [attempt, ...state.reviewAttempts]
        }
    };
}

export function summarizeWeakPoints(mistakes, options = {}) {
    const records = ensureArray(mistakes).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.recordDate));
    const minSample = options.minSample || 3;
    const groups = new Map();
    records.forEach(item => {
        const key = `${item.subject}__${item.category}`;
        const current = groups.get(key) || { subject: item.subject, category: item.category, count: 0, wrong: 0, dates: [] };
        current.count += 1;
        if (item.status === '需再次复习' || item.status === '未复习') current.wrong += 1;
        current.dates.push(item.recordDate);
        groups.set(key, current);
    });
    const highFrequency = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 6);
    const needReview = records.filter(item => item.status === '需再次复习').slice(0, 10);
    return {
        sufficient: records.length >= minSample,
        sampleCount: records.length,
        minSample,
        highFrequency,
        needReview,
        patterns: highFrequency.filter(item => item.count >= 2).map(item => ({
            label: `${item.subject} - ${item.category}`,
            count: item.count,
            hint: item.wrong ? '需要优先复习' : '保持巩固'
        }))
    };
}

export function getDateRangeByCycle(cycle) {
    const current = today();
    if (cycle === 'day') return { startDate: current, endDate: current };
    if (cycle === 'week') return { startDate: dateDaysAgo(6), endDate: current };
    if (cycle === 'month') return { startDate: monthStart(), endDate: current };
    return { startDate: '', endDate: '' };
}

export function buildExportPayload(state, filters = {}) {
    const mistakes = filterMistakes(state, filters)
        .filter(item => !filters.excludeMastered || item.status !== '已掌握')
        .map(item => ({
            ...item,
            storyExplanation: filters.includeStories === false ? null : item.storyExplanation,
            transferPractices: filters.includePractices === false ? [] : item.transferPractices
        }));
    const sorted = filters.prioritizeNeedReview
        ? mistakes.slice().sort((a, b) => (a.status === '需再次复习' ? 0 : 1) - (b.status === '需再次复习' ? 0 : 1) || a.recordDate.localeCompare(b.recordDate))
        : mistakes;
    return { mistakes: sorted, exportedAt: new Date().toISOString(), filters, template: filters.template || 'detailed' };
}

export function generateMarkdown(payload, childName = '孩子') {
    const lines = [`# ${childName}错题本`, '', `导出时间：${new Date(payload.exportedAt).toLocaleString()}`, '', `错题数量：${payload.mistakes.length}`, ''];
    payload.mistakes.forEach((item, index) => {
        lines.push(`## ${index + 1}. ${item.category}（${item.recordDate}）`);
        lines.push(`- 学科：${item.subject}`);
        lines.push(`- 状态：${item.status}`);
        lines.push(`- 原题：${item.originalQuestion || '（空）'}`);
        lines.push(`- 错答：${item.wrongAnswer || '（空）'}`);
        lines.push(`- 正答：${item.correctAnswer || '（空）'}`);
        if (payload.template !== 'compact') {
            lines.push(`- 解析：${item.analysis || '（空）'}`);
            lines.push(`- 建议：${item.reviewTip || '（空）'}`);
        }
        lines.push(`- 标签：${item.tags?.length ? item.tags.join('、') : '（空）'}`);
        if (item.storyExplanation) {
            lines.push(`- 故事标题：${item.storyExplanation.storyTitle || '（空）'}`);
            lines.push(`- 为什么错：${item.storyExplanation.whyWrong || '（空）'}`);
            lines.push(`- 故事讲解：${item.storyExplanation.story || '（空）'}`);
            if (item.storyExplanation.steps?.length) {
                item.storyExplanation.steps.forEach((step, stepIndex) => lines.push(`  ${stepIndex + 1}. ${step}`));
            }
            if (item.storyExplanation.diagram) lines.push(`- 示意图：${summarizeDiagram(item.storyExplanation.diagram)}`);
            lines.push(`- 记忆窍门：${item.storyExplanation.memoryTip || '（空）'}`);
            lines.push(`- 同类练习：${item.storyExplanation.miniPractice || '（空）'}`);
            lines.push(`- 练习答案：${item.storyExplanation.answer || '（空）'}`);
            lines.push(`- 家长提醒：${item.storyExplanation.parentTip || '（空）'}`);
        }
        if (item.transferPractices?.length) {
            lines.push(`- 举一反三练习：`);
            item.transferPractices.forEach((practice, practiceIndex) => {
                lines.push(`  ${practiceIndex + 1}. ${practice.question || '（空）'}`);
                lines.push(`     - 提示：${practice.hint || '（空）'}`);
                lines.push(`     - 答案：${practice.answer || '（空）'}`);
                if (practice.diagram) lines.push(`     - 示意图：${summarizeDiagram(practice.diagram)}`);
                lines.push(`     - 孩子答案：${practice.childAnswer || '（未作答）'}`);
                lines.push(`     - 结果：${practice.result || 'pending'}`);
                lines.push(`     - 反馈：${practice.feedback || '（空）'}`);
            });
        }
        lines.push('');
    });
    return lines.join('\n');
}

export function generateText(payload, childName = '孩子') {
    const lines = [`${childName}错题本`, `导出时间：${new Date(payload.exportedAt).toLocaleString()}`, `错题数量：${payload.mistakes.length}`, ''];
    payload.mistakes.forEach((item, index) => {
        lines.push(`${index + 1}. ${item.category}（${item.recordDate}）`);
        lines.push(`学科：${item.subject}`);
        lines.push(`状态：${item.status}`);
        lines.push(`原题：${item.originalQuestion || '（空）'}`);
        lines.push(`错答：${item.wrongAnswer || '（空）'}`);
        lines.push(`正答：${item.correctAnswer || '（空）'}`);
        if (payload.template !== 'compact') {
            lines.push(`解析：${item.analysis || '（空）'}`);
            lines.push(`建议：${item.reviewTip || '（空）'}`);
        }
        if (item.storyExplanation) {
            lines.push(`故事标题：${item.storyExplanation.storyTitle || '（空）'}`);
            lines.push(`为什么错：${item.storyExplanation.whyWrong || '（空）'}`);
            lines.push(`故事讲解：${item.storyExplanation.story || '（空）'}`);
            if (item.storyExplanation.steps?.length) {
                item.storyExplanation.steps.forEach((step, stepIndex) => lines.push(`${stepIndex + 1}. ${step}`));
            }
            if (item.storyExplanation.diagram) lines.push(`示意图：${summarizeDiagram(item.storyExplanation.diagram)}`);
            lines.push(`记忆窍门：${item.storyExplanation.memoryTip || '（空）'}`);
            lines.push(`同类练习：${item.storyExplanation.miniPractice || '（空）'}`);
            lines.push(`练习答案：${item.storyExplanation.answer || '（空）'}`);
            lines.push(`家长提醒：${item.storyExplanation.parentTip || '（空）'}`);
        }
        if (item.transferPractices?.length) {
            lines.push('举一反三练习：');
            item.transferPractices.forEach((practice, practiceIndex) => {
                lines.push(`${practiceIndex + 1}. ${practice.question || '（空）'}`);
                lines.push(`提示：${practice.hint || '（空）'}`);
                lines.push(`答案：${practice.answer || '（空）'}`);
                if (practice.diagram) lines.push(`示意图：${summarizeDiagram(practice.diagram)}`);
                lines.push(`孩子答案：${practice.childAnswer || '（未作答）'}`);
                lines.push(`结果：${practice.result || 'pending'}`);
                lines.push(`反馈：${practice.feedback || '（空）'}`);
            });
        }
        lines.push('');
    });
    return lines.join('\n');
}

export function openPrintableReview(payload, childName = '孩子') {
    const escape = (value) => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const rows = payload.mistakes.map((item, index) => `
        <section class="item">
            <h2>${index + 1}. ${escape(item.category)}（${escape(item.recordDate)}）</h2>
            <p><b>学科：</b>${escape(item.subject)}　<b>状态：</b>${escape(item.status)}</p>
            <p><b>原题：</b>${escape(item.originalQuestion) || '（空）'}</p>
            <p class="blank"><b>重做：</b></p>
            <p><b>错答：</b>${escape(item.wrongAnswer) || '（空）'}</p>
            <p><b>正答：</b>${escape(item.correctAnswer) || '（空）'}</p>
            ${payload.template !== 'compact' ? `<p><b>解析：</b>${escape(item.analysis) || '（空）'}</p><p><b>建议：</b>${escape(item.reviewTip) || '（空）'}</p>` : ''}
            ${item.storyExplanation ? `
            <div class="story">
                <h3>${escape(item.storyExplanation.storyTitle)}</h3>
                <p><b>为什么错：</b>${escape(item.storyExplanation.whyWrong)}</p>
                <p><b>故事讲解：</b>${escape(item.storyExplanation.story)}</p>
                ${item.storyExplanation.steps?.length ? `<ol>${item.storyExplanation.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol>` : ''}
                ${item.storyExplanation.diagram ? `<p><b>示意图：</b>${escape(summarizeDiagram(item.storyExplanation.diagram))}</p>` : ''}
                <p><b>记忆窍门：</b>${escape(item.storyExplanation.memoryTip)}</p>
                <p><b>同类练习：</b>${escape(item.storyExplanation.miniPractice)}</p>
                <p><b>练习答案：</b>${escape(item.storyExplanation.answer) || '（空）'}</p>
                <p><b>家长提醒：</b>${escape(item.storyExplanation.parentTip)}</p>
            </div>` : ''}
            ${item.transferPractices?.length ? `
            <div class="practice">
                <h3>举一反三练习</h3>
                ${item.transferPractices.map((practice, practiceIndex) => `
                    <div class="practice-item">
                        <p><b>${practiceIndex + 1}. 题目：</b>${escape(practice.question)}</p>
                        <p><b>提示：</b>${escape(practice.hint) || '（空）'}</p>
                        <p><b>答案：</b>${escape(practice.answer) || '（空）'}</p>
                        ${practice.diagram ? `<p><b>示意图：</b>${escape(summarizeDiagram(practice.diagram))}</p>` : ''}
                        <p><b>孩子答案：</b>${escape(practice.childAnswer) || '（未作答）'}</p>
                        <p><b>结果：</b>${escape(practice.result || 'pending')}　<b>反馈：</b>${escape(practice.feedback) || '（空）'}</p>
                    </div>
                `).join('')}
            </div>` : ''}
        </section>
    `).join('');
    const win = window.open('', '_blank');
    if (!win) return false;
    win.document.write(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escape(childName)}错题本</title>
<style>
body{font-family:"Microsoft YaHei",Arial,sans-serif;color:#1f2937;margin:32px;line-height:1.6}
h1{font-size:24px;margin:0 0 8px}.meta{color:#64748b;margin-bottom:24px}.item{break-inside:avoid;border-top:1px solid #e5e7eb;padding:16px 0}
h2{font-size:18px;margin:0 0 8px}.blank{min-height:56px;border:1px dashed #cbd5e1;border-radius:8px;padding:8px}.story{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px;margin-top:10px}.story h3,.practice h3{margin:0 0 6px}.story h3{color:#166534}.practice{background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px;margin-top:10px}.practice h3{color:#1d4ed8}.practice-item{border-top:1px solid #dbeafe;padding-top:8px;margin-top:8px}
@media print{button{display:none}body{margin:18mm}.item{page-break-inside:avoid}}
</style>
</head>
<body>
<button onclick="window.print()">打印 / 保存 PDF</button>
<h1>${escape(childName)}错题本</h1>
<div class="meta">导出时间：${new Date(payload.exportedAt).toLocaleString()}　错题数量：${payload.mistakes.length}</div>
${rows || '<p>暂无错题</p>'}
</body>
</html>`);
    win.document.close();
    return true;
}

export function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // 延迟释放：Safari/Firefox 在同步 revoke 时可能导致下载失败
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function parseAiMistakeDrafts(text) {
    const clean = String(text || '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : [parsed]);
    return items.map(normalizeDraft).filter(item => item.originalQuestion);
}
