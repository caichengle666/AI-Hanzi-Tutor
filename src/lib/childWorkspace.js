const DB_NAME = 'ai_hanzi_tutor';
const STORE_NAME = 'child_workspaces';
const DB_VERSION = 1;
export const EMPTY_UPDATED_AT = '1970-01-01T00:00:00.000Z';
const cache = new Map();
const loading = new Map();
const writeQueues = new Map();
const writeStatus = new Map();
const persistListeners = new Set();

// 云同步用：本地每次保存成功后通知（不含从云端拉下来的写入，避免回环）
export function onWorkspacePersisted(listener) {
    persistListeners.add(listener);
    return () => persistListeners.delete(listener);
}

const legacyFields = {
    stars: { scoped: id => `app_stars_${id}`, legacy: 'app_stars', parse: value => String(value || '0') },
    hanziCards: { scoped: id => `hanzi_cards_${id}`, legacy: 'hanzi_cards' },
    dictationWords: { scoped: id => `dictation_words_${id}`, legacy: 'dictation_words' },
    dictationHistory: { scoped: id => `dictation_history_${id}` },
    dictationWrong: { scoped: id => `dictation_wrong_${id}` },
    reviewNotebook: { scoped: id => `review_notebook_${id}` },
    englishDictationItems: { scoped: id => `english_dictation_items_${id}` },
    englishWrongItems: { scoped: id => `english_wrong_items_${id}` },
    englishDictationHistory: { scoped: id => `english_dictation_history_${id}` },
    englishConversationHistory: { scoped: id => `english_conversation_history_${id}` },
    studyReminder: { scoped: id => `study_reminder_${id}` }
};

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function parseLegacyValue(raw, field) {
    if (raw === null) return undefined;
    if (field.parse) return field.parse(raw);
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

function migrateLegacyWorkspace(profileId) {
    const data = {};
    Object.entries(legacyFields).forEach(([key, field]) => {
        const scoped = parseLegacyValue(localStorage.getItem(field.scoped(profileId)), field);
        if (scoped !== undefined) {
            data[key] = scoped;
            return;
        }
        if (profileId === 'default' && field.legacy) {
            const legacy = parseLegacyValue(localStorage.getItem(field.legacy), field);
            if (legacy !== undefined) data[key] = legacy;
        }
    });
    return data;
}

function fallbackKey(profileId) {
    return `child_workspace_v2_${profileId}`;
}

function openDatabase() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                request.result.createObjectStore(STORE_NAME, { keyPath: 'profileId' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function readWorkspace(profileId) {
    const db = await openDatabase();
    if (!db) {
        try { return JSON.parse(localStorage.getItem(fallbackKey(profileId)) || 'null'); } catch { return null; }
    }
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(profileId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function writeWorkspace(workspace) {
    const db = await openDatabase();
    if (!db) {
        localStorage.setItem(fallbackKey(workspace.profileId), JSON.stringify(workspace));
        return;
    }
    await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(workspace);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('数据保存被中止。'));
    });
}

function persist(profileId) {
    const workspace = cache.get(profileId);
    if (!workspace) return Promise.resolve();
    workspace.updatedAt = new Date().toISOString();
    workspace.revision = (workspace.revision || 0) + 1;
    const snapshot = clone(workspace);
    const previous = writeQueues.get(profileId) || Promise.resolve();
    const task = previous
        .catch(() => {})
        .then(() => writeWorkspace(snapshot))
        .then(() => {
            const status = writeStatus.get(profileId);
            if (!status || status.revision <= snapshot.revision) {
                writeStatus.set(profileId, { state: 'saved', revision: snapshot.revision, error: null });
            }
            persistListeners.forEach(listener => {
                try { listener(profileId, snapshot); } catch { /* 同步失败不影响本地保存 */ }
            });
        })
        .catch(error => {
            writeStatus.set(profileId, { state: 'error', revision: snapshot.revision, error });
            return { ok: false, error };
        });
    writeQueues.set(profileId, task);
    return task;
}

export async function hydrateChildWorkspace(profileId) {
    if (cache.has(profileId)) return cache.get(profileId);
    if (loading.has(profileId)) return loading.get(profileId);

    const task = (async () => {
        try {
            let workspace = await readWorkspace(profileId);
            if (!workspace) {
                const migrated = migrateLegacyWorkspace(profileId);
                const now = new Date().toISOString();
                workspace = {
                    profileId,
                    schemaVersion: 2,
                    revision: 0,
                    createdAt: now,
                    // 空工作区记成“最早”，这样云端已有的数据一定比它新，不会被空数据覆盖
                    updatedAt: Object.keys(migrated).length ? now : EMPTY_UPDATED_AT,
                    data: migrated
                };
                await writeWorkspace(workspace);
            }
            const normalized = {
                profileId,
                schemaVersion: 2,
                revision: Number.isInteger(workspace.revision) ? workspace.revision : 0,
                createdAt: workspace.createdAt || new Date().toISOString(),
                updatedAt: workspace.updatedAt || new Date().toISOString(),
                data: workspace.data && typeof workspace.data === 'object' ? workspace.data : {}
            };
            cache.set(profileId, normalized);
            writeStatus.set(profileId, { state: 'saved', revision: normalized.revision, error: null });
            return normalized;
        } finally {
            loading.delete(profileId);
        }
    })();
    loading.set(profileId, task);
    return task;
}

export function getChildValue(profileId, key, fallback) {
    const workspace = cache.get(profileId);
    if (!workspace || !hasOwn(workspace.data, key)) return clone(fallback);
    return clone(workspace.data[key]);
}

export function setChildValue(profileId, key, value) {
    const workspace = cache.get(profileId);
    if (!workspace) return;
    // 值没变就不保存：避免每次打开页面都刷新 updatedAt，导致云同步误判“本机更新”
    if (hasOwn(workspace.data, key) && JSON.stringify(workspace.data[key]) === JSON.stringify(value)) return;
    workspace.data[key] = clone(value);
    // Callers often invoke this from a React effect. Do not return the write
    // promise, because React would treat it as an effect cleanup callback.
    persist(profileId);
}

export function getChildWorkspaceStatus(profileId) {
    const status = writeStatus.get(profileId);
    return status ? { ...status } : { state: 'idle', revision: 0, error: null };
}

export async function flushChildWorkspace(profileId) {
    await (writeQueues.get(profileId) || Promise.resolve());
}

export function retryChildWorkspace(profileId) {
    return persist(profileId);
}

export function getChildWorkspaceData(profileId) {
    return clone(cache.get(profileId)?.data || {});
}

export async function replaceChildWorkspaceData(profileId, data) {
    const workspace = {
        profileId,
        schemaVersion: 2,
        createdAt: cache.get(profileId)?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revision: (cache.get(profileId)?.revision || 0) + 1,
        data: clone(data || {})
    };
    cache.set(profileId, workspace);
    const result = await persist(profileId);
    if (result?.ok === false) throw result.error;
    return workspace;
}

export function getChildWorkspaceMeta(profileId) {
    const workspace = cache.get(profileId);
    return workspace ? { updatedAt: workspace.updatedAt, revision: workspace.revision } : null;
}

// 读取本机已保存的工作区（不进内存缓存），云同步上传未打开过的孩子时使用
export async function readStoredChildWorkspace(profileId) {
    if (cache.has(profileId)) return clone(cache.get(profileId));
    return readWorkspace(profileId);
}

// 采用云端版本：只在云端比本地新时写入本地，不触发再次上传。返回是否已采用。
export async function applyRemoteWorkspace(profileId, remote) {
    if (!remote || !remote.updatedAt || !remote.data || typeof remote.data !== 'object') return false;
    await flushChildWorkspace(profileId);
    const local = cache.get(profileId) || await readWorkspace(profileId);
    if (local?.updatedAt && local.updatedAt >= remote.updatedAt) return false;
    const workspace = {
        profileId,
        schemaVersion: 2,
        createdAt: local?.createdAt || remote.updatedAt,
        updatedAt: remote.updatedAt,
        revision: (local?.revision || 0) + 1,
        data: clone(remote.data)
    };
    await writeWorkspace(workspace);
    cache.set(profileId, workspace);
    writeStatus.set(profileId, { state: 'saved', revision: workspace.revision, error: null });
    return true;
}
