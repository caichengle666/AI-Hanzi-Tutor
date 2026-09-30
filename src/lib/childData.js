import { getChildWorkspaceData, replaceChildWorkspaceData } from './childWorkspace.js';

const CURRENT_BACKUP_VERSION = 2;
const ARRAY_FIELDS = [
    'hanziCards',
    'dictationWords',
    'dictationHistory',
    'dictationWrong',
    'englishDictationItems',
    'englishWrongItems',
    'englishDictationHistory',
    'englishConversationHistory',
    'assignments'
];

function countItems(value) {
    return Array.isArray(value) ? value.length : 0;
}

function migrateBackup(parsed) {
    if (parsed.version === 1) {
        return { ...parsed, version: 2, data: { ...parsed.data } };
    }
    return parsed;
}

export function parseChildBackup(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, error: '文件不是有效的 JSON 备份。' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: '备份文件格式不正确。' };
    }
    if (!Number.isInteger(parsed.version) || parsed.version < 1) {
        return { ok: false, error: '备份文件缺少版本信息。' };
    }
    if (parsed.version > CURRENT_BACKUP_VERSION) {
        return { ok: false, error: '这个备份来自更新版本的应用，当前版本无法安全恢复。' };
    }
    if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
        return { ok: false, error: '备份文件缺少孩子学习数据。' };
    }
    const invalidArrayField = ARRAY_FIELDS.find(key => parsed.data[key] !== undefined && !Array.isArray(parsed.data[key]));
    if (invalidArrayField) return { ok: false, error: `备份中的 ${invalidArrayField} 数据格式不正确。` };
    if (parsed.data.reviewNotebook !== undefined && parsed.data.reviewNotebook !== null && typeof parsed.data.reviewNotebook !== 'object') {
        return { ok: false, error: '备份中的错题本数据格式不正确。' };
    }
    const migrated = migrateBackup(parsed);
    return {
        ok: true,
        backup: {
            version: CURRENT_BACKUP_VERSION,
            exportedAt: migrated.exportedAt || '',
            profile: migrated.profile && typeof migrated.profile === 'object' ? migrated.profile : {},
            data: migrated.data
        }
    };
}

export function describeChildBackup(backup) {
    const data = backup.data || {};
    return {
        childName: String(backup.profile?.name || '未命名孩子'),
        exportedAt: backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : '未知时间',
        hanziCards: countItems(data.hanziCards),
        chineseWords: countItems(data.dictationWords),
        englishItems: countItems(data.englishDictationItems),
        mistakes: countItems(data.reviewNotebook?.mistakes)
    };
}

export function collectChildData(profile) {
    return {
        version: CURRENT_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        profile,
        data: getChildWorkspaceData(profile.id)
    };
}

export async function restoreChildData(profileId, backup) {
    const parsed = parseChildBackup(JSON.stringify(backup));
    if (!parsed.ok) throw new Error(parsed.error);
    await replaceChildWorkspaceData(profileId, parsed.backup.data);
}

export function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
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
