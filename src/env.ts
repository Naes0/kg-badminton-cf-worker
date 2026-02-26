/**
 * Typesafe env validation using t3-env.
 * Validates the Cloudflare Worker env object at runtime.
 *
 * For local dev, wrangler loads secrets from .dev.vars.
 * For production, use wrangler secret put.
 */

import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const workerEnvSchema = {
	BADMINTON_KV: z.custom<KVNamespace>((v) => v != null),
	DISCORD_WEBHOOK_URL: z.string().url(),
	DISCORD_PUBLIC_KEY: z.string().min(1),
} as const;

export type WorkerEnv = {
	BADMINTON_KV: KVNamespace;
	DISCORD_WEBHOOK_URL: string;
	DISCORD_PUBLIC_KEY: string;
};

/**
 * Validates the Worker env and returns a typed object.
 * Throws on validation failure.
 */
export function validateEnv(runtimeEnv: Record<string, unknown>): WorkerEnv {
	return createEnv({
		server: workerEnvSchema,
		runtimeEnv: runtimeEnv as Record<string, string | boolean | number | undefined>,
		emptyStringAsUndefined: true,
	}) as WorkerEnv;
}
