import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, declareParams, UNKNOWN_OID, type Database } from './index';
import { orgs } from './schema';
import { asUser } from './scoped';
import { createTestDb } from '../test-db';

/**
 * A TCP proxy that reads what the client sends and counts the messages after which it waits for
 * the server: Flush (H), Sync (S) and simple Query (Q). Each one is a round trip, about 98 ms from
 * Netlify's Ohio functions to Supabase in Frankfurt (knowledge decision ERMS 0029).
 */
async function countingProxy(host: string, port: number) {
	let trips = 0;
	const sockets = new Set<net.Socket>();
	const server = net.createServer((client) => {
		const upstream = net.connect(port, host);
		sockets.add(client).add(upstream);
		let buf = Buffer.alloc(0);
		let started = false;
		client.on('data', (chunk: Buffer) => {
			upstream.write(chunk);
			buf = Buffer.concat([buf, chunk]);
			for (;;) {
				if (!started) {
					// Startup and SSL/GSS requests have no type byte.
					if (buf.length < 8) break;
					const len = buf.readInt32BE(0);
					if (buf.length < len) break;
					const code = buf.readInt32BE(4);
					buf = buf.subarray(len);
					started = code !== 80877103 && code !== 80877104;
					continue;
				}
				if (buf.length < 5) break;
				const len = buf.readInt32BE(1);
				if (buf.length < len + 1) break;
				if ('HSQ'.includes(String.fromCharCode(buf[0]))) trips++;
				buf = buf.subarray(len + 1);
			}
		});
		upstream.on('data', (chunk) => client.write(chunk));
		client.on('close', () => upstream.destroy());
		upstream.on('close', () => client.destroy());
		client.on('error', () => {});
		upstream.on('error', () => {});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return {
		port: (server.address() as net.AddressInfo).port,
		async count(fn: () => Promise<unknown>) {
			const before = trips;
			await fn();
			return trips - before;
		},
		close() {
			for (const s of sockets) s.destroy();
			server.close();
		}
	};
}

describe('round trips per query (EPSILON-145)', () => {
	let db: Database;
	let proxy: Awaited<ReturnType<typeof countingProxy>>;

	beforeAll(async () => {
		const { client } = await createTestDb();
		const o = client.options as unknown as {
			host: string[];
			port: number[];
			database: string;
			user: string;
			pass: string | null;
		};
		proxy = await countingProxy(o.host[0], o.port[0]);
		const auth = `${encodeURIComponent(o.user)}:${encodeURIComponent(o.pass ?? '')}`;
		db = createDb(`postgres://${auth}@127.0.0.1:${proxy.port}/${o.database}?sslmode=disable`, {
			max: 1
		});
		await db.execute(sql`select 1`); // connect, authenticate and load types first
	});

	afterAll(async () => {
		await db?.$client.end({ timeout: 5 });
		proxy?.close();
	});

	it('runs a parameterised query in one round trip, not two', async () => {
		expect(
			await proxy.count(() => db.select().from(orgs).where(eq(orgs.slug, 'no-such-label')))
		).toBe(1);
	});

	it('runs a query with no parameters in one round trip', async () => {
		expect(await proxy.count(() => db.select().from(orgs))).toBe(1);
	});

	it('runs a locals.db call in four: begin, set role and user, the query, commit', async () => {
		// Six before: set_config and the query each waited for a describe.
		const trips = await proxy.count(() =>
			asUser(db, randomUUID(), (tx) => tx.select().from(orgs).where(eq(orgs.slug, 'x')))
		);
		expect(trips).toBe(4);
	});
});

describe('declareParams', () => {
	type Call = { query: string; params: unknown };
	function fakeClient(calls: Call[]): postgres.Sql {
		const fake = {
			typed: (value: unknown, oid: number) => ({ value, oid }),
			unsafe: (query: string, params: unknown) => calls.push({ query, params }),
			begin: (fn: (tx: unknown) => unknown) => fn(fakeClient(calls)),
			savepoint: (name: string, fn: (tx: unknown) => unknown) => fn(fakeClient(calls))
		};
		return fake as unknown as postgres.Sql;
	}

	it('declares strings, numbers and booleans as unknown, and leaves nulls as null', () => {
		const calls: Call[] = [];
		declareParams(fakeClient(calls)).unsafe('q', ['a', 1, true, null]);
		expect(calls[0].params).toEqual([
			{ value: 'a', oid: UNKNOWN_OID },
			{ value: 1, oid: UNKNOWN_OID },
			{ value: true, oid: UNKNOWN_OID },
			null
		]);
	});

	it('leaves a query with any other value exactly as it was', () => {
		const calls: Call[] = [];
		const params = ['a', new Date(0)];
		declareParams(fakeClient(calls)).unsafe('q', params);
		expect(calls[0].params).toBe(params);
	});

	it('declares parameters inside transactions and savepoints too', async () => {
		const calls: Call[] = [];
		const client = declareParams(fakeClient(calls));
		await client.begin((tx) => tx.unsafe('in begin', ['a']));
		await client.begin((tx) => tx.savepoint('sp', (sp) => sp.unsafe('in savepoint', ['b'])));
		expect(calls.map((c) => c.params)).toEqual([
			[{ value: 'a', oid: UNKNOWN_OID }],
			[{ value: 'b', oid: UNKNOWN_OID }]
		]);
	});
});
