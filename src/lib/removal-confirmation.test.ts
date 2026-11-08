import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmRemoval, removedIdentities, submittedIdentities } from './removal-confirmation';
import { requireRemovalConfirmation } from './server/removal-confirmation';
import { editAction } from './server/form';

afterEach(() => vi.unstubAllGlobals());

describe('removal confirmation', () => {
	it('compares persisted identities regardless of order, shares, additions or partial omissions', () => {
		const persisted = ['p:a', 'l:b'];
		expect(removedIdentities(persisted, ['l:b', 'p:a', 'p:c'], (x) => x)).toEqual([]);
		expect(removedIdentities(persisted, ['p:a'], (x) => x)).toEqual(['l:b']);
		expect(removedIdentities(persisted, [], (x) => x)).toEqual(persisted);
		expect(
			submittedIdentities({ writer_0: 'a', role_0: 'composer', share_0: '100' }, 'writer')
		).toEqual(['a:composer']);
		expect(removedIdentities(['a:lyricist'], ['a:composer'], (x) => x)).toEqual(['a:lyricist']);
	});

	it.each(['pointer', 'keyboard'])(
		'cancels %s submission, accepts once, and asks again on retry',
		() => {
			const input = { type: '', name: '', value: '', remove: vi.fn() };
			let listener: (e: { preventDefault: () => void }) => void = () => {};
			const form = {
				append: vi.fn(),
				addEventListener: vi.fn((_name, fn) => (listener = fn)),
				removeEventListener: vi.fn()
			};
			const confirm = vi
				.fn()
				.mockReturnValueOnce(false)
				.mockReturnValueOnce(true)
				.mockReturnValueOnce(false);
			vi.stubGlobal('document', { createElement: () => input });
			vi.stubGlobal('window', { confirm });
			vi.stubGlobal(
				'FormData',
				class {
					*[Symbol.iterator]() {
						yield ['holder_0', 'p:a'];
					}
				}
			);
			const guard = confirmRemoval(form as unknown as HTMLFormElement, () => 'Remove Example?');
			const cancel = vi.fn();
			listener({ preventDefault: cancel });
			expect(cancel).toHaveBeenCalledOnce();
			expect(input.value).toBe('');
			const accept = vi.fn();
			listener({ preventDefault: accept });
			expect(accept).not.toHaveBeenCalled();
			expect(input.value).toBe('yes');
			listener({ preventDefault: cancel });
			expect(input.value).toBe('');
			expect(confirm).toHaveBeenCalledTimes(3);
			guard.destroy();
		}
	);

	it('fails closed without JS acknowledgement, preserves failed values and permits non-removals', async () => {
		const mutate = vi.fn();
		const fields = { holder_0: '', territory: 'NL' };
		const result = await editAction('setMaster', fields, async () => {
			requireRemovalConfirmation(fields);
			mutate();
		});
		expect(result).toMatchObject({ status: 400, data: { values: fields, ok: false } });
		expect(mutate).not.toHaveBeenCalled();
		expect(() => requireRemovalConfirmation(fields, false)).not.toThrow();
		expect(() => requireRemovalConfirmation({ removalConfirmed: 'yes' })).not.toThrow();
	});
});
