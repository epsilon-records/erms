import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { open, parseKeyRing, seal, type KeyRing, type SealContext } from './audiokit-credentials';
import { AudioKitClient } from './audio/client';
import type { AudioProvider } from './audio/provider';
import type { LabelClientsBilling } from './audio/billing';
import { recordSystemAudit, withAudit, type Actor, type Database, type Tx } from './audit';
import { audiokitJobs, audiokitLabelClients, type AudiokitLabelClient } from './db/schema';

/**
 * Each ERMS label (org) uses its own AudioKit client (EPSILON-102; shared 0021 and 0022; contract
 * in knowledge#69). This module is the only reader of `audiokit_label_clients`: it issues and
 * rotates a label's client through billing, picks the credentials a job is submitted, polled and
 * verified with, and retires a replaced client. Every function takes the owner connection from
 * its caller; the org is always the job's or the signed-in member's, never a request body.
 *
 * The deployment-wide key (AUDIOKIT_API_KEY and AUDIOKIT_WEBHOOK_SECRET) is Epsilon's unlimited
 * key. New jobs are submitted with it only for the orgs listed in AUDIOKIT_FALLBACK_ORG_IDS, and only
 * while such an org has never had a live client (EPSILON-135). Any other org without an active
 * client fails closed, so a LabelKit customer can never run on Epsilon's quota. A label whose
 * client was revoked also fails closed, listed or not. Jobs already stamped with the fallback (client
 * id null) are still polled and verified with it until they finish.
 */

export class LabelClientError extends Error {
	constructor(
		readonly status: 409 | 503,
		message: string
	) {
		super(message);
	}
}

/** What a request to AudioKit is made with. `clientId` null is the deployment-wide fallback. */
export type Credentials = { clientId: string | null; apiKey: string; webhookSecret: string };

export type FallbackCredentials = {
	apiKey?: string;
	webhookSecret?: string;
	/** Orgs allowed to submit new jobs with the deployment-wide key. Empty or unset: none. */
	orgIds?: readonly string[];
};

const ctx = (
	row: Pick<AudiokitLabelClient, 'orgId' | 'clientId'>,
	field: SealContext['field']
) => ({
	orgId: row.orgId,
	clientId: row.clientId,
	field
});

function openCredentials(ring: KeyRing, row: AudiokitLabelClient): Credentials {
	if (!row.apiKeySealed || !row.webhookSecretSealed) {
		throw new LabelClientError(503, 'The label client has no stored credentials.');
	}
	return {
		clientId: row.clientId,
		apiKey: open(ring, row.apiKeySealed, ctx(row, 'api_key')),
		webhookSecret: open(ring, row.webhookSecretSealed, ctx(row, 'webhook_secret'))
	};
}

/**
 * The credentials new jobs for an org are submitted with: its active client, else (only for an
 * org listed in `fallback.orgIds` that has never had a live client) the deployment-wide fallback.
 */
export async function submissionCredentials(
	db: Database,
	ring: () => KeyRing,
	orgId: string,
	fallback: FallbackCredentials
): Promise<Credentials> {
	const rows = await db
		.select()
		.from(audiokitLabelClients)
		.where(eq(audiokitLabelClients.orgId, orgId));
	const active = rows.find((r) => r.status === 'active');
	if (active) return openCredentials(ring(), active);
	if (rows.some((r) => r.status === 'draining' || r.status === 'revoked')) {
		throw new LabelClientError(409, 'This label has no active AudioKit client.');
	}
	if (!fallback.orgIds?.includes(orgId)) {
		throw new LabelClientError(409, 'This label has no AudioKit client yet.');
	}
	if (!fallback.apiKey || !fallback.webhookSecret) {
		throw new LabelClientError(503, 'AudioKit credentials are not configured.');
	}
	return { clientId: null, apiKey: fallback.apiKey, webhookSecret: fallback.webhookSecret };
}

/**
 * A client's credentials by its id, for verifying its webhooks and polling its jobs. Active and
 * draining clients only: a pending client has never been used and a revoked one is gone.
 */
export async function credentialsForClient(
	db: Database,
	ring: () => KeyRing,
	clientId: string
): Promise<(Credentials & { orgId: string }) | null> {
	const [row] = await db
		.select()
		.from(audiokitLabelClients)
		.where(
			and(
				eq(audiokitLabelClients.clientId, clientId),
				inArray(audiokitLabelClients.status, ['active', 'draining'])
			)
		);
	return row ? { ...openCredentials(ring(), row), orgId: row.orgId } : null;
}

export type ProviderFactory = (apiKey: string, webhookSecret: string) => AudioProvider;

export type ClientEnv = {
	baseUrl: string;
	fallback: FallbackCredentials;
	credentialsKey: string | undefined;
};

/** Providers for one worker or reconcile run; credentials are looked up once per client. */
export function providerResolver(
	db: Database,
	env: ClientEnv,
	factory: ProviderFactory = (key, secret) => new AudioKitClient(env.baseUrl, key, secret)
) {
	const ring = () => parseKeyRing(env.credentialsKey);
	const cache = new Map<string, Promise<AudioProvider | null>>();
	const memo = (key: string, make: () => Promise<AudioProvider | null>) => {
		if (!cache.has(key)) cache.set(key, make());
		return cache.get(key) as Promise<AudioProvider | null>;
	};
	return {
		/** Submission: the org's active client. Throws LabelClientError when it has none. */
		async forSubmission(orgId: string) {
			const creds = await submissionCredentials(db, ring, orgId, env.fallback);
			const provider = await memo(`sub:${creds.clientId ?? 'fallback'}`, async () =>
				factory(creds.apiKey, creds.webhookSecret)
			);
			return { provider: provider as AudioProvider, clientId: creds.clientId };
		},
		/**
		 * A client the job was already stamped with (a retry stays under the same client while it is
		 * still usable). Null when that client is revoked.
		 */
		async forClient(clientId: string | null): Promise<AudioProvider | null> {
			if (clientId === null) {
				const { apiKey, webhookSecret } = env.fallback;
				return apiKey && webhookSecret
					? memo('fallback', async () => factory(apiKey, webhookSecret))
					: null;
			}
			return memo(`client:${clientId}`, async () => {
				const creds = await credentialsForClient(db, ring, clientId);
				return creds ? factory(creds.apiKey, creds.webhookSecret) : null;
			});
		}
	};
}

/* ------------------------------------------------------------------------- */
/* Onboarding and rotation                                                    */
/* ------------------------------------------------------------------------- */

type Issued = Awaited<ReturnType<LabelClientsBilling['issue']>>;

function sealedRow(ring: KeyRing, orgId: string, issued: Issued) {
	const clientId = issued.label_client.client_id;
	return {
		orgId,
		clientId,
		apiKeySealed: seal(ring, issued.credentials.api_key, { orgId, clientId, field: 'api_key' }),
		webhookSecretSealed: seal(ring, issued.credentials.webhook_secret, {
			orgId,
			clientId,
			field: 'webhook_secret'
		}),
		keyPrefix: issued.label_client.key_prefix ?? null,
		syncState: issued.label_client.sync_state
	};
}

/** A client is usable once billing says the API accepts it. A 202 is "not yet". */
const isLive = (issued: Issued) =>
	issued.httpStatus === 201 && issued.label_client.sync_state === 'synced';

/** Make `clientId` the active client; the one it replaces drains. Caller holds the transaction. */
async function promote(tx: Tx, orgId: string, clientId: string) {
	await tx
		.update(audiokitLabelClients)
		.set({ status: 'draining' })
		.where(and(eq(audiokitLabelClients.orgId, orgId), eq(audiokitLabelClients.status, 'active')));
	await tx
		.update(audiokitLabelClients)
		.set({ status: 'active', syncState: 'synced' })
		.where(eq(audiokitLabelClients.clientId, clientId));
}

type AdminCtx = { orgId: string; actor: Actor };

/**
 * One issue or rotate at a time per org, held until the credentials are stored: the check, the
 * billing call and the write run in one transaction under an advisory lock, so two requests cannot
 * both pass the check and both call billing.
 */
function exclusivelyFor<T>(db: Database, orgId: string, fn: (tx: Database) => Promise<T>) {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`audiokit-label-client:${orgId}`}, 0))`
		);
		return fn(tx as unknown as Database);
	});
}

/**
 * If the credentials could not be stored after billing issued them, they are lost (billing shows
 * them once), and the org would be stuck: billing would answer 409 to another issue while ERMS has
 * no client to rotate. So the client is revoked again, and the original failure is what surfaces.
 */
async function storeOrRevoke(
	db: Database,
	billing: LabelClientsBilling,
	ring: KeyRing,
	admin: AdminCtx,
	issued: Issued,
	action: 'issue_client' | 'rotate_client'
) {
	try {
		return await storeIssued(db, ring, admin, issued, action);
	} catch (err) {
		await billing.revoke(issued.label_client.client_id).catch(() => undefined);
		throw err;
	}
}

/**
 * Issue an org's first client and store its credentials, in the same step: billing shows them only
 * once. Throws LabelClientError(409) when the org already has a live client (rotate instead).
 */
export function issueLabelClient(
	db: Database,
	billing: LabelClientsBilling,
	ring: KeyRing,
	admin: AdminCtx
) {
	return exclusivelyFor(db, admin.orgId, async (tx) => {
		const live = await tx
			.select({ id: audiokitLabelClients.id })
			.from(audiokitLabelClients)
			.where(
				and(eq(audiokitLabelClients.orgId, admin.orgId), ne(audiokitLabelClients.status, 'revoked'))
			);
		if (live.length) throw new LabelClientError(409, 'This label already has an AudioKit client.');

		const issued = await billing.issue(admin.orgId);
		return storeOrRevoke(tx, billing, ring, admin, issued, 'issue_client');
	});
}

/** Issue a second client alongside the active one. Needs an active client and no pending one. */
export function rotateLabelClient(
	db: Database,
	billing: LabelClientsBilling,
	ring: KeyRing,
	admin: AdminCtx
) {
	return exclusivelyFor(db, admin.orgId, async (tx) => {
		const live = await tx
			.select({ status: audiokitLabelClients.status })
			.from(audiokitLabelClients)
			.where(
				and(eq(audiokitLabelClients.orgId, admin.orgId), ne(audiokitLabelClients.status, 'revoked'))
			);
		if (!live.some((r) => r.status === 'active')) {
			throw new LabelClientError(409, 'This label has no active AudioKit client to rotate.');
		}
		if (live.length > 1) {
			throw new LabelClientError(409, 'A rotation is already in progress for this label.');
		}
		const issued = await billing.rotate(admin.orgId);
		return storeOrRevoke(tx, billing, ring, admin, issued, 'rotate_client');
	});
}

async function storeIssued(
	db: Database,
	ring: KeyRing,
	admin: AdminCtx,
	issued: Issued,
	action: 'issue_client' | 'rotate_client'
) {
	const live = isLive(issued);
	const row = sealedRow(ring, admin.orgId, issued);
	await withAudit(db, admin, async (tx, audit) => {
		await tx.insert(audiokitLabelClients).values({ ...row, status: 'pending' });
		if (live) await promote(tx, admin.orgId, row.clientId);
		// Never the key or secret: the client id and where it stands.
		await audit({
			entity: 'audiokit_label_client',
			entityId: row.clientId,
			action,
			after: { status: live ? 'active' : 'pending', sync_state: row.syncState }
		});
	});
	return { clientId: row.clientId, status: live ? ('active' as const) : ('pending' as const) };
}

/**
 * Move clients along once billing has caught up. Run by the reconcile schedule:
 *  - a pending client that billing now reports synced becomes the active one, and the client it
 *    replaces starts draining;
 *  - a draining client with no unfinished job left is revoked at billing and its stored key and
 *    secret are wiped. Jobs already submitted keep their client, so their webhooks still verify
 *    and their polls still use the old key until they finish.
 * One client failing does not stop the others. Errors are counted, never logged with a secret.
 */
export async function advanceLabelClients(db: Database, billing: LabelClientsBilling) {
	const summary = { activated: 0, revoked: 0, failed: 0 };
	const rows = await db
		.select()
		.from(audiokitLabelClients)
		.where(inArray(audiokitLabelClients.status, ['pending', 'draining']));

	for (const row of rows) {
		try {
			if (row.status === 'pending') {
				const remote = await billing.get(row.clientId);
				if (remote.sync_state !== 'synced') continue;
				await db.transaction(async (tx) => {
					await promote(tx, row.orgId, row.clientId);
					await recordSystemAudit(tx, {
						orgId: row.orgId,
						actorId: 'system:audiokit-clients',
						entity: 'audiokit_label_client',
						entityId: row.clientId,
						action: 'activate_client',
						after: { status: 'active', sync_state: 'synced' }
					});
				});
				summary.activated++;
			} else {
				const [{ unfinished }] = await db
					.select({ unfinished: sql<number>`count(*)::int` })
					.from(audiokitJobs)
					.where(
						and(
							eq(audiokitJobs.clientId, row.clientId),
							inArray(audiokitJobs.status, ['queued', 'submitted'])
						)
					);
				if (unfinished > 0) continue;
				const remote = await billing.revoke(row.clientId);
				await db.transaction(async (tx) => {
					await tx
						.update(audiokitLabelClients)
						.set({
							status: 'revoked',
							apiKeySealed: null,
							webhookSecretSealed: null,
							syncState: remote.sync_state,
							revokedAt: new Date()
						})
						.where(eq(audiokitLabelClients.id, row.id));
					await recordSystemAudit(tx, {
						orgId: row.orgId,
						actorId: 'system:audiokit-clients',
						entity: 'audiokit_label_client',
						entityId: row.clientId,
						action: 'revoke_client',
						after: { status: 'revoked', sync_state: remote.sync_state }
					});
				});
				summary.revoked++;
			}
		} catch {
			summary.failed++;
		}
	}
	return summary;
}
