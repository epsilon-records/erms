<script lang="ts">
	// System / Light / Dark (labelkit 0038). The choice lives in this browser's localStorage under
	// 'theme'; static/theme-init.js applies it before first paint, this control changes it after.
	import { onMount } from 'svelte';

	type Choice = 'system' | 'light' | 'dark';
	const options: { value: Choice; label: string }[] = [
		{ value: 'system', label: 'System' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	];
	let choice = $state<Choice>('system');

	onMount(() => {
		try {
			const saved = localStorage.getItem('theme');
			if (saved === 'light' || saved === 'dark') choice = saved;
		} catch {
			// Storage blocked: stay on System.
		}
	});

	function pick(next: Choice) {
		choice = next;
		const root = document.documentElement;
		if (next === 'system') delete root.dataset.theme;
		else root.dataset.theme = next;
		try {
			if (next === 'system') localStorage.removeItem('theme');
			else localStorage.setItem('theme', next);
		} catch {
			// Storage blocked: the choice lasts for this page only.
		}
	}
</script>

<div class="theme" role="group" aria-label="Theme">
	{#each options as o (o.value)}
		<button type="button" aria-pressed={choice === o.value} onclick={() => pick(o.value)}
			>{o.label}</button
		>
	{/each}
</div>

<style>
	.theme {
		display: inline-flex;
		border: 1px solid var(--line-control);
	}
	button {
		min-height: 44px;
		padding: 0 12px;
		border: 0;
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	button:hover {
		color: var(--text-strong);
	}
	button[aria-pressed='true'] {
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
	}
</style>
