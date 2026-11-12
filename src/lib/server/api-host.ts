/**
 * api.labelkit.co: the public API on its own host, as AudioKit serves api.audiokit.ai (knowledge
 * LabelKit decision 0029). The same app answers there, but only the API: `/v1/*` with a Bearer
 * key, the public OpenAPI document at `/v1/openapi.yaml`, and a small JSON index at `/`. Every
 * other path is a JSON 404, so no page, cookie or session ever lives on the API host.
 *
 * The API is not served on labelkit.co or any label's custom domain: `/v1/*` there answers a JSON
 * 404 that names the API host (Nate, 2026-11-12; no keys existed yet). Local development and
 * Netlify deploy previews still serve it, so it can be tried before release.
 */
import { normalizeHost } from './branding';

export const API_HOST = 'api.labelkit.co';
export const API_BASE_URL = `https://${API_HOST}`;
export const OPENAPI_PATH = '/v1/openapi.yaml';

export function isApiHost(host: string | null | undefined): boolean {
	return normalizeHost(host) === API_HOST;
}

/** Hosts that may serve `/v1` besides the API host: local development and deploy previews. */
export function servesApiForTesting(host: string | null | undefined): boolean {
	const h = normalizeHost(host);
	if (!h) return false;
	return (
		h === 'localhost' ||
		h === '127.0.0.1' ||
		h === '[::1]' ||
		/^deploy-preview-\d+--labelkit\.netlify\.app$/.test(h) ||
		/^[a-z0-9-]+--labelkit\.netlify\.app$/.test(h)
	);
}

/** The body of `/v1/*` on a host that doesn't serve the API. */
export const API_MOVED = {
	error: { code: 'not_found', message: `The LabelKit API is at ${API_BASE_URL}.` }
} as const;

export type ApiHostRoute = 'index' | 'openapi' | 'api' | 'not_found';

/** What the API host does with a path. */
export function apiHostRoute(path: string): ApiHostRoute {
	if (path === '/') return 'index';
	if (path === OPENAPI_PATH) return 'openapi';
	if (path.startsWith('/v1/')) return 'api';
	return 'not_found';
}

/** The body of `GET /` on the API host. */
export const API_INDEX = {
	name: 'LabelKit API',
	version: 'v1',
	openapi: `${API_BASE_URL}${OPENAPI_PATH}`,
	auth: 'Authorization: Bearer lk_… (create a key on the API keys page in LabelKit)'
} as const;
