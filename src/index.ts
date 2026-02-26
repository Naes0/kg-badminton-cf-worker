/**
 * Badminton court availability notifier.
 * - Cron: polls AFA Sports API every 5 min, sends Discord webhook on new slots
 * - Fetch: handles Discord slash commands (/booked, /cancel, /settings)
 */

import { verifyDiscordRequest } from './discord';
import { validateEnv } from './env';
import { getState, setState, getConfig, setConfig } from './kv';
import { runScheduler } from './scheduler';
import { getCurrentISOWeek } from './booking';

export default {
	async fetch(req: Request, env: unknown): Promise<Response> {
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

		if (req.method !== 'POST' || url.pathname !== '/') {
			return new Response('Not Found', { status: 404 });
		}

		const body = await req.text();
		const valid = await verifyDiscordRequest(req, body, e.DISCORD_PUBLIC_KEY);
		if (!valid) {
			return new Response('Invalid signature', { status: 401 });
		}

		let payload: {
			type?: number;
			data?: {
				name?: string;
				options?: Array<{
					name: string;
					value?: number | string;
					options?: Array<{ name: string; value?: number | string }>;
				}>;
			};
		};
		try {
			payload = JSON.parse(body) as typeof payload;
		} catch {
			return new Response('Invalid JSON', { status: 400 });
		}

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
				data: {
					content: 'Got it! Notifications paused for this week. Use /cancel to undo.',
					flags: 0,
				},
			});
		}

		if (cmd === 'cancel') {
			await setState(e.BADMINTON_KV, { bookedWeek: null });
			return Response.json({
				type: 4,
				data: {
					content: 'Pause cancelled. Notifications are active again.',
					flags: 0,
				},
			});
		}

		if (cmd === 'settings') {
			const sub = options.find((o) => o.name === 'view' || o.name === 'set');
			if (!sub) {
				return Response.json({
					type: 4,
					data: {
						content: 'Use /settings view or /settings set to manage config.',
						flags: 0,
					},
				});
			}

			if (sub.name === 'view') {
				const config = await getConfig(e.BADMINTON_KV);
				const fmt = (h: number) => (h === 0 ? '12:00am' : h === 12 ? '12:00pm' : h > 12 ? `${h - 12}:00pm` : `${h}:00am`);
				const start = fmt(config.timeStartHour);
				const end = fmt(config.timeEndHour);
				return Response.json({
					type: 4,
					data: {
						content: `Current settings:\n• Time range: ${start} – ${end}\n• Minimum block: ${config.minBlockHours} hours\n• Timezone: ${config.timezone}`,
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

				const updates: {
					timeStartHour?: number;
					timeEndHour?: number;
					minBlockHours?: number;
					timezone?: string;
				} = {};
				if (typeof timeStart === 'number' && timeStart >= 0 && timeStart <= 23) {
					updates.timeStartHour = timeStart;
				}
				if (typeof timeEnd === 'number' && timeEnd >= 0 && timeEnd <= 23) {
					updates.timeEndHour = timeEnd;
				}
				if (typeof minBlock === 'number' && minBlock >= 1 && minBlock <= 8) {
					updates.minBlockHours = minBlock;
				}
				if (typeof timezone === 'string' && timezone.length > 0) {
					updates.timezone = timezone;
				}

				if (Object.keys(updates).length === 0) {
					return Response.json({
						type: 4,
						data: {
							content:
								'No valid options provided. Use time-start (0–23), time-end (0–23), min-block (1–8), timezone (e.g. Australia/Perth).',
							flags: 0,
						},
					});
				}

				const config = await setConfig(e.BADMINTON_KV, updates);
				const fmt = (h: number) => (h === 0 ? '12:00am' : h === 12 ? '12:00pm' : h > 12 ? `${h - 12}:00pm` : `${h}:00am`);
				const start = fmt(config.timeStartHour);
				const end = fmt(config.timeEndHour);
				return Response.json({
					type: 4,
					data: {
						content: `Settings updated.\n• Time range: ${start} – ${end}\n• Minimum block: ${config.minBlockHours} hours\n• Timezone: ${config.timezone}`,
						flags: 0,
					},
				});
			}
		}

		return Response.json({
			type: 4,
			data: { content: 'Unknown command.', flags: 0 },
		});
	},

	async scheduled(_event: ScheduledEvent, env: unknown, _ctx: ExecutionContext): Promise<void> {
		const e = validateEnv(env as Record<string, unknown>);
		await runScheduler(e);
	},
} satisfies ExportedHandler;
