import { writable, get } from 'svelte/store';
import type { Writable } from 'svelte/store';

// 创建一个可写的 store 来存储设置
export const settingsStore: Writable<any> = writable({});

// 更新设置的辅助函数
export function updateSettings(newSettings: any) {
    settingsStore.set(newSettings);
}

// 获取当前设置的辅助函数
export function getSettings(): Promise<any> {
    // 使用 get() 直接读取当前值，避免 subscribe 立即同步回调导致的 TDZ（Cannot access 'unsubscribe' before initialization）。
    return Promise.resolve(get(settingsStore));
}
