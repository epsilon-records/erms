// Local build plugin: warm the SvelteKit server function right after a production deploy goes
// live, so the first real visitor doesn't wait for a cold start (EPSILON-192).
//
// A new instance takes about 5 s to start, and every production deploy starts new instances.
// Netlify runs `onSuccess` after the deploy is published, so these requests reach the new
// deploy. A few run in parallel because each one can only warm the instance that serves it.
//
// It never fails anything: `onSuccess` can't stop a deploy that is already live, and a slow or
// failed warm-up only means the next visitor gets the cold start, as before.

import { target, warm } from './warm.mjs';

export const onSuccess = async () => {
	const url = target();
	if (!url) {
		console.log('warm-after-deploy: not a production deploy, skipped');
		return;
	}
	for (const line of await warm(url)) console.log(`warm-after-deploy: ${line}`);
};
