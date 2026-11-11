import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '#lib/server/audit.js';
import { apiKeys, orgs } from '#lib/server/db/schema.js';
import type { Scope } from '#lib/server/rbac.js';

/**
 * API keys for the public /v1 API (EPSILON-137, migration 0026).
 *
 * A key is `lk_<prefix>_<secret>`: an 8-character public prefix, shown in lists, and 32 random
 * bytes. Only its SHA-256 is stored. Each key acts as an `agent` member of its label, so /v1
 * requests run as that agent under the same RLS as the app, and the key's scopes narrow what the
 * agent role allows (rbac.ts).
 */

export const API_KEY_SCOPES = [
	'catalog:read',
	'processing:request'
] as const satisfies readonly Scope[];
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const KEY_RE = /^lk_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;
const PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'; // 36 characters

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function generateKey(random: (n: number) => Buffer = randomBytes) {
	// Rejection sampling: 252 is the largest multiple of 36 below 256, so every character is
	// equally likely (a plain modulo would favour the first few).
	let prefix = '';
	while (prefix.length < 8) {
		for (const b of random(16)) {
			if (b < 252 && prefix.length < 8) prefix += PREFIX_ALPHABET[b % 36];
		}
	}
	const secret = random(32).toString('base64url');
	const key = `lk_${prefix}_${secret}`;
	return { key, prefix, hash: sha256(key) };
}

/** The key from an `Authorization: Bearer lk_…` header, or null if there is none or it is malformed. */
export function keyFromHeader(header: string | null): string | null {
	if (!header?.startsWith('Bearer ')) return null;
	const key = header.slice('Bearer '.length).trim();
	return KEY_RE.test(key) ? key : null;
}

export class ApiKeyError extends Error {
	constructor(
		readonly status: 400 | 403 | 409,
		message: string
	) {
		super(message);
	}
}

/** Create a key in the caller's label (owners only; the database checks). The key is returned once. */
export async function createApiKey(
	tx: Database,
	orgId: string,
	input: { name: string; scopes: readonly string[] },
	gen = generateKey
): Promise<{ id: string; key: string; prefix: string }> {
	const name = input.name.trim();
	if (name.length < 1 || name.length > 60)
		throw new ApiKeyError(400, 'Name the key (1–60 characters).');
	const scopes = [...new Set(input.scopes)];
	if (
		scopes.length === 0 ||
		!scopes.every((s) => (API_KEY_SCOPES as readonly string[]).includes(s))
	) {
		throw new ApiKeyError(400, 'Choose at least one scope.');
	}
	const { key, prefix, hash } = gen();
	const id = crypto.randomUUID();
	try {
		await tx.execute(
			// One Postgres array literal; the scopes are checked against API_KEY_SCOPES above.
			sql`select app.create_api_key(${id}::uuid, ${orgId}::uuid, ${name}, ${prefix}, ${hash}, ${`{${scopes.join(',')}}`}::text[])`
		);
	} catch (e) {
		const code =
			(e as { code?: string; cause?: { code?: string } }).code ??
			(e as { cause?: { code?: string } }).cause?.code;
		if (code === '42501')
			throw new ApiKeyError(403, 'Only an owner of this label can create API keys.');
		if (code === '54000')
			throw new ApiKeyError(409, 'This label already has 10 live API keys. Revoke one first.');
		throw e;
	}
	return { id, key, prefix };
}

export async function revokeApiKey(tx: Database, id: string): Promise<boolean> {
	try {
		const rows = await tx.execute<{ revoked: boolean }>(
			sql`select app.revoke_api_key(${id}::uuid) as revoked`
		);
		return Boolean((rows as unknown as Array<{ revoked: boolean }>)[0]?.revoked);
	} catch (e) {
		const code =
			(e as { code?: string; cause?: { code?: string } }).code ??
			(e as { cause?: { code?: string } }).cause?.code;
		if (code === '42501') throw new ApiKeyError(403, 'API key not found.');
		throw e;
	}
}

/** The label's keys, newest first, without hashes (owners only, through RLS). */
export function listApiKeys(tx: Database, orgId: string) {
	return tx
		.select({
			id: apiKeys.id,
			name: apiKeys.name,
			prefix: apiKeys.prefix,
			scopes: apiKeys.scopes,
			createdAt: apiKeys.createdAt,
			lastUsedAt: apiKeys.lastUsedAt,
			revokedAt: apiKeys.revokedAt
		})
		.from(apiKeys)
		.where(eq(apiKeys.orgId, orgId))
		.orderBy(desc(apiKeys.createdAt));
}

export type ResolvedKey = {
	id: string;
	orgId: string;
	orgName: string;
	actorId: string;
	scopes: ApiKeyScope[];
};

/**
 * Look a presented key up by its hash. Called by the request hook on the owner connection (the
 * key is the credential; there is no user yet). Stamps last_used_at at most once a minute.
 */
export async function resolveApiKey(
	owner: Database,
	key: string,
	now = new Date()
): Promise<ResolvedKey | null> {
	const [row] = await owner
		.select({
			id: apiKeys.id,
			orgId: apiKeys.orgId,
			orgName: orgs.name,
			actorId: apiKeys.actorId,
			scopes: apiKeys.scopes,
			lastUsedAt: apiKeys.lastUsedAt
		})
		.from(apiKeys)
		.innerJoin(orgs, eq(orgs.id, apiKeys.orgId))
		.where(and(eq(apiKeys.keySha256, sha256(key)), isNull(apiKeys.revokedAt)));
	if (!row) return null;
	if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
		await owner
			.update(apiKeys)
			.set({ lastUsedAt: now })
			.where(
				and(
					eq(apiKeys.id, row.id),
					or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, new Date(now.getTime() - 60_000)))
				)
			)
			.catch(() => undefined);
	}
	return {
		id: row.id,
		orgId: row.orgId,
		orgName: row.orgName,
		actorId: row.actorId,
		scopes: row.scopes.filter((s): s is ApiKeyScope =>
			(API_KEY_SCOPES as readonly string[]).includes(s)
		)
	};
}
