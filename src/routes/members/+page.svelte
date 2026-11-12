<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { confirmRemoval } from '#lib/removal-confirmation.js';
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
			? (done.result as { outcome: 'added' | 'already'; email: string })
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
	const inviteFailed = $derived(failed && form?.action === 'invite');
	/** Errors that belong to no single field of the invite form, shown under it. */
	const inviteFormErrors = $derived(
		inviteFailed
			? Object.entries(errors)
					.filter(([k]) => k !== 'email' && k !== 'role')
					.map(([, msg]) => msg)
			: []
	);
	const owners = $derived(data.members.filter((m) => m.role === 'owner').length);
</script>

<noscript
	><p class="soft">
		JavaScript is required to confirm removals. Removal requests without confirmation leave existing
		records unchanged.
	</p></noscript
>

<svelte:head><title>Members · {page.data.brand?.name ?? 'LabelKit'}</title></svelte:head>

<div class="container">
	<section class="spread">
		<div class="stack">
			<div class="eyebrow"><span>{data.orgName}</span><span>{data.members.length}</span></div>
			<h1 class="title">Members</h1>
		</div>
	</section>
	<p class="soft">
		Everyone who can sign in to {data.orgName} in {page.data.brand?.name ?? 'LabelKit'}, and what
		they can do. Changes apply to this label only. A label always keeps at least one owner.
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
							<form method="POST" action="?/role" class="flex items-center gap-2">
								<input type="hidden" name="userId" value={m.userId} />
								<label for="role-{m.userId}" class="sr-only">Role</label>
								<NativeSelect.Root
									id="role-{m.userId}"
									name="role"
									value={m.role}
									disabled={lastOwner}
									size="sm"
								>
									{#each ROLES as [k, l] (k)}<NativeSelect.Option value={k}>{l}</NativeSelect.Option
										>{/each}
								</NativeSelect.Root>
								{#if !lastOwner}<Button type="submit" variant="default" size="small">Save</Button
									>{/if}
							</form>
						</td>
						<td>
							<span class="tag {m.state === 'onboarded' ? '' : 'outline'}">{STATES[m.state]}</span>
						</td>
						<td class="mono muted">{m.since}</td>
						<td class="num">
							{#if !lastOwner}
								<form
									method="POST"
									action="?/remove"
									use:confirmRemoval={() =>
										`Remove ${m.email ?? m.userId} from ${data.orgName}? They will lose access to this label. Their shared sign-in account will remain.`}
								>
									<input type="hidden" name="userId" value={m.userId} />
									<Button type="submit" variant="danger" size="small">Remove</Button>
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
				Add them to {data.orgName} with the chosen role. They can use their invitation or sign in, then
				select this label. A new email is not guaranteed.
			</p>
			<Field.Group class="gap-2.5">
				<Field.Field orientation="responsive">
					<Field.Label for="email">Email</Field.Label>
					<Input
						id="email"
						name="email"
						type="email"
						autocomplete="off"
						value={values.email ?? ''}
						required
						aria-invalid={inviteFailed && errors.email ? true : undefined}
						aria-describedby={inviteFailed && errors.email ? 'email-error' : undefined}
					/>
					{#if inviteFailed && errors.email}
						<Field.Error id="email-error">{errors.email}</Field.Error>
					{/if}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="role">Role</Field.Label>
					<NativeSelect.Root
						id="role"
						name="role"
						value={values.role ?? 'viewer'}
						aria-invalid={inviteFailed && errors.role ? true : undefined}
						aria-describedby={inviteFailed && errors.role ? 'role-error' : undefined}
					>
						{#each ROLES as [k, l] (k)}<NativeSelect.Option value={k}>{l}</NativeSelect.Option
							>{/each}
					</NativeSelect.Root>
					{#if inviteFailed && errors.role}
						<Field.Error id="role-error">{errors.role}</Field.Error>
					{/if}
				</Field.Field>
				<!-- Lines the button up with the controls: the 140 px label column plus the 20 px gap. -->
				<div class="sm:pl-[160px]"><Button type="submit">Send invite</Button></div>
			</Field.Group>
		{:else}
			<p class="soft" style="margin: 0">
				Invites are off on this deploy: the server has no Supabase secret key. Members can still be
				re-roled and removed here.
			</p>
		{/if}
		{#if inviteFormErrors.length}
			<div class="alert error" role="alert">{inviteFormErrors.join('\n')}</div>
		{:else if invited?.outcome === 'added'}
			<div class="alert ok" role="status">
				Member added: {invited.email}. They can use their invitation or sign in, then select
				{data.orgName} in the label switcher.
			</div>
		{:else if invited?.outcome === 'already'}
			<div class="alert ok" role="status">{invited.email} is already a member.</div>
		{/if}
	</form>
	<p class="soft"><a href="/org/close">Close this label</a></p>
</div>
