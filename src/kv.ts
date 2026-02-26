/**
 * KV storage helpers for state and config.
 */

import type { KVState, Config } from './types';

const STATE_KEY = 'state';

function isValidTimezone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat(undefined, { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}
const CONFIG_KEY = 'config';

const DEFAULT_STATE: KVState = {
	lastNotifiedSlots: [],
	bookedWeek: null,
	lastNotificationTimestamp: 0,
};

const DEFAULT_CONFIG: Config = {
	timeStartHour: 19,
	timeEndHour: 22,
	minBlockHours: 2,
	timezone: 'Australia/Perth',
};

export interface KVNamespaceBinding {
	get(key: string): Promise<string | null>;
	put(key: string, value: string): Promise<void>;
}

export async function getState(kv: KVNamespaceBinding): Promise<KVState> {
	const raw = await kv.get(STATE_KEY);
	if (!raw) return { ...DEFAULT_STATE };
	try {
		const parsed = JSON.parse(raw) as Partial<KVState>;
		return {
			lastNotifiedSlots: Array.isArray(parsed.lastNotifiedSlots) ? parsed.lastNotifiedSlots : DEFAULT_STATE.lastNotifiedSlots,
			bookedWeek: parsed.bookedWeek != null ? parsed.bookedWeek : DEFAULT_STATE.bookedWeek,
			lastNotificationTimestamp:
				typeof parsed.lastNotificationTimestamp === 'number' ? parsed.lastNotificationTimestamp : DEFAULT_STATE.lastNotificationTimestamp,
		};
	} catch {
		return { ...DEFAULT_STATE };
	}
}

export async function setState(kv: KVNamespaceBinding, state: Partial<KVState>): Promise<void> {
	const current = await getState(kv);
	const merged: KVState = {
		...current,
		...state,
	};
	await kv.put(STATE_KEY, JSON.stringify(merged));
}

export async function getConfig(kv: KVNamespaceBinding): Promise<Config> {
	const raw = await kv.get(CONFIG_KEY);
	if (!raw) return { ...DEFAULT_CONFIG };
	try {
		const parsed = JSON.parse(raw) as Partial<Config>;
		return {
			timeStartHour:
				typeof parsed.timeStartHour === 'number' && parsed.timeStartHour >= 0 && parsed.timeStartHour <= 23
					? parsed.timeStartHour
					: DEFAULT_CONFIG.timeStartHour,
			timeEndHour:
				typeof parsed.timeEndHour === 'number' && parsed.timeEndHour >= 0 && parsed.timeEndHour <= 23
					? parsed.timeEndHour
					: DEFAULT_CONFIG.timeEndHour,
			minBlockHours:
				typeof parsed.minBlockHours === 'number' && parsed.minBlockHours >= 0.5 && parsed.minBlockHours <= 8
					? parsed.minBlockHours
					: DEFAULT_CONFIG.minBlockHours,
			timezone: typeof parsed.timezone === 'string' && isValidTimezone(parsed.timezone) ? parsed.timezone : DEFAULT_CONFIG.timezone,
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export async function setConfig(kv: KVNamespaceBinding, updates: Partial<Config>): Promise<Config> {
	const current = await getConfig(kv);
	const merged: Config = {
		...current,
		...updates,
		...(updates.timezone !== undefined && !isValidTimezone(updates.timezone) ? { timezone: current.timezone } : {}),
	};
	await kv.put(CONFIG_KEY, JSON.stringify(merged));
	return merged;
}
