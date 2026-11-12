// ESLint (EPSILON-174): bugs and Svelte-specific mistakes. Formatting stays with Prettier.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	{
		ignores: [
			'.svelte-kit/',
			'build/',
			'.netlify/',
			'node_modules/',
			'drizzle/',
			'coverage/',
			// A standalone fixture app for the metrics privacy test, outside this project's tsconfig.
			'scripts/fixtures/'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				// Replaced at build time by vite.config.ts.
				__SENTRY_ENVIRONMENT__: 'readonly',
				__SENTRY_RELEASE__: 'readonly'
			}
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		rules: {
			// Unused arguments are fine when prefixed with _.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			],
			// {@html} only where a comment explains why the content is safe.
			'svelte/no-at-html-tags': 'error',
			// LabelKit has no base path, so plain hrefs are correct; resolve() everywhere would only add noise.
			'svelte/no-navigation-without-resolve': 'off'
		}
	}
);
