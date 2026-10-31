import { DATABASE_URL } from '$app/env/private';
import { createDb } from './index';

let instance: ReturnType<typeof createDb> | undefined;

/** Lazily created so `vite build` never opens a connection. */
export function db() {
	instance ??= createDb(DATABASE_URL);
	return instance;
}
