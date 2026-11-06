<script lang="ts">
	import type { Analysis, AnalysisCardKey } from '#lib/analysis.js';

	let {
		recordingId,
		analysis,
		canRun = false,
		previewPlayable = false,
		runError = null,
		queued = false
	}: {
		recordingId: string;
		analysis: Analysis;
		canRun?: boolean;
		previewPlayable?: boolean;
		runError?: string | null;
		queued?: boolean;
	} = $props();

	const order: AnalysisCardKey[] = [
		'loudness',
		'probe',
		'waveform',
		'preview',
		'tempo',
		'key',
		'tags'
	];
	const cards = $derived(order.map((key) => analysis[key]));

	function rec(value: unknown): Record<string, unknown> {
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	}
	const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
	const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

	const lufs = (value: unknown) =>
		value == null ? 'silence' : `${num(value)?.toFixed(1) ?? '—'} LUFS`;
	const dbtp = (value: unknown) =>
		value == null ? 'silence' : `${num(value)?.toFixed(2) ?? '—'} dBTP`;
	const ratio = (value: unknown) =>
		num(value) == null ? '—' : `${Math.round((num(value) ?? 0) * 100)}%`;

	function clock(seconds: unknown) {
		const s = num(seconds);
		if (s == null) return '—';
		const whole = Math.round(s);
		return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
	}

	const sampleRate = (value: unknown) => {
		const n = num(value);
		return n == null ? '—' : `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)} kHz`;
	};
	const channels = (value: unknown) => {
		const n = num(value);
		if (n == null) return '—';
		return n === 1 ? 'mono' : n === 2 ? 'stereo' : `${n} channels`;
	};

	/** Downsample peaks so the SVG stays small no matter how many points AudioKit sent. */
	function bars(peaks: unknown, max = 400): number[] {
		if (!Array.isArray(peaks)) return [];
		const values = peaks.map((p) => (typeof p === 'number' ? Math.min(1, Math.max(0, p)) : 0));
		if (values.length <= max) return values;
		const step = values.length / max;
		const out: number[] = [];
		for (let i = 0; i < max; i++) {
			let peak = 0;
			for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++)
				peak = Math.max(peak, values[j] ?? 0);
			out.push(peak);
		}
		return out;
	}

	function tagGroups(value: unknown): { name: string; tags: { tag: string; score: number }[] }[] {
		const groups: { name: string; tags: { tag: string; score: number }[] }[] = [];
		for (const [name, raw] of Object.entries(rec(value))) {
			if (name === 'model' || name === 'windows' || name === 'embedding') continue;
			if (!Array.isArray(raw)) continue;
			const tags = raw
				.map((entry) => ({ tag: str(rec(entry).tag), score: num(rec(entry).score) }))
				.filter((t): t is { tag: string; score: number } => t.tag !== null && t.score !== null)
				.sort((a, b) => b.score - a.score)
				.slice(0, 6);
			if (tags.length) groups.push({ name, tags });
		}
		return groups;
	}
</script>

{#if runError}
	<div class="alert error" role="alert">{runError}</div>
{:else if queued}
	<div class="alert ok" role="status">Analysis job queued.</div>
{/if}

<div class="analysis">
	{#each cards as card (card.key)}
		<article class="card">
			<header class="card-head">
				<h3 class="card-title">{card.label}</h3>
				{#if card.status === 'done'}
					<span class="tag">Done</span>
				{:else if card.status === 'failed'}
					<span class="tag danger">Failed</span>
				{:else}
					<span class="pending">Pending</span>
				{/if}
			</header>

			{#if card.status === 'failed'}
				<p class="alert error reason" role="alert">{card.reason}</p>
			{/if}

			{#if card.result}
				{#if card.key === 'loudness'}
					<div class="figures">
						<div class="figure">
							<span class="value">{lufs(rec(card.result).integrated_lufs)}</span>
							<span class="label">Integrated</span>
						</div>
						<div class="figure">
							<span class="value">{dbtp(rec(card.result).true_peak_dbtp)}</span>
							<span class="label">True peak</span>
						</div>
						<div class="figure">
							<span class="value"
								>{num(rec(card.result).loudness_range_lu)?.toFixed(1) ?? '—'} LU</span
							>
							<span class="label">Range</span>
						</div>
					</div>
				{:else if card.key === 'probe'}
					<dl class="mini">
						<dt>Duration</dt>
						<dd class="mono">{clock(rec(card.result).duration_seconds)}</dd>
						<dt>Format</dt>
						<dd class="mono">
							{[str(rec(card.result).container), str(rec(card.result).codec)]
								.filter(Boolean)
								.join(' · ') || '—'}
						</dd>
						<dt>Stream</dt>
						<dd class="mono">
							{sampleRate(rec(card.result).sample_rate)} · {channels(rec(card.result).channels)}
							{#if num(rec(card.result).bits_per_sample) != null}
								· {num(rec(card.result).bits_per_sample)}-bit
							{/if}
						</dd>
					</dl>
				{:else if card.key === 'waveform'}
					{@const peaks = bars(rec(card.result).peaks)}
					{#if peaks.length}
						<svg
							class="wave"
							viewBox="0 0 {peaks.length * 2} 100"
							preserveAspectRatio="none"
							role="img"
							aria-label="Waveform"
						>
							{#each peaks as peak, i}
								<rect x={i * 2} y={50 - peak * 48} width="1.4" height={Math.max(1.5, peak * 96)} />
							{/each}
						</svg>
					{:else}
						<p class="soft">AudioKit returned no waveform points.</p>
					{/if}
				{:else if card.key === 'preview'}
					{#if previewPlayable}
						<audio controls preload="none" src={`/recordings/${recordingId}/analysis/audio`}
						></audio>
					{:else}
						<p class="soft">Preview rendering is not configured yet.</p>
					{/if}
				{:else if card.key === 'tempo'}
					<div class="figures">
						<div class="figure">
							<span class="value">{num(rec(card.result).bpm)?.toFixed(1) ?? '—'}</span>
							<span class="label">BPM</span>
						</div>
						<div class="figure">
							<span class="value">{ratio(rec(card.result).confidence)}</span>
							<span class="label">Confidence</span>
						</div>
						<div class="figure">
							<span class="value">{rec(card.result).steady ? 'Yes' : 'No'}</span>
							<span class="label">Steady</span>
						</div>
					</div>
				{:else if card.key === 'key'}
					<div class="figures">
						<div class="figure">
							<span class="value">{str(rec(card.result).key) ?? '—'}</span>
							<span class="label">Key</span>
						</div>
						<div class="figure">
							<span class="value">{str(rec(card.result).camelot) ?? '—'}</span>
							<span class="label">Camelot</span>
						</div>
						<div class="figure">
							<span class="value">{ratio(rec(card.result).confidence)}</span>
							<span class="label">Confidence</span>
						</div>
					</div>
				{:else if card.key === 'tags'}
					{@const groups = tagGroups(card.result)}
					{#if groups.length}
						<div class="tags">
							{#each groups as group (group.name)}
								<div class="tag-group">
									<span class="tag-name mono">{group.name}</span>
									<span class="tag-list">
										{#each group.tags as t (t.tag)}
											<span class="tag outline">{t.tag}</span>
										{/each}
									</span>
								</div>
							{/each}
						</div>
					{:else}
						<p class="soft">No tags for this master.</p>
					{/if}
				{/if}
			{:else if card.status === 'failed'}
				<!-- the reason is shown above -->
			{:else if card.status === 'pending'}
				<p class="soft">{card.jobId ? 'Processing…' : 'Not run yet.'}</p>
			{:else}
				<p class="soft">No result for this master.</p>
			{/if}

			{#if card.resultJobId && card.status !== 'done'}
				<p class="stale">Showing the last successful result.</p>
			{/if}

			{#if canRun}
				<form method="POST" action="?/runAnalysis" class="rerun">
					<input type="hidden" name="operation" value={card.key} />
					<button class="btn small" disabled={card.status === 'pending' && card.jobId !== null}>
						{card.jobId === null ? 'Run' : 'Re-run'}
					</button>
				</form>
			{/if}
		</article>
	{/each}
</div>

<style>
	.analysis {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		border-top: 1px solid var(--line-strong);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px 24px 20px 0;
		border-bottom: 1px solid var(--line);
		min-width: 0;
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.card-title {
		font-size: 14px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.tag.danger {
		background: var(--danger);
		border-color: var(--danger);
		color: var(--on-accent);
	}
	.reason {
		font-size: 13px;
	}
	.stale {
		margin: 0;
		font-size: 12px;
		color: var(--muted);
	}
	.figures {
		display: flex;
		flex-wrap: wrap;
		gap: 16px 24px;
	}
	.figure {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.figure .value {
		font-size: 22px;
		font-weight: 700;
		line-height: 1.1;
		color: var(--text-strong);
		font-variant-numeric: tabular-nums;
	}
	.figure .label {
		font-size: 12px;
		color: var(--muted);
	}
	dl.mini {
		margin: 0;
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 4px 16px;
		font-size: 13px;
	}
	dl.mini dt {
		color: var(--muted);
	}
	dl.mini dd {
		margin: 0;
	}
	.wave {
		display: block;
		width: 100%;
		height: 72px;
		fill: var(--accent);
	}
	audio {
		width: 100%;
	}
	.tags {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.tag-group {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.tag-name {
		font-size: 12px;
		color: var(--muted);
	}
	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.rerun {
		margin-top: auto;
	}
</style>
