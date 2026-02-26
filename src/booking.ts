/**
 * AFA Sports booking API client and slot parsing logic.
 */

import type { BookingResponse, CourtBlock, Config, SlotId } from './types';

const BOOKING_URL = 'https://community.afa-sports.com/kiosk/booking';
const SPORTS_FACILITY_ID = 643;

function formatDateInTz(d: Date, tz: string): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(d);
	const year = parts.find((p) => p.type === 'year')?.value ?? '';
	const month = parts.find((p) => p.type === 'month')?.value ?? '';
	const day = parts.find((p) => p.type === 'day')?.value ?? '';
	return `${year}-${month}-${day}`;
}

/**
 * Returns today's date (YYYY-MM-DD) in the given timezone.
 */
export function getTodayInTz(tz: string): string {
	return formatDateInTz(new Date(), tz);
}

/**
 * Returns the current ISO week string (e.g. "2026-W09") for the given timezone.
 */
export function getCurrentISOWeek(tz: string): string {
	const todayStr = getTodayInTz(tz);
	const [y, m, d] = todayStr.split('-').map(Number);
	const date = new Date(Date.UTC(y!, m! - 1, d!));
	date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
	const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Returns date strings from today through end of current ISO week (Sunday), inclusive, in the given timezone.
 */
export function getRemainingWeekDates(tz: string): string[] {
	const todayStr = getTodayInTz(tz);
	const baseDate = new Date(todayStr + 'T12:00:00Z');
	const dayOfWeek = baseDate.getUTCDay();
	const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
	const dates: string[] = [];
	for (let i = 0; i <= daysUntilSunday; i++) {
		const d = new Date(baseDate.getTime() + i * 86400000);
		dates.push(formatDateInTz(d, tz));
	}
	return dates;
}

/**
 * Parses a slot key like "19:00-19:30" into start/end hours.
 */
function parseSlotRange(slotKey: string): { startHour: number; endHour: number } | null {
	const match = slotKey.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
	if (!match) return null;
	const [, sh, sm, eh, em] = match.map(Number);
	return {
		startHour: sh + sm / 60,
		endHour: eh + em / 60,
	};
}

function isBadmintonCourt(court: string): boolean {
	return court.startsWith('Badminton Court ');
}

function slotId(date: string, timeSlot: string, court: string): SlotId {
	return `${date}|${timeSlot}|${court}`;
}

/**
 * Fetches availability for a single date.
 */
export async function fetchAvailability(date: string): Promise<BookingResponse> {
	const res = await fetch(BOOKING_URL, {
		method: 'POST',
		headers: {
			accept: 'application/json, text/plain, */*',
			'content-type': 'application/json',
			auth: '334',
			origin: 'https://book.afa-sports.com',
			referer: 'https://book.afa-sports.com/',
		},
		body: JSON.stringify({
			sports_facility_id: SPORTS_FACILITY_ID,
			date,
		}),
	});
	if (!res.ok) {
		throw new Error(`Booking API error: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as BookingResponse;
	if (json.success !== 1 || !json.data) {
		throw new Error('Booking API returned invalid response');
	}
	return json;
}

/**
 * Fetches availability for the remaining week and returns all qualifying blocks.
 * Does not update KV or respect cooldown — for on-demand /check.
 */
export async function fetchAllQualifyingBlocks(config: Config): Promise<CourtBlock[]> {
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
			console.error(`[check] API error for ${date}:`, err);
		}
	}

	return allBlocks;
}

/**
 * Extracts qualifying contiguous blocks from API data for a single date.
 * Only includes blocks >= minBlockHours and within the configured time range.
 */
export function extractQualifyingBlocks(date: string, data: Record<string, Record<string, boolean>>, config: Config): CourtBlock[] {
	const blocks: CourtBlock[] = [];
	const slotKeys = Object.keys(data).sort();

	const timeSlotsInRange = slotKeys.filter((key) => {
		const range = parseSlotRange(key);
		if (!range) return false;
		return range.startHour >= config.timeStartHour && range.endHour <= config.timeEndHour;
	});

	const courts = new Set<string>();
	for (const key of timeSlotsInRange) {
		for (const court of Object.keys(data[key] ?? {})) {
			if (isBadmintonCourt(court) && data[key]![court]) {
				courts.add(court);
			}
		}
	}

	for (const court of courts) {
		const availableSlots = timeSlotsInRange.filter((key) => data[key]?.[court] === true);
		const contiguous = findContiguousRuns(availableSlots);
		const minSlots = Math.ceil(config.minBlockHours * 2);
		for (const run of contiguous) {
			if (run.length >= minSlots) {
				blocks.push({
					date,
					court,
					startSlot: run[0]!,
					endSlot: run[run.length - 1]!,
					slotIds: run.map((s) => slotId(date, s, court)),
					hours: run.length * 0.5,
				});
			}
		}
	}

	return blocks;
}

/**
 * Groups consecutive slot keys (e.g. "19:00-19:30", "19:30-20:00") into runs.
 */
function findContiguousRuns(slotKeys: string[]): string[][] {
	if (slotKeys.length === 0) return [];
	const parsed = slotKeys
		.map((k) => {
			const r = parseSlotRange(k);
			return r ? { key: k, ...r } : null;
		})
		.filter((p): p is NonNullable<typeof p> => p != null);
	parsed.sort((a, b) => a.startHour - b.startHour);

	const runs: string[][] = [];
	let current: string[] = [parsed[0]!.key];
	for (let i = 1; i < parsed.length; i++) {
		const prev = parsed[i - 1]!;
		const curr = parsed[i]!;
		if (Math.abs(curr.startHour - prev.endHour) < 0.01) {
			current.push(curr.key);
		} else {
			runs.push([...current]);
			current = [curr.key];
		}
	}
	runs.push(current);
	return runs;
}
