export function defaultReminder() {
    return {
        enabled: false,
        time: '19:30',
        message: '今天还有学习任务，来复习一下吧。',
        lastNotifiedDate: ''
    };
}

export function loadReminder(profileId) {
    try {
        return { ...defaultReminder(), ...getChildValue(profileId, 'studyReminder', null) };
    } catch {
        return defaultReminder();
    }
}

export function saveReminder(profileId, reminder) {
    const next = { ...defaultReminder(), ...reminder };
    setChildValue(profileId, 'studyReminder', next);
    return next;
}

function todayText() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function minutesOf(time) {
    const [hourText, minuteText] = String(time || '19:30').split(':');
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return 19 * 60 + 30;
    return hour * 60 + minute;
}

export function shouldNotify(reminder, now = new Date()) {
    const config = { ...defaultReminder(), ...reminder };
    if (!config.enabled) return false;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return currentMinutes >= minutesOf(config.time) && config.lastNotifiedDate !== todayText();
}

export async function notifyStudyReminder(profileId, childName, reminder) {
    const config = { ...defaultReminder(), ...reminder };
    const title = `${childName || '孩子'}学习提醒`;
    const message = config.message || defaultReminder().message;

    let notified = false;
    if ('Notification' in window) {
        if (Notification.permission === 'default') {
            await Notification.requestPermission();
        }
        if (Notification.permission === 'granted') {
            new Notification(title, { body: message, icon: '/apple-touch-icon.png' });
            notified = true;
        }
    }

    // 系统通知发出后不再弹 alert，避免双重打扰；只在通知不可用时降级
    if (!notified) alert(`${title}\n${message}`);
    return saveReminder(profileId, { ...config, lastNotifiedDate: todayText() });
}
import { getChildValue, setChildValue } from './childWorkspace.js';
