// Temporary diagnostic for EPSILON-148: how long does installed Chrome take to print its DevTools
// address, and what does it say on stderr while it does? Not for merge.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const chrome = execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim();
console.log('chrome', chrome, execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim());
const variant = process.argv[2] ?? 'baseline';
const runs = Number(process.argv[3] ?? 10);
const env = variant.includes('fullenv') ? process.env : { PATH: process.env.PATH };
for (let i = 0; i < runs; i++) {
	const profile = await mkdtemp(resolve(tmpdir(), 'diag-chrome-'));
	const extra = variant.includes('pwbasic') ? ['--password-store=basic'] : [];
	const runEnv = variant.includes('homeenv') ? { ...env, HOME: profile } : env;
	const t0 = Date.now();
	const b = spawn(
		chrome,
		[
			'--headless=new',
			'--no-sandbox',
			'--disable-background-networking',
			'--disable-component-update',
			'--disable-sync',
			'--no-first-run',
			...extra,
			'--remote-debugging-address=127.0.0.1',
			'--remote-debugging-port=0',
			`--user-data-dir=${profile}`
		],
		{ stdio: ['ignore', 'pipe', 'pipe'], env: runEnv }
	);
	const lines = [];
	let found = null;
	const on = (tag) => (d) => {
		for (const l of String(d).split('\n'))
			if (l.trim()) {
				lines.push(`+${Date.now() - t0}ms ${tag} ${l}`);
				if (!found && /DevTools listening on/.test(l)) found = Date.now() - t0;
			}
	};
	b.stderr.on('data', on('err'));
	b.stdout.on('data', on('out'));
	let exit = null;
	b.on('exit', (c, s) => (exit = `${c}/${s} at +${Date.now() - t0}ms`));
	while (!found && exit === null && Date.now() - t0 < 45000) await new Promise((r) => setTimeout(r, 25));
	console.log(`${variant} #${i}: devtools=${found ?? 'NEVER'}ms exit=${exit}`);
	if (!found || found > 3000 || i === 0) for (const l of lines) console.log('   ', l);
	b.kill('SIGKILL');
	await new Promise((r) => setTimeout(r, 300));
	await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
