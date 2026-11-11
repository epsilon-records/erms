<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
	const live = $derived(data.keys.filter((k) => !k.revokedAt));
	const revoked = $derived(data.keys.filter((k) => k.revokedAt));
</script>

<svelte:head><title>API keys · {page.data.brand?.name ?? 'LabelKit'}</title></svelte:head>

<div class="container">
	<section class="stack">
		<div class="eyebrow"><span>{data.orgName}</span></div>
		<h1 class="title">API keys</h1>
		<p class="soft">
			Keys for the LabelKit API at <code>/v1</code>. A key reads this label's catalogue and can
			request analysis, never more. Send it as <code>Authorization: Bearer lk_…</code>.
		</p>
	</section>

	{#if form && 'created' in form && form.created}
		<div class="alert ok" role="status">
			<p>
				Key <strong>{form.created.name}</strong> created. Copy it now: it is not shown again.
			</p>
			<p><code>{form.created.key}</code></p>
		</div>
	{/if}
	{#if form && 'error' in form && form.error}
		<div class="alert error" role="alert">{form.error}</div>
	{/if}

	<section class="stack">
		<h2 class="h2">New key</h2>
		<form method="POST" action="?/create" class="stack">
			<label>
				Name
				<input name="name" maxlength="60" required placeholder="Website sync" />
			</label>
			<fieldset>
				<legend>Scopes</legend>
				{#each data.scopes as scope (scope)}
					<label
						><input
							type="checkbox"
							name="scopes"
							value={scope}
							checked={scope === 'catalog:read'}
						/>
						{scope}</label
					>
				{/each}
			</fieldset>
			<div><button class="btn primary">Create key</button></div>
		</form>
	</section>

	<section class="stack">
		<h2 class="h2">Live keys</h2>
		{#if live.length === 0}
			<p class="soft">No live keys.</p>
		{:else}
			<div class="table-wrap">
				<table class="data">
					<thead
						><tr
							><th>Name</th><th>Key</th><th>Scopes</th><th>Created</th><th>Last used</th><th
							></th></tr
						></thead
					>
					<tbody>
						{#each live as key (key.id)}
							<tr>
								<td>{key.name}</td>
								<td><code>lk_{key.prefix}_…</code></td>
								<td>{key.scopes.join(', ')}</td>
								<td>{day(key.createdAt)}</td>
								<td>{day(key.lastUsedAt)}</td>
								<td>
									<form method="POST" action="?/revoke">
										<input type="hidden" name="id" value={key.id} />
										<button class="linkish">Revoke</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		{#if revoked.length}
			<p class="soft">{revoked.length} revoked {revoked.length === 1 ? 'key' : 'keys'}.</p>
		{/if}
	</section>
</div>
