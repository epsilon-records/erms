import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/** Every /v1 route has a path in docs/openapi.yaml, and every documented path has a route. */
function routes(dir: string, prefix = '/v1'): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			out.push(...routes(p, `${prefix}/${name.replace(/^\[(.+)\]$/, '{$1}')}`));
		} else if (name === '+server.ts') out.push(prefix);
	}
	return out;
}

it('docs/openapi.yaml lists exactly the /v1 routes', () => {
	const spec = readFileSync('docs/openapi.yaml', 'utf8');
	const documented = [...spec.matchAll(/^ {2}(\/v1\/[^:]*):$/gm)].map((m) => m[1]).sort();
	expect(documented).toEqual(routes('src/routes/v1').sort());
});
