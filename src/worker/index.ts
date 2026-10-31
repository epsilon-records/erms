/**
 * Background worker (runs as its own Railway service).
 * Phase 0: connects to the queue and registers handlers. Processing handlers
 * call the AudioProvider and land in Phase 4.
 */
import { QUEUES, startQueue } from '../lib/server/queue';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error('DATABASE_URL is required');
	process.exit(1);
}

const boss = await startQueue(databaseUrl);

await boss.work(QUEUES.submitProcessingJob, async ([job]) => {
	console.log('[worker] submit not implemented until Phase 4', job.id);
});

console.log('[worker] ready');

const shutdown = async () => {
	await boss.stop({ graceful: true });
	process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
