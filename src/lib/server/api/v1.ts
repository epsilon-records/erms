import { json } from '@sveltejs/kit';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Database } from '#lib/server/audit.js';
import { getRecording, getRelease } from '#lib/server/catalog.js';
import { labels, recordings, releases } from '#lib/server/db/schema.js';
import type { ApiKeyScope } from '#lib/server/api-keys.js';

/**
 * Shared pieces of the public /v1 API (EPSILON-137). The request hook authenticates the key and
 * sets locals.db to the key's agent, under RLS; these helpers check scopes, shape errors the way
 * AudioKit does ({"error": {"code", "message"}}) and page through lists by id cursor (ids are
 * UUIDv7, so id order is creation order).
 */

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

export function apiErrorResponse(e: ApiError): Response {
	return json(
		{ error: { code: e.code, message: e.message } },
		{ status: e.status, headers: { 'Cache-Control': 'no-store' } }
	);
}

/** Wrap a /v1 handler: ApiErrors become the error envelope, and every answer is no-store. */
export function v1<E extends { locals: App.Locals }>(
	scope: ApiKeyScope,
	handler: (event: E, ctx: { orgId: string; db: App.Locals['db'] }) => Promise<unknown>
) {
	return async (event: E): Promise<Response> => {
		try {
			const key = event.locals.apiKey;
			const m = event.locals.membership;
			if (!key || !m) throw new ApiError(401, 'unauthorized', 'Missing or invalid API key.');
			if (!key.scopes.includes(scope)) {
				throw new ApiError(403, 'insufficient_scope', `This key lacks the ${scope} scope.`);
			}
			const body = await handler(event, { orgId: m.orgId, db: event.locals.db });
			return json(body, { headers: { 'Cache-Control': 'no-store' } });
		} catch (e) {
			if (e instanceof ApiError) return apiErrorResponse(e);
			throw e;
		}
	};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pageParams(url: URL): { limit: number; after: string | null } {
	const raw = url.searchParams.get('limit');
	const limit = raw === null ? 50 : Number(raw);
	if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
		throw new ApiError(400, 'invalid_request', 'limit must be an integer from 1 to 200.');
	}
	const after = url.searchParams.get('after');
	if (after !== null && !UUID.test(after)) {
		throw new ApiError(400, 'invalid_request', 'after must be an id from a previous page.');
	}
	return { limit, after };
}

export function requireId(id: string, what: string): string {
	if (!UUID.test(id)) throw new ApiError(404, 'not_found', `${what} not found.`);
	return id;
}

function page<T extends { id: string }>(rows: T[], limit: number) {
	const more = rows.length > limit;
	const data = more ? rows.slice(0, limit) : rows;
	return { data, next_cursor: more ? data[data.length - 1].id : null };
}

export async function listReleasesPage(
	tx: Database,
	orgId: string,
	{ limit, after }: { limit: number; after: string | null }
) {
	const rows = await tx
		.select({
			id: releases.id,
			title: releases.title,
			version_title: releases.versionTitle,
			type: releases.type,
			release_date: releases.releaseDate,
			upc: releases.upc,
			catalog_number: releases.catalogNumber,
			label: labels.name,
			updated_at: releases.updatedAt
		})
		.from(releases)
		.innerJoin(labels, eq(labels.id, releases.labelId))
		.where(and(eq(releases.orgId, orgId), after ? gt(releases.id, after) : undefined))
		.orderBy(asc(releases.id))
		.limit(limit + 1);
	return page(rows, limit);
}

export async function listRecordingsPage(
	tx: Database,
	orgId: string,
	{ limit, after }: { limit: number; after: string | null }
) {
	const rows = await tx
		.select({
			id: recordings.id,
			isrc: recordings.isrc,
			title: recordings.title,
			version_title: recordings.versionTitle,
			duration_ms: recordings.durationMs,
			genre: recordings.genre,
			updated_at: recordings.updatedAt
		})
		.from(recordings)
		.where(and(eq(recordings.orgId, orgId), after ? gt(recordings.id, after) : undefined))
		.orderBy(asc(recordings.id))
		.limit(limit + 1);
	return page(rows, limit);
}

/** camelCase keys to snake_case, recursively, dropping org ids (always the key's own label). */
export function toWire(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(toWire);
	if (value instanceof Date) return value.toISOString();
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([k]) => k !== 'orgId')
				.map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), toWire(v)])
		);
	}
	return value;
}

export async function releaseDetail(tx: Database, orgId: string, id: string) {
	const found = await getRelease(tx, orgId, id);
	if (!found) throw new ApiError(404, 'not_found', 'Release not found.');
	return { release: toWire(found) };
}

export async function recordingDetail(tx: Database, orgId: string, id: string) {
	const found = await getRecording(tx, orgId, id);
	if (!found) throw new ApiError(404, 'not_found', 'Recording not found.');
	return { recording: toWire(found) };
}
