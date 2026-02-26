/**
 * Cron scheduler: fetches booking API, diffs against KV, sends Discord notifications.
 */

import { fetchAvailability, extractQualifyingBlocks, getRemainingWeekDates, getCurrentISOWeek } from './booking';
import { getState, setState, getConfig } from './kv';
import { sendWebhookMessage, formatBlocksMessage } from './discord';
import type { CourtBlock, SlotId } from './types';

const COOLDOWN_MS = 30 * 60 * 1000;

export type SchedulerEnv = import('./env').WorkerEnv;

export async function runScheduler(env: SchedulerEnv): Promise<void> {
	try {
		const [state, config] = await Promise.all([getState(env.BADMINTON_KV), getConfig(env.BADMINTON_KV)]);

		const currentWeek = getCurrentISOWeek(config.timezone);
		if (state.bookedWeek === currentWeek) {
			console.log('[scheduler] Skipping: booked for current week');
			return;
		}

		const dates = getRemainingWeekDates(config.timezone);
		const allBlocks: CourtBlock[] = [];

		for (const date of dates) {
			try {
				const resp = await fetchAvailability(date);
				if (resp.data) {
					const blocks = extractQualifyingBlocks(date, resp.data, config);
					allBlocks.push(...blocks);
				}
			} catch (err) {
				console.error(`[scheduler] API error for ${date}:`, err);
			}
		}

		const qualifyingSlotIds = new Set<SlotId>();
		for (const b of allBlocks) {
			for (const id of b.slotIds) {
				qualifyingSlotIds.add(id);
			}
		}

		const lastSet = new Set(state.lastNotifiedSlots);
		const newSlots = [...qualifyingSlotIds].filter((id) => !lastSet.has(id));

		if (newSlots.length === 0) {
			if (qualifyingSlotIds.size < lastSet.size) {
				await setState(env.BADMINTON_KV, {
					lastNotifiedSlots: [...qualifyingSlotIds],
				});
				console.log('[scheduler] Updated KV: removed booked slots');
			}
			return;
		}

		const now = Date.now();
		if (now - state.lastNotificationTimestamp < COOLDOWN_MS) {
			await setState(env.BADMINTON_KV, {
				lastNotifiedSlots: [...qualifyingSlotIds],
			});
			console.log('[scheduler] Cooldown active, updated slots only');
			return;
		}

		const newSlotSet = new Set(newSlots);
		const blocksToNotify = allBlocks.filter((b) => b.slotIds.some((id) => newSlotSet.has(id)));

		const message = formatBlocksMessage(blocksToNotify);
		const ok = await sendWebhookMessage(env.DISCORD_WEBHOOK_URL, message);
		if (!ok) {
			console.error('[scheduler] Failed to send webhook');
			return;
		}

		await setState(env.BADMINTON_KV, {
			lastNotifiedSlots: [...qualifyingSlotIds],
			lastNotificationTimestamp: now,
		});
		console.log('[scheduler] Notified', newSlots.length, 'new slots');
	} catch (err) {
		console.error('[scheduler] Error:', err);
		throw err;
	}
}
