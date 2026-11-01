import { error } from '@sveltejs/kit';
import { hasScope, type Scope } from './rbac';

/** Org membership plus a scope check for a server load or action. Throws 403 otherwise. */
export function requireScope(locals: App.Locals, scope: Scope) {
	const m = locals.membership;
	if (!m) error(403, 'You are not a member of an organisation yet.');
	if (!hasScope(m.role, scope)) error(403, `Your role (${m.role}) does not allow ${scope}.`);
	return m;
}
