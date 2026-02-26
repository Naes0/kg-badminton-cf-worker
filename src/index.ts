/**
 * Badminton court availability notifier.
 * - Cron: polls AFA Sports API every 5 min, sends Discord webhook on new slots
 * - Fetch: handles Discord slash commands (/booked, /cancel, /settings, /check)
 */

import { verifyDiscordRequest, formatBlocksMessage } from './discord';
import { validateEnv } from './env';
import type { WorkerEnv } from './env';
import { setState, getConfig, setConfig } from './kv';
import { runScheduler } from './scheduler';
import { getCurrentISOWeek, fetchAllQualifyingBlocks } from './booking';

type SlashPayload = {
	type?: number;
	application_id?: string;
	token?: string;
	data?: {
		name?: string;
		options?: Array<{
			name: string;
			value?: number | string;
			options?: Array<{ name: string; value?: number | string }>;
		}>;
	};
};

const DISCORD_MAX_MESSAGE_LENGTH = 2000;

async function handleSlashCommand(e: WorkerEnv, payload: SlashPayload, ctx?: ExecutionContext): Promise<Response> {
	if (payload.type === 1) {
		return Response.json({ type: 1 });
	}
	if (payload.type !== 2 || !payload.data) {
		return new Response('Unsupported interaction', { status: 400 });
	}

	const cmd = payload.data.name;
	const options = payload.data.options ?? [];

	if (cmd === 'booked') {
		const config = await getConfig(e.BADMINTON_KV);
		const week = getCurrentISOWeek(config.timezone);
		await setState(e.BADMINTON_KV, { bookedWeek: week });
		return Response.json({
			type: 4,
			data: { content: 'Got it! Notifications paused for this week. Use /cancel to undo.', flags: 0 },
		});
	}

	if (cmd === 'cancel') {
		await setState(e.BADMINTON_KV, { bookedWeek: null });
		return Response.json({
			type: 4,
			data: { content: 'Pause cancelled. Notifications are active again.', flags: 0 },
		});
	}

	if (cmd === 'check') {
		const appId = payload.application_id;
		const token = payload.token;
		const runCheck = async () => {
			const config = await getConfig(e.BADMINTON_KV);
			const blocks = await fetchAllQualifyingBlocks(config);
			let message = formatBlocksMessage(blocks);
			if (message.length > DISCORD_MAX_MESSAGE_LENGTH) {
				message = message.slice(0, DISCORD_MAX_MESSAGE_LENGTH - 20) + '\n\n...(truncated)';
			}
			return message || 'No courts available this week.';
		};
		if (ctx && appId && token) {
			ctx.waitUntil(
				runCheck()
					.then((message) =>
						fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ content: message }),
						}),
					)
					.catch(async (err) => {
						console.error('[check] Error:', err);
						await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ content: 'Sorry, the availability check failed. Try again later.' }),
						});
					}),
			);
			return Response.json({
				type: 5,
				data: { content: 'Checking availability...', flags: 0 },
			});
		}
		// Dev route: run synchronously and return content directly
		try {
			const message = await runCheck();
			return Response.json({ type: 4, data: { content: message, flags: 0 } });
		} catch (err) {
			console.error('[check] Error:', err);
			return Response.json({
				type: 4,
				data: { content: 'Availability check failed: ' + String(err), flags: 0 },
			});
		}
	}

	if (cmd === 'settings') {
		const sub = options.find((o) => o.name === 'view' || o.name === 'set');
		if (!sub) {
			return Response.json({
				type: 4,
				data: { content: 'Use /settings view or /settings set to manage config.', flags: 0 },
			});
		}

		if (sub.name === 'view') {
			const config = await getConfig(e.BADMINTON_KV);
			const fmt = (h: number) => (h === 0 ? '12:00am' : h === 12 ? '12:00pm' : h > 12 ? `${h - 12}:00pm` : `${h}:00am`);
			return Response.json({
				type: 4,
				data: {
					content: `Current settings:\n• Time range: ${fmt(config.timeStartHour)} – ${fmt(config.timeEndHour)}\n• Minimum block: ${config.minBlockHours} hours\n• Timezone: ${config.timezone}`,
					flags: 0,
				},
			});
		}

		if (sub.name === 'set') {
			const opts = sub.options ?? [];
			const timeStart = opts.find((o) => o.name === 'time-start')?.value;
			const timeEnd = opts.find((o) => o.name === 'time-end')?.value;
			const minBlock = opts.find((o) => o.name === 'min-block')?.value;
			const timezone = opts.find((o) => o.name === 'timezone')?.value;

			const updates: { timeStartHour?: number; timeEndHour?: number; minBlockHours?: number; timezone?: string } = {};
			if (typeof timeStart === 'number' && timeStart >= 0 && timeStart <= 23) updates.timeStartHour = timeStart;
			if (typeof timeEnd === 'number' && timeEnd >= 0 && timeEnd <= 23) updates.timeEndHour = timeEnd;
			if (typeof minBlock === 'number' && minBlock >= 1 && minBlock <= 8) updates.minBlockHours = minBlock;
			if (typeof timezone === 'string' && timezone.length > 0) updates.timezone = timezone;

			if (Object.keys(updates).length === 0) {
				return Response.json({
					type: 4,
					data: {
						content: 'No valid options provided. Use time-start (0–23), time-end (0–23), min-block (1–8), timezone (e.g. Australia/Perth).',
						flags: 0,
					},
				});
			}

			const config = await setConfig(e.BADMINTON_KV, updates);
			const fmt = (h: number) => (h === 0 ? '12:00am' : h === 12 ? '12:00pm' : h > 12 ? `${h - 12}:00pm` : `${h}:00am`);
			return Response.json({
				type: 4,
				data: {
					content: `Settings updated.\n• Time range: ${fmt(config.timeStartHour)} – ${fmt(config.timeEndHour)}\n• Minimum block: ${config.minBlockHours} hours\n• Timezone: ${config.timezone}`,
					flags: 0,
				},
			});
		}
	}

	return Response.json({ type: 4, data: { content: 'Unknown command.', flags: 0 } });
}

export default {
	async fetch(req: Request, env: unknown, ctx?: ExecutionContext): Promise<Response> {
		let e;
		try {
			e = validateEnv(env as Record<string, unknown>);
		} catch (err) {
			console.error('[index] Invalid env:', err);
			return new Response('Server misconfigured', { status: 500 });
		}

		const url = new URL(req.url);
		if (url.pathname === '/__scheduled') {
			return new Response('Use curl with --test-scheduled to trigger the cron handler.', { status: 200 });
		}

		// Local dev routes (enable with LOCAL_DEV=1 in .dev.vars)
		const isLocalDev = (env as Record<string, unknown>).LOCAL_DEV === '1' || (env as Record<string, unknown>).LOCAL_DEV === 'true';
		if (isLocalDev && url.pathname === '/__dev/trigger-scheduler') {
			await runScheduler(e);
			return new Response('Scheduler ran. Check terminal logs and Discord.', { status: 200 });
		}
		if (isLocalDev && url.pathname === '/__dev/slash' && req.method === 'POST') {
			const body = await req.text();
			try {
				const payload = JSON.parse(body) as SlashPayload;
				return await handleSlashCommand(e, payload, ctx);
			} catch (err) {
				return new Response('Invalid JSON: ' + String(err), { status: 400 });
			}
		}

		if (req.method !== 'POST' || url.pathname !== '/') {
			return new Response('Not Found', { status: 404 });
		}

		const body = await req.text();
		const valid = await verifyDiscordRequest(req, body, e.DISCORD_PUBLIC_KEY);
		if (!valid) {
			return new Response('Invalid signature', { status: 401 });
		}

		let payload: SlashPayload;
		try {
			payload = JSON.parse(body) as SlashPayload;
		} catch {
			return new Response('Invalid JSON', { status: 400 });
		}

		return await handleSlashCommand(e, payload, ctx);
	},

	async scheduled(_event: ScheduledEvent, env: unknown, _ctx: ExecutionContext): Promise<void> {
		const e = validateEnv(env as Record<string, unknown>);
		await runScheduler(e);
	},
} satisfies ExportedHandler;
