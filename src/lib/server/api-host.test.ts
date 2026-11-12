import { describe, expect, it } from 'vitest';
import { API_INDEX, apiHostRoute, isApiHost, servesApiForTesting } from './api-host';

describe('api.labelkit.co', () => {
	it('recognises the API host, whatever the case, port or trailing dot', () => {
		for (const host of [
			'api.labelkit.co',
			'API.LabelKit.co',
			'api.labelkit.co:443',
			'api.labelkit.co.'
		])
			expect(isApiHost(host), host).toBe(true);
		for (const host of [
			'labelkit.co',
			'erms.epsilonrecords.com',
			'api.labelkit.co.evil.com',
			'',
			null
		])
			expect(isApiHost(host), String(host)).toBe(false);
	});

	it('serves only the API: index, OpenAPI document and /v1; everything else is a 404', () => {
		expect(apiHostRoute('/')).toBe('index');
		expect(apiHostRoute('/v1/openapi.yaml')).toBe('openapi');
		expect(apiHostRoute('/v1/releases')).toBe('api');
		expect(apiHostRoute('/v1/recordings/abc')).toBe('api');
		for (const path of [
			'/login',
			'/org/billing',
			'/api/app-metrics',
			'/api/auth/send-email',
			'/v1',
			'/favicon.ico'
		])
			expect(apiHostRoute(path), path).toBe('not_found');
	});

	it('points the index at the OpenAPI document on the API host', () => {
		expect(API_INDEX.openapi).toBe('https://api.labelkit.co/v1/openapi.yaml');
	});

	it('serves /v1 for testing only on local hosts and LabelKit deploy previews', () => {
		for (const host of [
			'localhost:5173',
			'127.0.0.1',
			'deploy-preview-93--labelkit.netlify.app',
			'main--labelkit.netlify.app'
		])
			expect(servesApiForTesting(host), host).toBe(true);
		for (const host of [
			'labelkit.co',
			'erms.epsilonrecords.com',
			'deploy-preview-1--evil.netlify.app',
			'labelkit.netlify.app.evil.com',
			null
		])
			expect(servesApiForTesting(host), String(host)).toBe(false);
	});
});
