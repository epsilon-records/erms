import { describe, expect, it } from 'vitest';
import { exportFileName } from './export.js';

describe('exportFileName', () => {
	it('slugs the label name and dates the file', () => {
		expect(exportFileName('Epsilon Records', new Date('2026-11-11T22:00:00Z'))).toBe(
			'epsilon-records-catalogue-2026-11-11.json'
		);
	});
	it('never produces an empty or unsafe name', () => {
		expect(exportFileName('"/../', new Date('2026-11-11T00:00:00Z'))).toBe(
			'label-catalogue-2026-11-11.json'
		);
	});
});
