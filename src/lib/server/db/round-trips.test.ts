import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, declareParams, UNKNOWN_OID, type Database } from './index';
import { orgs } from './schema';
import { asUser } from './scoped';
import { withAudit } from '../audit';
import { countingProxy } from './counting-proxy';
import { createTestDb } from '../test-db';

describe('round trips per query (EPSILON-145)', () => {
	let db: Database;
	let proxy: Awaited<ReturnType<typeof countingProxy>>;
	let directUrl: string;

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
		directUrl = `postgres://${auth}@${o.host[0]}:${o.port[0]}/${o.database}?sslmode=disable`;
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

	it('runs a query with null parameters in one round trip', async () => {
		expect(await proxy.count(() => db.execute(sql`select ${'a'}::text, ${null}::text`))).toBe(1);
	});

	it('writes an audit row with a null before in three: begin, the insert, commit', async () => {
		const [org] = await db
			.insert(orgs)
			.values({ name: 'Round trips', slug: `rt-${randomUUID()}` })
			.returning();
		const actor = { id: 'test', kind: 'system' } as const;
		const trips = await proxy.count(() =>
			withAudit(db, { orgId: org.id, actor }, (_tx, audit) =>
				audit({ entity: 'org', entityId: org.id, action: 'create', before: null, after: null })
			)
		);
		expect(trips).toBe(3);
		const [row] = await db.execute(
			sql`select before is null as b, after is null as a from audit_log where entity_id = ${org.id}`
		);
		expect(row).toEqual({ b: true, a: true }); // SQL NULL, not JSON null
	});

	it('reads a null parameter as an undeclared one would be read, in one round trip', async () => {
		// The same queries on a client without declareParams: the result, or the SQLSTATE, must match.
		const plain = drizzle(postgres(directUrl, { prepare: false, max: 1, onnotice: () => {} }));
		const outcome = (run: () => Promise<unknown>) =>
			run().then(
				(rows) => ({ rows: [...(rows as unknown[])] }),
				(e: { cause?: { code?: string } }) => ({ code: e.cause?.code })
			);
		const cases = [
			sql`select ${null} is null as v`,
			sql`select ${null}::text is null as v`,
			sql`select coalesce(${null}, 'fallback') as v`,
			sql`select coalesce(${null}::int, 7) as v`,
			sql`select coalesce(${'given'}, ${null}) as v`,
			...['text', 'int', 'uuid', 'jsonb', 'timestamptz', 'boolean'].map(
				(type) => sql`select ${null}::${sql.raw(type)} is null as v`
			)
		];
		try {
			for (const query of cases) {
				let declared: unknown;
				const trips = await proxy.count(
					async () => (declared = await outcome(() => db.execute(query)))
				);
				expect(trips).toBe(1);
				expect(declared).not.toEqual({ code: undefined }); // a result, or a real SQLSTATE
				expect(declared).toEqual(await outcome(() => plain.execute(query)));
			}
		} finally {
			await plain.$client.end({ timeout: 5 });
		}
		// The ones that matter for the app's writes and filters do read as NULL.
		expect((await db.execute(sql`select ${null}::text is null as v`))[0]).toEqual({ v: true });
		expect((await db.execute(sql`select coalesce(${null}, 'fallback') as v`))[0]).toEqual({
			v: 'fallback'
		});
	});

	it('inserts null and non-null parameters into nullable columns unchanged', async () => {
		await db.execute(
			sql`create table if not exists nullable_params (
				k int primary key, j jsonb, t timestamptz, u uuid, s text, n int, b boolean
			)`
		);
		const id = randomUUID();
		const insert = (k: number, values: unknown[]) =>
			db.execute(
				sql`insert into nullable_params values (${k}, ${sql.join(
					values.map((v) => sql`${v}`),
					sql`, `
				)}) returning j, (t at time zone 'UTC')::text as t, u::text as u, s, n, b`
			);
		let rows: unknown;
		expect(
			await proxy.count(async () => (rows = await insert(1, [null, null, null, null, null, null])))
		).toBe(1);
		expect((rows as unknown[])[0]).toEqual({
			j: null,
			t: null,
			u: null,
			s: null,
			n: null,
			b: null
		});

		expect(
			await proxy.count(
				async () => (rows = await insert(2, ['{"a":1}', '2026-01-02T03:04:05Z', id, 'x', 5, true]))
			)
		).toBe(1);
		expect((rows as unknown[])[0]).toEqual({
			j: { a: 1 },
			t: '2026-01-02 03:04:05',
			u: id,
			s: 'x',
			n: 5,
			b: true
		});
	});

	it("keeps the client's two-argument unsafe(query, options) form working", async () => {
		const rows = await db.$client.unsafe('select 1 as v', { prepare: false });
		expect([...rows]).toEqual([{ v: 1 }]);
	});
});

describe('declareParams', () => {
	type Call = { query: string; params: unknown; args: unknown[] };
	function fakeClient(calls: Call[]): postgres.Sql {
		const fake = {
			typed: (value: unknown, oid: number) => ({ value, oid }),
			unsafe: (query: string, ...args: unknown[]) => calls.push({ query, params: args[0], args }),
			begin: (fn: (tx: unknown) => unknown) => fn(fakeClient(calls)),
			savepoint: (name: string, fn: (tx: unknown) => unknown) => fn(fakeClient(calls))
		};
		return fake as unknown as postgres.Sql;
	}

	it('declares strings, numbers, booleans and nulls as unknown', () => {
		const calls: Call[] = [];
		declareParams(fakeClient(calls)).unsafe('q', ['a', 1, true, null]);
		expect(calls[0].params).toEqual([
			{ value: 'a', oid: UNKNOWN_OID },
			{ value: 1, oid: UNKNOWN_OID },
			{ value: true, oid: UNKNOWN_OID },
			{ value: null, oid: UNKNOWN_OID }
		]);
	});

	it('passes unsafe its arguments as given, so unsafe(query, options) still works', () => {
		const calls: Call[] = [];
		const client = declareParams(fakeClient(calls));
		const options = { prepare: false };
		client.unsafe('one');
		client.unsafe('two', options);
		client.unsafe('three', ['a'], options);
		expect(calls.map((c) => c.args)).toEqual([
			[],
			[options],
			[[{ value: 'a', oid: UNKNOWN_OID }], options]
		]);
		expect(calls[1].args[0]).toBe(options);
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
