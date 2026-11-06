<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { wavProblem } from '#lib/masters.js';
	import { type Progress, uploadMaster } from '#lib/upload-master.js';

	type Master = {
		id: string;
		fileName: string;
		format: string;
		sizeBytes: number;
		sha256: string | null;
		status: string;
		createdAt: Date | string;
		completedAt: Date | string | null;
	};

	let {
		recordingId,
		masters,
		canUpload = false,
		canDelete = false,
		enabled = false
	}: {
		recordingId: string;
		masters: Master[];
		canUpload?: boolean;
		canDelete?: boolean;
		enabled?: boolean;
	} = $props();

	let file = $state<File | null>(null);
	let progress = $state<Progress | null>(null);
	let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	let controller: AbortController | null = null;
	let deleting = $state<string | null>(null);

	const busy = $derived(progress !== null);
	const pct = $derived(progress ? Math.floor((progress.sent / progress.total) * 100) : 0);

	function size(bytes: number) {
		const units = ['B', 'KB', 'MB', 'GB'];
		let n = bytes;
		let u = 0;
		while (n >= 1024 && u < units.length - 1) ((n /= 1024), u++);
		return `${n.toFixed(u ? 1 : 0)} ${units[u]}`;
	}

	function choose(e: Event) {
		message = null;
		const f = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		const problem = f && wavProblem(f);
		if (problem) {
			message = { kind: 'error', text: problem };
			file = null;
		} else file = f;
	}

	/** Delete a master after the browser's confirm. The DELETE route removes the R2 object
	 * and the row in one audited transaction. */
	async function remove(m: Master) {
		if (!confirm(`Delete the master ${m.fileName}? The file and its record are removed for good.`))
			return;
		message = null;
		deleting = m.id;
		try {
			const res = await fetch(`/recordings/${recordingId}/masters/${m.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Delete failed (${res.status}).`);
			}
			message = { kind: 'ok', text: `Deleted ${m.fileName}.` };
			await invalidateAll();
		} catch (err) {
			message = { kind: 'error', text: err instanceof Error ? err.message : String(err) };
		} finally {
			deleting = null;
		}
	}

	async function upload(e: SubmitEvent) {
		e.preventDefault();
		if (!file) return;
		message = null;
		controller = new AbortController();
		progress = { phase: 'uploading', sent: 0, total: file.size };
		try {
			const res = await uploadMaster(recordingId, file, (p) => (progress = p), controller.signal);
			message =
				res.status === 'ready'
					? { kind: 'ok', text: `Uploaded ${file.name}.` }
					: { kind: 'error', text: `Rejected: ${res.reason}` };
			file = null;
			(e.currentTarget as HTMLFormElement | null)?.reset();
		} catch (err) {
			message = { kind: 'error', text: err instanceof Error ? err.message : String(err) };
		} finally {
			progress = null;
			controller = null;
			await invalidateAll();
		}
	}
</script>

{#if masters.length}
	<div class="table-wrap">
		<table class="data">
			<thead>
				<tr>
					<th>File</th>
					<th class="num">Size</th>
					<th>SHA-256</th>
					<th>Status</th>
					{#if canDelete}<th class="sr-only">Actions</th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each masters as m (m.id)}
					<tr>
						<td>{m.fileName} <span class="muted mono">{m.format.toUpperCase()}</span></td>
						<td class="num mono">{size(m.sizeBytes)}</td>
						<td class="mono" title={m.sha256 ?? ''}
							>{m.sha256 ? `${m.sha256.slice(0, 12)}…` : '—'}</td
						>
						<td>
							{#if m.status === 'ready'}<span class="tag">Ready</span>
							{:else}<span class="tag outline">{m.status}</span>{/if}
						</td>
						{#if canDelete}
							<td>
								<button
									class="btn small"
									type="button"
									disabled={deleting === m.id}
									onclick={() => remove(m)}
								>
									{deleting === m.id ? 'Deleting…' : 'Delete'}
								</button>
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<p class="soft">No master uploaded yet.</p>
{/if}

{#if canUpload}
	{#if enabled}
		<form class="inline-form" onsubmit={upload} aria-label="Upload a master">
			<label for="master-file" class="sr-only">WAV master</label>
			<input
				id="master-file"
				type="file"
				accept=".wav,audio/wav,audio/x-wav,audio/wave"
				onchange={choose}
				disabled={busy}
			/>
			<button class="btn small primary" disabled={!file || busy}>Upload master</button>
			{#if busy}
				<button type="button" class="btn small" onclick={() => controller?.abort()}>Cancel</button>
			{/if}
		</form>
		{#if progress}
			<div role="status" aria-live="polite">
				<span class="mono muted">
					{progress.phase === 'finishing'
						? 'Checking the file…'
						: `${pct}% · ${size(progress.sent)} of ${size(progress.total)}`}
				</span>
				<span class="bar" aria-hidden="true"><span style="width: {pct}%"></span></span>
			</div>
		{/if}
	{:else}
		<p class="muted">Master uploads aren't set up yet (R2 storage is not configured).</p>
	{/if}
{/if}

{#if message}
	<div class="alert {message.kind}" role={message.kind === 'error' ? 'alert' : 'status'}>
		{message.text}
	</div>
{/if}
