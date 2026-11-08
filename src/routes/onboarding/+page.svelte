<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const roleLabel: Record<string, string> = {
		owner: 'Owner',
		catalog_manager: 'Catalog manager',
		rights_admin: 'Rights admin',
		viewer: 'Viewer'
	};

	// First steps that match what this role can actually do.
	const tips = $derived(
		data.role === 'owner' || data.role === 'catalog_manager'
			? [
					{
						href: '/import',
						label: 'Import your catalogue',
						note: 'bring in a SymphonicMS export'
					},
					{ href: '/recordings', label: 'Browse recordings', note: 'check the import landed' },
					// Only owners hold roles:manage, so only they get the invite step.
					...(data.role === 'owner'
						? [
								{
									href: '/members',
									label: 'Invite your team',
									note: 'add members and set their roles'
								}
							]
						: [])
				]
			: data.role === 'rights_admin'
				? [
						{ href: '/rights', label: 'Review rights', note: 'agreements and shares' },
						{ href: '/releases', label: 'Browse releases', note: 'see what is in the catalogue' }
					]
				: [
						{ href: '/releases', label: 'Browse releases', note: 'everything your label has' },
						{ href: '/artists', label: 'Browse artists', note: 'the people on your records' }
					]
	);
</script>

<div class="container">
	<section class="stack" style="max-width: 640px">
		<div class="eyebrow"><span>{data.orgName}</span></div>
		<h1 class="title">Welcome to ERMS</h1>
		<p class="muted" style="margin: 0">
			You're signed in to <strong>{data.orgName}</strong> as {roleLabel[data.role] ?? data.role}.
		</p>
	</section>

	<section class="stack" style="max-width: 640px">
		<h2 class="h2">Start here</h2>
		<ul class="stack" style="list-style: none; padding: 0; margin: 0; gap: 10px">
			{#each tips as tip (tip.href)}
				<li>
					<a href={tip.href}>{tip.label}</a>
					<span class="muted"> — {tip.note}</span>
				</li>
			{/each}
		</ul>
	</section>

	<form method="POST" class="stack" style="max-width: 640px">
		<div>
			<button class="btn primary">Got it, take me in</button>
		</div>
	</form>
</div>
