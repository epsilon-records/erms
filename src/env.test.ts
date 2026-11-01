import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('.env.example lists exactly the variables src/env.ts validates', () => {
	const declared = [
		...readFileSync('src/env.ts', 'utf8').matchAll(/^\t([A-Z][A-Z0-9_]+): \{/gm)
	].map((m) => m[1]);
	const example = [...readFileSync('.env.example', 'utf8').matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map(
		(m) => m[1]
	);
	expect(example.sort()).toEqual(declared.sort());
});
