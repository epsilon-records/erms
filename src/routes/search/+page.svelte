<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.js';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const r = $derived(data.results);
	const total = $derived(r.releases.length + r.recordings.length + r.artists.length);
</script>

<svelte:head>
	<title>{r.query ? `${r.query} · Search` : 'Search'} · {page.data.brand?.name ?? 'LabelKit'}</title
	>
</svelte:head>

<div class="container">
	<section class="spread">
		<div class="stack">
			<div class="eyebrow">
				<span>{r.query ? `${total} result${total === 1 ? '' : 's'}` : 'Search'}</span>
			</div>
			<h1 class="title">{r.query ? `“${r.query}”` : 'Search the catalog'}</h1>
		</div>
		<form method="GET" action="/search" role="search" style="width: 360px; max-width: 100%">
			<label for="search-page-q" class="sr-only">Search the catalog</label>
			<Input
				id="search-page-q"
				name="q"
				type="search"
				value={r.query}
				placeholder="Title, artist, ISRC, UPC, cat#"
			/>
		</form>
	</section>

	{#if !r.query}
		<p class="soft">
			Search releases, recordings and artists. Words match from the start ("vex ra" finds Vexo
			Rand), accents don't matter, and ISRC, UPC and catalog numbers work with or without dashes.
		</p>
	{:else if total === 0}
		<p class="soft">Nothing matches. Try fewer words or the start of a name.</p>
	{/if}

	{#if r.releases.length}
		<section class="stack" aria-labelledby="h-releases">
			<h2 id="h-releases" class="eyebrow"><span>Releases · {r.releases.length}</span></h2>
			<div class="table-wrap">
				<table class="data" style="min-width: 720px">
					<thead>
						<tr>
							<th>Date</th>
							<th>Title</th>
							<th>Artist</th>
							<th>Cat#</th>
							<th>UPC</th>
							<th>Label</th>
						</tr>
					</thead>
					<tbody>
						{#each r.releases as x (x.id)}
							<tr>
								<td class="mono muted">{x.releaseDate ?? '—'}</td>
								<td>
									<a
										href="/releases/{x.id}"
										class="plain"
										style="font-weight: 600; color: var(--text-strong)">{x.title}</a
									>{#if x.versionTitle}<span class="muted"> · {x.versionTitle}</span>{/if}
								</td>
								<td>{x.artists.join(', ') || '—'}</td>
								<td class="mono">{x.catalogNumber ?? '—'}</td>
								<td class="mono muted">{x.upc}</td>
								<td class="muted">{x.label}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	{#if r.recordings.length}
		<section class="stack" aria-labelledby="h-recordings">
			<h2 id="h-recordings" class="eyebrow"><span>Recordings · {r.recordings.length}</span></h2>
			<div class="table-wrap">
				<table class="data" style="min-width: 620px">
					<thead>
						<tr>
							<th>Title</th>
							<th>Artist</th>
							<th>ISRC</th>
						</tr>
					</thead>
					<tbody>
						{#each r.recordings as x (x.id)}
							<tr>
								<td>
									<a
										href="/recordings/{x.id}"
										class="plain"
										style="font-weight: 600; color: var(--text-strong)">{x.title}</a
									>{#if x.versionTitle}<span class="muted"> · {x.versionTitle}</span>{/if}
								</td>
								<td>{x.artists.join(', ') || '—'}</td>
								<td class="mono muted">{x.isrc}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	{#if r.artists.length}
		<section class="stack" aria-labelledby="h-artists">
			<h2 id="h-artists" class="eyebrow"><span>Artists · {r.artists.length}</span></h2>
			<div class="table-wrap">
				<table class="data" style="min-width: 420px">
					<thead>
						<tr>
							<th>Name</th>
							<th class="num">Credits</th>
						</tr>
					</thead>
					<tbody>
						{#each r.artists as x (x.id)}
							<tr>
								<td
									><a
										href="/artists/{x.id}"
										class="plain"
										style="font-weight: 600; color: var(--text-strong)">{x.name}</a
									></td
								>
								<td class="num mono">{x.credits}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>
