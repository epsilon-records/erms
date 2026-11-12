// Temporary probe (deploy previews only): which header names can a declaration match on?
/** @param {Request} request */
export default async (request) =>
	new Response(JSON.stringify({ host: request.headers.get('host'), url: request.url }), {
		headers: { 'content-type': 'application/json', 'x-probe': new URL(request.url).pathname }
	});
