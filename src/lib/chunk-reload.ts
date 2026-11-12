/**
 * Recovery from a JavaScript chunk that fails to load (EPSILON-191, Sentry LABELKIT-8).
 *
 * A dynamic import can fail because a deploy removed the file an open tab still points at, or
 * because the request was cut off (flaky network, a page closed mid-load). Either way the page
 * is stuck: before start-up it never hydrates, and during a navigation it shows the error page.
 * A full page load fetches fresh HTML that names chunks the server does have.
 *
 * SvelteKit already does that during a navigation when it sees a new version. These helpers cover
 * the rest: a failure at start-up, and a failure during a navigation when the version is the same.
 * The full load happens at most once a minute per tab, so a chunk that is really missing can't
 * reload the page in a loop; after one try the error page or the Sentry report stands.
 */

/** What the browser says when an `import()` or a Vite preload fails, by engine. */
const CHUNK_LOAD_MESSAGES = [
	/Failed to fetch dynamically imported module/i, // Chromium
	/error loading dynamically imported module/i, // Firefox
	/Importing a module script failed/i, // Safari
	/Unable to preload CSS/i // Vite's CSS preload
];

export const RELOAD_GUARD_KEY = 'labelkit:chunk-reload-at';
export const RELOAD_GUARD_MS = 60_000;

export function isChunkLoadError(error: unknown): boolean {
	const message =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: typeof (error as { message?: unknown } | null)?.message === 'string'
					? (error as { message: string }).message
					: '';
	return CHUNK_LOAD_MESSAGES.some((pattern) => pattern.test(message));
}

export interface ReloadDeps {
	storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
	now: () => number;
	/** Starts a full page load of `href`. */
	assign: (href: string) => void;
}

/**
 * Does one full page load of `href`, unless this tab already did one in the last minute.
 * Returns whether it did. Without session storage there is no loop guard, so it does nothing.
 */
export function reloadOnce(href: string, deps: ReloadDeps): boolean {
	const { storage, now, assign } = deps;
	if (!storage) return false;
	try {
		const last = Number(storage.getItem(RELOAD_GUARD_KEY));
		const at = now();
		if (Number.isFinite(last) && last > 0 && at - last >= 0 && at - last < RELOAD_GUARD_MS) {
			return false;
		}
		storage.setItem(RELOAD_GUARD_KEY, String(at));
	} catch {
		// Storage that throws (quota, blocked) can't hold the guard.
		return false;
	}
	assign(href);
	return true;
}

export interface ChunkErrorContext {
	/** False until SvelteKit has rendered the first page. */
	started: boolean;
	/** The page being navigated to right now, if any. */
	navigatingTo: string | null;
	/** The URL SvelteKit was loading when the error happened. */
	errorUrl: string;
	/** The address bar. */
	currentUrl: string;
}

/**
 * Where to do the full page load for an error SvelteKit passed to `handleError`, or null for none.
 * Before start-up it's the current page. During a navigation it's the destination. Otherwise the
 * failure came from a preload (a hovered link), and the user hasn't asked to go anywhere yet.
 */
export function chunkReloadTarget(error: unknown, ctx: ChunkErrorContext): string | null {
	if (!isChunkLoadError(error)) return null;
	if (!ctx.started) return ctx.currentUrl;
	if (ctx.navigatingTo !== null && ctx.navigatingTo === ctx.errorUrl) return ctx.errorUrl;
	return null;
}
