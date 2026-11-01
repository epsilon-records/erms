<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const kinds = ['labels', 'parties', 'recordings', 'releases', 'tracks', 'credits'] as const;
	const pad = (s: string | number, n: number) => String(s).padEnd(n, ' ');
	const lpad = (s: string | number, n: number) => String(s).padStart(n, ' ');

	// Built as strings: a <pre> keeps template indentation, which would skew the columns.
	const countsTable = $derived.by(() => {
		if (!form || !('counts' in form) || !form.counts) return '';
		const c = form.counts;
		const head = `${pad('', 12)}${lpad('create', 8)}${lpad('update', 8)}${lpad('same', 8)}`;
		const lines = kinds.map(
			(k) =>
				`${pad(k, 12)}${lpad(c[k].created, 8)}${lpad(c[k].updated, 8)}${lpad(c[k].unchanged, 8)}`
		);
		return [head, ...lines].join('\n');
	});
	const issuesText = $derived.by(() => {
		if (!form || !('issues' in form) || !form.issues?.length) return '';
		const lines = form.issues.map(
			(i) =>
				`${i.level === 'error' ? '!' : '~'} ${i.line != null ? `line ${pad(i.line, 4)}` : '         '} ${i.message}`
		);
		if (form.moreIssues) lines.push(`… and ${form.moreIssues} more`);
		return lines.join('\n');
	});
	const runsText = $derived(
		data.runs
			.map((r) => `${r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}  ${r.fileName}`)
			.join('\n')
	);
</script>

<pre>&gt; IMPORT :: SymphonicMS inventory export</pre>

{#if !form || !('stage' in form) || form.stage === 'blocked'}
	<form method="POST" action="?/preview" enctype="multipart/form-data">
		<label>file: <input type="file" name="file" accept=".csv,text/csv" required /></label>
		<button>[ dry run ]</button>
	</form>
	<pre class="dim">A dry run changes nothing. It shows what the import would create or update.</pre>
{/if}

{#if form && 'error' in form && form.error}
	<pre class="err">! {form.error}</pre>
{/if}

{#if form && 'summary' in form && form.summary}
	<pre>
FILE ........ {form.fileName}
SHA-256 ..... {form.sha256?.slice(0, 16)}…
ROWS ........ {form.summary.rows}
RELEASES .... {form.summary.releases}
RECORDINGS .. {form.summary.recordings}
ARTISTS ..... {form.summary.parties}
LABELS ...... {form.summary.labels}
ERRORS ...... {form.summary.errors}
WARNINGS .... {form.summary.warnings}</pre>

	{#if countsTable}
		<pre>{countsTable}</pre>
	{/if}

	{#if form.stage === 'previewed'}
		<form method="POST" action="?/apply">
			<input type="hidden" name="csv" value={form.csv} />
			<input type="hidden" name="fileName" value={form.fileName} />
			<input type="hidden" name="sha256" value={form.sha256} />
			<button>[ import now ]</button>
			<a href="/import">[ cancel ]</a>
		</form>
	{:else if form.stage === 'imported'}
		<pre class="ok">&gt; Imported. <a href="/releases">[ view releases ]</a></pre>
	{:else if form.stage === 'blocked'}
		<pre
			class="err">! Fix the errors below in SymphonicMS or the file, then run the dry run again.</pre>
	{/if}

	{#if issuesText}
		<pre>{issuesText}</pre>
	{/if}
{/if}

{#if runsText}
	<pre class="dim">RECENT IMPORTS
{runsText}</pre>
{/if}

<style>
	.err {
		color: #ff6b6b;
	}
	.ok {
		color: #7cff7c;
	}
	.dim {
		color: #8a8a8a;
	}
	form {
		display: flex;
		gap: 2ch;
		align-items: center;
		flex-wrap: wrap;
	}
</style>
