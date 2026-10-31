import { PgBoss } from 'pg-boss';

/** Queue names. One place so web and worker agree. */
export const QUEUES = {
	submitProcessingJob: 'processing.submit',
	pollProcessingJob: 'processing.poll'
} as const;

export async function startQueue(databaseUrl: string): Promise<PgBoss> {
	const boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss' });
	boss.on('error', (err) => console.error('[queue]', err));
	await boss.start();
	for (const name of Object.values(QUEUES)) {
		await boss.createQueue(name);
	}
	return boss;
}
