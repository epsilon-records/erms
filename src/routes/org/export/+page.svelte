<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
	const total = $derived(data.masters.reduce((n, m) => n + m.sizeBytes, 0));
</script>

<svelte:head><title>Export · {page.data.brand?.name ?? 'LabelKit'}</title></svelte:head>

<div class="container">
	<section class="stack">
		<div class="eyebrow"><span>{data.orgName}</span></div>
		<h1 class="title">Export</h1>
		<p class="soft">
			Your catalogue is yours. Download a complete copy any time: every release, recording, credit,
			split, agreement, consent and analysis result, as one JSON file. Master files download
			separately below.
		</p>
		<p><a class="btn primary" href="/org/export/catalog" download>Download catalogue (JSON)</a></p>
	</section>

	<section class="stack">
		<h2 class="h2">Masters</h2>
		{#if data.masters.length === 0}
			<p class="soft">No masters uploaded yet.</p>
		{:else}
			<p class="soft">
				{data.masters.length} files, {mb(total)} in total. Each link is valid for 15 minutes once opened.
			</p>
			<div class="table-wrap">
				<table class="data">
					<thead><tr><th>Recording</th><th>File</th><th>Size</th><th></th></tr></thead>
					<tbody>
						{#each data.masters as master (master.id)}
							<tr>
								<td>{master.recording}</td>
								<td>{master.fileName}</td>
								<td>{mb(master.sizeBytes)}</td>
								<td><a href="/org/export/masters/{master.id}">Download</a></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
