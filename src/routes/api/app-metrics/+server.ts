import { APP_METRICS_ENABLED } from '$app/env/private';
import { receive } from '#lib/server/app-metrics.js';
import type { RequestHandler } from './$types';
export const fallback: RequestHandler = ({ request, locals }) =>
	receive(request, locals.db, APP_METRICS_ENABLED);
export const POST = fallback;
