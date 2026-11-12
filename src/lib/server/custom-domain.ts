import { resolveTxt } from 'node:dns/promises';
import { sql } from 'drizzle-orm';
import { getDomain } from 'tldts';
import type { Database } from './audit';

/**
 * Self-serve custom domains (knowledge labelkit 0034, 0036). Any label's owners can serve the label
 * on their own domain:
 *
 *   1. request: the owner enters a domain; app.request_org_domain stores it with a token.
 *   2. DNS: the owner adds a TXT record at _labelkit-verify.<domain> holding the token, and points
 *      the domain at the LabelKit site (CNAME, or A records for an apex domain).
 *   3. verify: the app reads the TXT record, provisions the domain (Netlify alias, which brings
 *      TLS, and the Supabase Auth callback), then app.activate_org_domain makes it the label's
 *      custom_domain. Branding, sign-in and the tab icon then follow on that host.
 *
 * No domain is special-cased: Epsilon's own goes through the same steps as any other label's.
 */

export class DomainError extends Error {
	constructor(
		readonly status: 400 | 403 | 409 | 502 | 503,
		message: string
	) {
		super(message);
	}
}

/** The LabelKit site a tenant domain points at, for the DNS instructions. */
export const ROUTING = {
	cname: 'labelkit.netlify.app',
	/** Netlify's load balancer, for apex domains that cannot have a CNAME. */
	apexA: '75.2.60.5'
} as const;

export const TXT_PREFIX = '_labelkit-verify';
export const txtName = (domain: string) => `${TXT_PREFIX}.${domain}`;
export const txtValue = (token: string) => `labelkit-verify=${token}`;

const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Hosts LabelKit itself answers on, which no tenant may claim. */
const RESERVED = [/(^|\.)labelkit\.co$/, /(^|\.)netlify\.app$/, /(^|\.)supabase\.co$/];

/** " https://ERMS.Example.com/ " → "erms.example.com". Refuses anything that is not a hostname. */
export function parseDomain(input: string): string {
	const host = input
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '')
		.replace(/\.$/, '');
	if (!host || host.length > 253 || !DOMAIN.test(host)) {
		throw new DomainError(400, 'Enter a domain such as catalogue.yourlabel.com.');
	}
	if (RESERVED.some((r) => r.test(host))) {
		throw new DomainError(400, 'That domain belongs to LabelKit and cannot be used.');
	}
	return host;
}

/**
 * True for a registrable domain with no subdomain part (example.com, yourlabel.co.uk), which
 * cannot have a CNAME and needs an A record instead. Uses the public suffix list, so a multi-part
 * suffix such as co.uk is not mistaken for the label's own name.
 */
export const isApex = (domain: string) => getDomain(domain) === domain;

type ResolveTxt = (name: string) => Promise<string[][]>;

/** Whether _labelkit-verify.<domain> holds this token. A missing record is false, not an error. */
export async function hasVerificationRecord(
	domain: string,
	token: string,
	resolve: ResolveTxt = resolveTxt
): Promise<boolean> {
	try {
		const records = await resolve(txtName(domain));
		return records.some((chunks) => chunks.join('').trim() === txtValue(token));
	} catch (e) {
		const code = (e as { code?: string }).code;
		if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ESERVFAIL') return false;
		throw e;
	}
}

export type ProvisionConfig = {
	netlifyToken?: string;
	netlifySiteId?: string;
	supabaseToken?: string;
	supabaseProjectRef?: string;
	fetch?: typeof fetch;
};

const callbackUrl = (domain: string) => `https://${domain}/auth/callback`;

/**
 * Adds or removes a tenant domain where it has to exist outside the database: as a domain alias
 * on the LabelKit Netlify site (Netlify then issues its TLS certificate) and as an allowed
 * redirect in Supabase Auth (or magic-link sign-in falls back to labelkit.co). Each change reads
 * the current list and writes it back with only this domain added or removed.
 */
export function provisioner(config: ProvisionConfig) {
	const http = config.fetch ?? fetch;
	const missing = [
		!config.netlifyToken && 'NETLIFY_API_TOKEN',
		!config.netlifySiteId && 'NETLIFY_SITE_ID',
		!config.supabaseToken && 'SUPABASE_ACCESS_TOKEN',
		!config.supabaseProjectRef && 'SUPABASE_PROJECT_REF'
	].filter(Boolean);

	async function call(url: string, token: string, init?: RequestInit) {
		const host = new URL(url).host;
		let res: Response;
		try {
			res = await http(url, {
				// Bounded, because the caller holds the provisioning lock (and a transaction) meanwhile.
				signal: AbortSignal.timeout(10_000),
				...init,
				headers: {
					authorization: `Bearer ${token}`,
					'content-type': 'application/json',
					...init?.headers
				}
			});
		} catch {
			throw new DomainError(502, `${host} did not answer.`);
		}
		if (!res.ok) throw new DomainError(502, `${host} answered HTTP ${res.status}.`);
		return res.json() as Promise<Record<string, unknown>>;
	}

	async function netlify(change: (aliases: string[]) => string[], removing?: string) {
		const url = `https://api.netlify.com/api/v1/sites/${config.netlifySiteId}`;
		const site = await call(url, config.netlifyToken!);
		// The site's primary domain is not an alias, and detaching it would take LabelKit itself
		// off the site. Refuse, so the domain stays on the retired list for an operator.
		if (removing && site.custom_domain === removing) {
			throw new DomainError(409, `${removing} is the site's primary domain on Netlify.`);
		}
		const aliases = (site.domain_aliases as string[] | undefined) ?? [];
		const next = change(aliases);
		if (next.length === aliases.length && next.every((a, i) => a === aliases[i])) return;
		await call(url, config.netlifyToken!, {
			method: 'PATCH',
			body: JSON.stringify({ domain_aliases: next })
		});
	}

	async function supabase(change: (allowed: string[]) => string[]) {
		const url = `https://api.supabase.com/v1/projects/${config.supabaseProjectRef}/config/auth`;
		const auth = await call(url, config.supabaseToken!);
		const allowed = String(auth.uri_allow_list ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const next = change(allowed);
		if (next.join(',') === allowed.join(',')) return;
		await call(url, config.supabaseToken!, {
			method: 'PATCH',
			body: JSON.stringify({ uri_allow_list: next.join(',') })
		});
	}

	return {
		configured: missing.length === 0,
		missing,
		async add(domain: string) {
			if (missing.length) {
				throw new DomainError(
					503,
					`Domain setup is not switched on for this site yet (missing ${missing.join(', ')}).`
				);
			}
			await netlify((a) => (a.includes(domain) ? a : [...a, domain]));
			await supabase((a) => (a.includes(callbackUrl(domain)) ? a : [...a, callbackUrl(domain)]));
		},
		async remove(domain: string) {
			if (missing.length) return;
			await netlify((a) => a.filter((x) => x !== domain), domain);
			await supabase((a) => a.filter((x) => x !== callbackUrl(domain)));
		}
	};
}

const codeOf = (e: unknown) =>
	(e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;

/** Maps the domain functions' SQLSTATEs to messages for the settings page. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		const code = codeOf(e);
		if (code === '42501') throw new DomainError(403, 'Only an owner can change the domain.');
		if (code === '23505') throw new DomainError(409, 'That domain belongs to another label.');
		if (code === '22023') throw new DomainError(409, 'Request the domain again, then verify it.');
		throw e;
	}
}

export function requestDomain(tx: Database, orgId: string, domain: string) {
	return run(async () => {
		const rows = (await tx.execute(
			sql`select app.request_org_domain(${orgId}::uuid, ${domain}) as token`
		)) as unknown as Array<{ token: string }>;
		return rows[0].token;
	});
}

/** Activates the request only if it still carries the token whose TXT record was checked. */
export function activateDomain(tx: Database, orgId: string, domain: string, token: string) {
	return run(() =>
		tx.execute(sql`select app.activate_org_domain(${orgId}::uuid, ${domain}, ${token})`)
	);
}

export function failDomain(tx: Database, orgId: string, domain: string, reason: string) {
	return run(() =>
		tx.execute(sql`select app.fail_org_domain(${orgId}::uuid, ${domain}, ${reason})`)
	);
}

export function removeDomain(tx: Database, orgId: string) {
	return run(async () => {
		const rows = (await tx.execute(
			sql`select app.remove_org_domain(${orgId}::uuid) as domain`
		)) as unknown as Array<{ domain: string | null }>;
		return rows[0].domain;
	});
}

export function cancelDomainRequest(tx: Database, orgId: string) {
	return run(() => tx.execute(sql`select app.cancel_org_domain_request(${orgId}::uuid)`));
}

/**
 * Serialises changes to the Netlify alias list and the Supabase Auth redirect list. Both APIs take
 * the whole list, so two owners provisioning at once would otherwise each write back a list
 * without the other's domain. The lock is transaction-scoped: it is released when `tx` ends.
 */
export async function lockProvisioning(tx: Database) {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtext('labelkit:domain-provisioning'))`);
}

type Provisioner = ReturnType<typeof provisioner>;

/**
 * Takes the label's retired domains off Netlify and Supabase Auth and off the retired list. A
 * domain some label serves again is only taken off the list. A failed removal stays on it, to be
 * retried by the next domain action or the page's retry button; without provisioning tokens
 * nothing is removed and everything stays. Call with the provisioning lock held. Returns the
 * domains still waiting.
 */
export async function cleanUpRetiredDomains(
	tx: Database,
	orgId: string,
	provision: Pick<Provisioner, 'configured' | 'remove'>
): Promise<string[]> {
	const retired = await run(
		async () =>
			(await tx.execute(
				sql`select domain, in_use from app.retired_org_domains(${orgId}::uuid)`
			)) as unknown as Array<{ domain: string; in_use: boolean }>
	);
	const waiting: string[] = [];
	for (const { domain, in_use } of retired) {
		if (!in_use) {
			if (!provision.configured) {
				waiting.push(domain);
				continue;
			}
			try {
				await provision.remove(domain);
			} catch (e) {
				if (!(e instanceof DomainError)) throw e;
				waiting.push(domain);
				continue;
			}
		}
		await run(() => tx.execute(sql`select app.clear_retired_domain(${orgId}::uuid, ${domain})`));
	}
	return waiting;
}
