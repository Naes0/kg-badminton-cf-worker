/**
 * Discord webhook sender and interaction verification.
 */

import type { CourtBlock } from './types';

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
	}
	return bytes;
}

/**
 * Verifies Discord interaction signature using Ed25519.
 */
export async function verifyDiscordRequest(req: Request, body: string, publicKeyHex: string): Promise<boolean> {
	const signature = req.headers.get('X-Signature-Ed25519');
	const timestamp = req.headers.get('X-Signature-Timestamp');
	if (!signature || !timestamp) return false;

	const message = new TextEncoder().encode(timestamp + body);
	const sigBytes = hexToBytes(signature);
	const keyBytes = hexToBytes(publicKeyHex);

	try {
		const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify']);
		return await crypto.subtle.verify('Ed25519', key, sigBytes, message);
	} catch (err) {
		console.error('[discord] Ed25519 verify failed:', err);
		return false;
	}
}

/**
 * Sends a message to a Discord webhook URL.
 */
export async function sendWebhookMessage(webhookUrl: string, content: string): Promise<boolean> {
	try {
		const res = await fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content }),
		});
		if (!res.ok) {
			console.error('[discord] Webhook failed:', res.status, await res.text());
			return false;
		}
		return true;
	} catch (err) {
		console.error('[discord] Webhook send error:', err);
		return false;
	}
}

function formatTime(slot: string, useEnd = false): string {
	const match = slot.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
	if (!match) return slot;
	const [, sh, sm, eh, em] = match;
	const [h, m] = useEnd ? [eh, em] : [sh, sm];
	const hour = parseInt(h!, 10);
	const period = hour >= 12 ? 'pm' : 'am';
	const hour12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
	return `${hour12}:${m}${period}`;
}

function formatDate(dateStr: string): string {
	const d = new Date(dateStr + 'T12:00:00Z');
	const day = new Intl.DateTimeFormat('en-AU', {
		weekday: 'long',
		day: 'numeric',
		month: 'short',
	}).format(d);
	return day;
}

/**
 * Formats court blocks into a Discord message.
 */
export function formatBlocksMessage(blocks: CourtBlock[]): string {
	const byDate = new Map<string, CourtBlock[]>();
	for (const b of blocks) {
		const list = byDate.get(b.date) ?? [];
		list.push(b);
		byDate.set(b.date, list);
	}
	const sortedDates = [...byDate.keys()].sort();

	const lines: string[] = ['🏸 Courts available this week!', ''];
	for (const date of sortedDates) {
		const list = byDate.get(date) ?? [];
		lines.push(`**${formatDate(date)}**`);
		for (const b of list) {
			lines.push(`• ${b.court} — ${formatTime(b.startSlot)} – ${formatTime(b.endSlot, true)} (${b.hours}h)`);
		}
		lines.push('');
	}
	lines.push('Book at: https://book.afa-sports.com/?auth=334');
	return lines.join('\n');
}
