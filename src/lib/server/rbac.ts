import type { Role } from './db/schema';

/** Scopes from the spec's RBAC table. Agents get a per-token subset of AGENT_MAX. */
export const SCOPES = [
	'catalog:read',
	'catalog:write',
	'assets:approve',
	'metadata:approve',
	'rights:read',
	'rights:write',
	'consent:write',
	'agreements:read',
	'processing:request',
	'roles:manage'
] as const;

export type Scope = (typeof SCOPES)[number];

const ROLE_SCOPES: Record<Role, readonly Scope[]> = {
	owner: SCOPES,
	catalog_manager: [
		'catalog:read',
		'catalog:write',
		'assets:approve',
		'metadata:approve',
		'processing:request'
	],
	rights_admin: ['catalog:read', 'rights:read', 'rights:write', 'consent:write', 'agreements:read'],
	viewer: ['catalog:read'],
	// Agents can never approve or write consent; tokens may narrow this further.
	agent: ['catalog:read', 'processing:request']
};

export function scopesFor(role: Role): readonly Scope[] {
	return ROLE_SCOPES[role];
}

export function hasScope(role: Role, scope: Scope): boolean {
	return ROLE_SCOPES[role].includes(scope);
}
