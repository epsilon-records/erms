/**
 * api.labelkit.co: the public API on its own host, as AudioKit serves api.audiokit.ai (knowledge
 * LabelKit decision 0029). The same app answers there, but only the API: `/v1/*` with a Bearer
 * key, the public OpenAPI document at `/v1/openapi.yaml`, and a small JSON index at `/`. Every
 * other path is a JSON 404, so no page, cookie or session ever lives on the API host.
 *
 * `labelkit.co/v1/*` keeps working, so existing keys and scripts don't break.
 */
import { normalizeHost } from './branding';

export const API_HOST = 'api.labelkit.co';
export const API_BASE_URL = `https://${API_HOST}`;
export const OPENAPI_PATH = '/v1/openapi.yaml';

export function isApiHost(host: string | null | undefined): boolean {
	return normalizeHost(host) === API_HOST;
}

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
