<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
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

	// A master stays `verifying` until the background check finishes, usually within a few
	// minutes. Refresh while one is, so it turns Ready (or Rejected) without a reload.
	const checking = $derived(masters.some((m) => m.status === 'verifying'));
	$effect(() => {
		if (!checking) return;
		const timer = setInterval(() => invalidateAll(), 20_000);
		return () => clearInterval(timer);
	});
	const pct = $derived(progress ? Math.floor((progress.sent / progress.total) * 100) : 0);

	function size(bytes: number) {
		const units = ['B', 'KB', 'MB', 'GB'];
		let n = bytes;
		let u = 0;
		while (n >= 1024 && u < units.length - 1) {
			n /= 1024;
			u++;
		}
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

	/** The master whose delete is waiting for confirmation (decision 0023). */
	let confirming = $state<string | null>(null);

	/** Delete a master once the person has confirmed it inline. The DELETE route refuses a
	 * request without `removalConfirmed`, then removes the R2 object and the row in one audited
	 * transaction. */
	async function remove(m: Master) {
		confirming = null;
		message = null;
		deleting = m.id;
		try {
			const res = await fetch(`/recordings/${recordingId}/masters/${m.id}`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ removalConfirmed: 'yes' })
			});
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

	/** Move focus into the confirmation when it opens, so keyboard users land on it. */
	function focusOnMount(node: HTMLElement) {
		node.focus();
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
				res.status === 'verifying'
					? {
							kind: 'ok',
							text: `Uploaded ${file.name}. LabelKit is checking the file; it can be used once it shows Ready.`
						}
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
							{:else if m.status === 'verifying'}<span
									class="tag outline"
									title="Uploaded. LabelKit is checking the file before it can be used."
									>Checking</span
								>
							{:else}<span class="tag outline">{m.status}</span>{/if}
						</td>
						{#if canDelete}
							<td>
								{#if confirming === m.id}
									<div
										class="confirm"
										role="group"
										aria-labelledby="confirm-{m.id}"
										tabindex="-1"
										use:focusOnMount
									>
										<span id="confirm-{m.id}" class="confirm-text"
											>Delete {m.fileName}? The file and its record are removed for good.</span
										>
										<span class="inline-form">
											<Button variant="danger" size="small" onclick={() => remove(m)}
												>Delete master</Button
											>
											<Button size="small" onclick={() => (confirming = null)}>Keep</Button>
										</span>
									</div>
								{:else}
									<Button
										variant="danger"
										size="small"
										disabled={deleting === m.id}
										aria-label="Delete {m.fileName}"
										onclick={() => (confirming = m.id)}
									>
										{deleting === m.id ? 'Deleting…' : 'Delete'}
									</Button>
								{/if}
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
			<Button type="submit" variant="primary" size="small" disabled={!file || busy}
				>Upload master</Button
			>
			{#if busy}
				<Button size="small" onclick={() => controller?.abort()}>Cancel</Button>
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

<style>
	.confirm {
		display: grid;
		gap: 8px;
		padding: 8px 10px;
		border-left: 2px solid var(--danger);
		outline-offset: 2px;
	}
	.confirm-text {
		font-size: 13px;
	}
</style>
