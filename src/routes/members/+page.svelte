<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const failed = $derived(!!form && 'ok' in form && !form.ok);
	const errors = $derived<Record<string, string>>(
		failed && form && 'errors' in form ? (form.errors ?? {}) : {}
	);
	const values = $derived<Record<string, string>>(
		failed && form && 'values' in form && form.action === 'invite' ? (form.values ?? {}) : {}
	);
	const done = $derived(!!form && 'ok' in form && form.ok ? form : null);
	const invited = $derived(
		done && done.action === 'invite' && 'result' in done
			? (done.result as { outcome: 'added' | 'already'; emailed: boolean; email: string })
			: null
	);

	const ROLES = [
		['owner', 'Owner'],
		['catalog_manager', 'Catalog manager'],
		['rights_admin', 'Rights admin'],
		['viewer', 'Viewer']
	] as const;
	const STATES: Record<string, string> = {
		onboarded: 'onboarded',
		signed_in: 'signed in, not onboarded',
		invited: 'invited, not signed in',
		unknown: 'not onboarded'
	};
	const owners = $derived(data.members.filter((m) => m.role === 'owner').length);
</script>

<svelte:head><title>Members · ERMS</title></svelte:head>

<div class="container">
	<section class="spread">
		<div class="stack">
			<div class="eyebrow"><span>{data.orgName}</span><span>{data.members.length}</span></div>
			<h1 class="title">Members</h1>
		</div>
	</section>
	<p class="soft">
		Everyone who can sign in to {data.orgName} in ERMS, and what they can do. Changes apply to this label
		only. A label always keeps at least one owner.
	</p>

	<div class="table-wrap">
		<table class="data" style="min-width: 780px">
			<thead>
				<tr><th>Member</th><th>Role</th><th>State</th><th>Since</th><th></th></tr>
			</thead>
			<tbody>
				{#each data.members as m (m.userId)}
					{@const lastOwner = m.role === 'owner' && owners === 1}
					<tr>
						<td>
							{#if m.email}<span style="font-weight: 600">{m.email}</span>{:else}<span
									class="mono muted">{m.userId}</span
								>{/if}
							{#if m.userId === data.me}<span class="muted"> · you</span>{/if}
						</td>
						<td>
							<form method="POST" action="?/role" class="row-form">
								<input type="hidden" name="userId" value={m.userId} />
								<label for="role-{m.userId}" class="sr-only">Role</label>
								<select id="role-{m.userId}" name="role" value={m.role} disabled={lastOwner}>
									{#each ROLES as [k, l] (k)}<option value={k}>{l}</option>{/each}
								</select>
								{#if !lastOwner}<button class="btn small">Save</button>{/if}
							</form>
						</td>
						<td>
							<span class="tag {m.state === 'onboarded' ? '' : 'outline'}">{STATES[m.state]}</span>
						</td>
						<td class="mono muted">{m.since}</td>
						<td class="num">
							{#if !lastOwner}
								<form method="POST" action="?/remove">
									<input type="hidden" name="userId" value={m.userId} />
									<button class="btn small danger">Remove</button>
								</form>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if failed && form && form.action !== 'invite'}
		<div class="alert error" role="alert">{Object.values(errors).join('\n')}</div>
	{:else if done?.action === 'role'}
		<div class="alert ok" role="status">Role changed.</div>
	{:else if done?.action === 'remove'}
		<div class="alert ok" role="status">Member removed.</div>
	{/if}

	<form method="POST" action="?/invite" class="stack" aria-labelledby="invite-h">
		<h2 id="invite-h" class="h2">Invite someone</h2>
		{#if data.invitesOn}
			<p class="soft" style="margin: 0">
				They get an email with a sign-in link to {data.orgName}, then a short welcome page. The link
				works once.
			</p>
			<div class="form-grid">
				<label for="email">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="off"
					value={values.email ?? ''}
					required
				/>
				<label for="role">Role</label>
				<select id="role" name="role" value={values.role ?? 'viewer'}>
					{#each ROLES as [k, l] (k)}<option value={k}>{l}</option>{/each}
				</select>
				<span></span>
				<div><button class="btn primary">Send invite</button></div>
			</div>
		{:else}
			<p class="soft" style="margin: 0">
				Invites are off on this deploy: the server has no Supabase secret key. Members can still be
				re-roled and removed here.
			</p>
		{/if}
		{#if failed && form?.action === 'invite'}
			<div class="alert error" role="alert">
				{Object.entries(errors)
					.map(([k, msg]) => (k === 'form' ? msg : `${k}: ${msg}`))
					.join('\n')}
			</div>
		{:else if invited?.outcome === 'added' && invited.emailed}
			<div class="alert ok" role="status">Invite sent to {invited.email}.</div>
		{:else if invited?.outcome === 'added'}
			<div class="alert ok" role="status">
				{invited.email} already has an ERMS account, so no email was sent. {data.orgName} appears in their
				label switcher the next time they sign in.
			</div>
		{:else if invited?.outcome === 'already' && invited.emailed}
			<div class="alert ok" role="status">
				{invited.email} was already invited and has not signed in yet; the invite was sent again.
			</div>
		{:else if invited?.outcome === 'already'}
			<div class="alert ok" role="status">{invited.email} is already a member.</div>
		{/if}
	</form>
</div>

<style>
	.row-form {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.row-form select {
		width: auto;
		padding: 6px 10px;
	}
</style>
