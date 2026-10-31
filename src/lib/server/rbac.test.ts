import { describe, expect, it } from 'vitest';
import { hasScope } from './rbac';

describe('rbac', () => {
	it('lets only rights admins and owners write consent', () => {
		expect(hasScope('rights_admin', 'consent:write')).toBe(true);
		expect(hasScope('owner', 'consent:write')).toBe(true);
		expect(hasScope('catalog_manager', 'consent:write')).toBe(false);
		expect(hasScope('agent', 'consent:write')).toBe(false);
	});

	it('never lets agents approve anything', () => {
		expect(hasScope('agent', 'assets:approve')).toBe(false);
		expect(hasScope('agent', 'metadata:approve')).toBe(false);
	});
});
