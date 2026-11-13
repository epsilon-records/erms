import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { buildAnalysis } from '#lib/analysis.js';
import RecordingAnalysis from './RecordingAnalysis.svelte';

// Server render runs no client effects or actions: this is what a no-JS visitor gets.
function html(canRun: boolean) {
	return render(RecordingAnalysis, {
		props: { recordingId: 'r1', analysis: buildAnalysis([]), canRun }
	}).body;
}

describe('analysis run form without JavaScript', () => {
	it('stays a plain POST to the runAnalysis action with an enabled Run button', () => {
		const body = html(true);
		const forms = body.match(/<form\b[^>]*>/g) ?? [];
		expect(forms).toHaveLength(7);
		for (const form of forms) {
			expect(form).toContain('method="POST"');
			expect(form).toContain('action="?/runAnalysis"');
		}
		const buttons = body.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
		expect(buttons).toHaveLength(7);
		for (const button of buttons) {
			// The disabled attribute, not the `disabled:` style variants in the class list.
			const attributes = (button.match(/<button\b[^>]*>/)?.[0] ?? '').replace(/class="[^"]*"/, '');
			expect(attributes).not.toMatch(/\bdisabled\b/);
			expect(button).toContain('Run');
			expect(button).not.toContain('Starting');
		}
	});

	it('renders no card as busy and an empty polite live region at rest', () => {
		const body = html(true);
		expect(body).not.toContain('aria-busy');
		expect(body).toMatch(/<p class="sr-only" role="status" aria-live="polite"><\/p>/);
	});

	it('renders no forms when the viewer cannot run analysis', () => {
		expect(html(false)).not.toContain('<form');
	});
});
