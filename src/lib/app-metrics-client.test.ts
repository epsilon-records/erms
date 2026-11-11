import { it, expect, vi, afterEach } from 'vitest';
import { createCollector, createLifetime } from './app-metrics-client';
import { METRICS_ORIGINS } from './app-metrics-contract';
afterEach(() => vi.useRealTimers());
function setup(enabled = true, origin: string = METRICS_ORIGINS[0]) {
	let time = 42,
		visible = true;
	const fetch = vi
		.fn<typeof globalThis.fetch>()
		.mockResolvedValue(new Response(null, { status: 204 }));
	const client = createCollector({
		enabled,
		origin,
		fetch,
		now: () => time,
		visible: () => visible
	});
	return { client, fetch, time: (n: number) => (time = n), hide: () => (visible = false) };
}
it('sends one fresh fixed object through credential-free native fetch options', async () => {
	const { client, fetch } = setup();
	client.after('/', 'enter');
	client.after('/', 'enter');
	expect(fetch).toHaveBeenCalledTimes(1);
	const [url, options] = fetch.mock.calls[0];
	expect(url).toBe('/api/app-metrics');
	expect(options).toMatchObject({
		method: 'POST',
		mode: 'same-origin',
		credentials: 'omit',
		referrerPolicy: 'no-referrer',
		redirect: 'error',
		cache: 'no-store',
		keepalive: false,
		headers: { 'Content-Type': 'application/json' }
	});
	expect(JSON.parse(options!.body as string)).toEqual({
		v: 1,
		route: 'catalog_home',
		metric: 'document_mount_ms',
		ms: 42
	});
});
it('drops disabled/wrong-origin/unknown/hidden initial documents', () => {
	for (const s of [setup(false), setup(true, 'http://localhost'), setup()]) {
		s.hide();
		s.client.after('/', 'enter');
		expect(s.fetch).not.toHaveBeenCalled();
	}
	const s = setup();
	s.client.after('/auth/callback', 'enter');
	s.client.after('/', 'link');
	expect(s.fetch).not.toHaveBeenCalled();
});
it('is enabled on exactly the two production origins and nowhere else', () => {
	for (const origin of METRICS_ORIGINS) {
		const s = setup(true, origin);
		s.client.after('/', 'enter');
		expect(s.fetch).toHaveBeenCalledTimes(1);
	}
	for (const origin of [
		'https://deploy-preview-1--epsilon-erms.netlify.app',
		'https://main--epsilon-erms.netlify.app',
		'https://epsilon-erms.netlify.app',
		'https://labelkit.co.evil.example',
		'https://www.labelkit.co',
		'https://sub.labelkit.co',
		'http://labelkit.co',
		'https://labelkit.co/',
		'https://labelkit.co:8443',
		'https://erms.epsilonrecords.com.evil.example',
		'https://epsilonrecords.com',
		'null',
		''
	]) {
		const s = setup(true, origin);
		s.client.after('/', 'enter');
		expect(s.fetch).not.toHaveBeenCalled();
	}
});
it('conservatively drops same-symbol, excluded, canceled, stale and form navigation', () => {
	const { client, fetch, time } = setup();
	client.after('/login', 'enter');
	time(2000);
	for (const type of ['link', 'goto', 'popstate', 'form']) {
		client.before({ from: '/', to: '/', type });
		client.after('/', type);
		client.before({ from: '/', to: '/releases/[id]', type });
		client.after('/releases/[id]', type);
		client.before({ from: '/releases/[id]', to: '/', type });
		client.invalidate();
		client.after('/', type);
	}
	client.before({ from: '/', to: '/', type: 'link', leaving: true });
	client.destroy();
	client.after('/', 'enter');
	expect(fetch).not.toHaveBeenCalled();
});
it('aborts on deadline and lifecycle invalidation; catches failures', async () => {
	vi.useFakeTimers();
	const s = setup();
	s.fetch.mockImplementation(
		(_url, options) =>
			new Promise((_resolve, reject) =>
				options!.signal!.addEventListener('abort', () => reject(new Error('fake')))
			)
	);
	s.client.after('/', 'enter');
	const signal = s.fetch.mock.calls[0][1]!.signal!;
	await vi.advanceTimersByTimeAsync(1000);
	expect(signal.aborted).toBe(true);
	const t = setup();
	t.client.after('/', 'enter');
	t.client.invalidate();
	expect(t.fetch.mock.calls[0][1]!.signal!.aborted).toBe(true);
});

it('shares one document mount/budget across duplicate initialization and root remount', () => {
	const lifetime = createLifetime();
	const fetch = vi
		.fn<typeof globalThis.fetch>()
		.mockResolvedValue(new Response(null, { status: 204 }));
	const options = {
		enabled: true,
		origin: METRICS_ORIGINS[0],
		fetch,
		now: () => 100,
		visible: () => true,
		lifetime
	};
	const first = createCollector(options);
	first.after('/', 'enter');
	const second = createCollector(options);
	second.after('/', 'enter');
	first.after('/', 'enter');
	first.destroy();
	second.after('/', 'enter');
	expect(fetch).toHaveBeenCalledTimes(1);
	second.destroy();
	createCollector(options).after('/', 'enter');
	expect(fetch).toHaveBeenCalledTimes(1);
});
