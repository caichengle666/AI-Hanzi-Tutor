import { describe, expect, it } from 'vitest';
import { normalizeOpenAIUrl } from '../llm.js';
import { parsePracticeCheck } from '../transferPractice.js';
import { submitReviewAnswer, summarizeReviewSession } from '../reviewNotebook.js';
import { parseEnglishItems } from '../../components/EnglishDictationMode.jsx';

describe('normalizeOpenAIUrl', () => {
    it('空地址回退到官方默认', () => {
        expect(normalizeOpenAIUrl('')).toBe('https://api.openai.com/v1/chat/completions');
        expect(normalizeOpenAIUrl('   ')).toBe('https://api.openai.com/v1/chat/completions');
    });
    it('/v1 结尾自动补全 chat/completions', () => {
        expect(normalizeOpenAIUrl('https://api.deepseek.com/v1'))
            .toBe('https://api.deepseek.com/v1/chat/completions');
    });
    it('/v1/ 尾斜杠同样能规范化（回归：之前漏掉）', () => {
        expect(normalizeOpenAIUrl('https://api.deepseek.com/v1/'))
            .toBe('https://api.deepseek.com/v1/chat/completions');
    });
    it('已完整的地址保持不变', () => {
        const full = 'https://api.openai.com/v1/chat/completions';
        expect(normalizeOpenAIUrl(full)).toBe(full);
        expect(normalizeOpenAIUrl(full + '/')).toBe(full);
    });
});

describe('parsePracticeCheck', () => {
    it('correct + shouldMaster:true 透出已掌握信号', () => {
        const r = parsePracticeCheck(JSON.stringify({ result: 'correct', feedback: '好', shouldMaster: true }));
        expect(r.result).toBe('correct');
        expect(r.shouldMaster).toBe(true);
    });
    it('wrong 时 shouldMaster 被强制为 false', () => {
        const r = parsePracticeCheck(JSON.stringify({ result: 'wrong', feedback: '差', shouldMaster: true }));
        expect(r.result).toBe('wrong');
        expect(r.shouldMaster).toBe(false);
    });
    it('非法 result 回退为 uncertain', () => {
        const r = parsePracticeCheck(JSON.stringify({ result: 'nope', feedback: '' }));
        expect(r.result).toBe('uncertain');
        expect(r.shouldMaster).toBe(false);
    });
    it('兼容 ```json 代码块包裹', () => {
        const r = parsePracticeCheck('```json\n{"result":"correct","feedback":"棒"}\n```');
        expect(r.result).toBe('correct');
    });
});

function makeReviewState() {
    return {
        mistakes: [{ id: 'm1', subject: '语文', status: '未复习', reviewCount: 0, correctAnswer: '好', originalQuestion: '好' }],
        reviewSessions: [{ id: 's1', mistakeIds: ['m1'], reviewedMistakeIds: [], correctMistakeIds: [], incorrectMistakeIds: [] }],
        reviewAttempts: []
    };
}

describe('submitReviewAnswer shouldMaster', () => {
    it('AI 判定 shouldMaster 时状态为已掌握', () => {
        const r = submitReviewAnswer(makeReviewState(), 's1', 'm1', '好',
            { isCorrect: true, source: 'ai-text', feedback: '全对', shouldMaster: true });
        expect(r.ok).toBe(true);
        expect(r.state.mistakes[0].status).toBe('已掌握');
        const summary = summarizeReviewSession(r.state, 's1');
        expect(summary.masteredCount).toBe(1);
    });
    it('普通答对仍是已复习', () => {
        const r = submitReviewAnswer(makeReviewState(), 's1', 'm1', '好',
            { isCorrect: true, source: 'ai-text', feedback: '对' });
        expect(r.state.mistakes[0].status).toBe('已复习');
    });
    it('答错时即使带 shouldMaster 也不标记掌握', () => {
        const r = submitReviewAnswer(makeReviewState(), 's1', 'm1', '坏',
            { isCorrect: false, source: 'ai-text', feedback: '错', shouldMaster: true });
        expect(r.state.mistakes[0].status).toBe('需再次复习');
    });
});

describe('parseEnglishItems', () => {
    it('释义里的冒号不被截断（回归：之前 split 会丢掉）', () => {
        const items = parseEnglishItems('apple：苹果：一种水果');
        expect(items).toHaveLength(1);
        expect(items[0].text).toBe('apple');
        expect(items[0].meaning).toBe('苹果：一种水果');
    });
    it('JSON 数组格式正常解析', () => {
        const items = parseEnglishItems(JSON.stringify([{ text: 'cat', meaning: '猫' }]));
        expect(items[0]).toMatchObject({ text: 'cat', meaning: '猫' });
    });
    it('含空格的识别为句子', () => {
        const items = parseEnglishItems('I am happy');
        expect(items[0].type).toBe('sentence');
    });
});
