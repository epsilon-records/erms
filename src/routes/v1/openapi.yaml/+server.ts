import spec from '../../../../docs/openapi.yaml?raw';
import type { RequestHandler } from './$types';

/** The public OpenAPI document, on api.labelkit.co and labelkit.co alike. No key needed. */
export const GET: RequestHandler = () =>
	new Response(spec, {
		headers: {
			'Content-Type': 'application/yaml; charset=utf-8',
			'Cache-Control': 'public, max-age=300',
			'Access-Control-Allow-Origin': '*'
		}
	});
