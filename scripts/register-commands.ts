/**
 * One-time script to register slash commands with Discord.
 * Run: pnpm run register-commands
 * Loads from .env.local (DISCORD_APPLICATION_ID, DISCORD_TOKEN)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const TOKEN = process.env.DISCORD_TOKEN;

if (!APPLICATION_ID || !TOKEN) {
	console.error(
		"Set DISCORD_APPLICATION_ID and DISCORD_TOKEN environment variables.",
	);
	process.exit(1);
}

const COMMANDS = [
	{
		name: "booked",
		description: "Pause notifications for the current week (you've already booked)",
	},
	{
		name: "cancel",
		description: "Resume notifications (undo /booked pause)",
	},
	{
		name: "settings",
		description: "View or update search settings (time range, min block size)",
		options: [
			{
				name: "view",
				description: "Show current settings",
				type: 1,
			},
			{
				name: "set",
				description: "Update settings",
				type: 1,
				options: [
					{
						name: "time-start",
						description: "Start hour in 24h format (0-23)",
						type: 4,
						required: false,
						min_value: 0,
						max_value: 23,
					},
					{
						name: "time-end",
						description: "End hour in 24h format (0-23)",
						type: 4,
						required: false,
						min_value: 0,
						max_value: 23,
					},
					{
						name: "min-block",
						description: "Minimum contiguous hours to notify (1-8)",
						type: 4,
						required: false,
						min_value: 1,
						max_value: 8,
					},
					{
						name: "timezone",
						description: "IANA timezone for dates and times",
						type: 3,
						required: false,
						choices: [
							{ name: "Perth", value: "Australia/Perth" },
							{ name: "Sydney", value: "Australia/Sydney" },
							{ name: "Melbourne", value: "Australia/Melbourne" },
							{ name: "Brisbane", value: "Australia/Brisbane" },
							{ name: "Adelaide", value: "Australia/Adelaide" },
						],
					},
				],
			},
		],
	},
];

async function main() {
	const url = `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`;
	const res = await fetch(url, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bot ${TOKEN}`,
		},
		body: JSON.stringify(COMMANDS),
	});

	if (!res.ok) {
		console.error("Failed:", res.status, await res.text());
		process.exit(1);
	}

	const data = (await res.json()) as Array<{ name: string }>;
	console.log("Registered commands:", data.map((c) => c.name).join(", "));
}

main();
