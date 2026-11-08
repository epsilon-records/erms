<script lang="ts">
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const labels: Record<string, string> = {
		owner: 'Owner',
		catalog_manager: 'Catalog manager',
		rights_admin: 'Rights admin',
		viewer: 'Viewer',
		agent: 'Agent'
	};
</script>

<div class="container stack">
	<section class="stack">
		<div class="eyebrow">{data.orgName}</div>
		<h1 class="title">Members</h1>
		<p>Invite people and manage access to {data.orgName}. Keep at least one owner.</p>
	</section>
	{#if form && 'error' in form}<div class="alert error" role="alert">{form.error}</div>{/if}
	{#if form && 'success' in form}<div class="alert ok" role="status">{form.success}</div>{/if}
	<section class="stack">
		<h2 class="h2">Invite a member</h2>
		{#if data.canInvite}
			<form method="POST" action="?/invite" class="stack" style="max-width:480px">
				<label for="email">Email</label><input
					id="email"
					name="email"
					type="email"
					required
					autocomplete="email"
				/>
				<label for="invite-role">Role</label><select id="invite-role" name="role"
					>{#each data.roles as role}<option value={role} selected={role === 'viewer'}
							>{labels[role]}</option
						>{/each}</select
				>
				<p class="muted">
					The invitation names {data.orgName} and comes from auth.epsilonrecords.com. Access starts when
					you invite them.
				</p>
				<div><button class="btn primary">Send invitation</button></div>
			</form>
		{:else}<p class="muted">
				Invitations are not configured yet. Existing members can still be managed below.
			</p>{/if}
	</section>
	<section class="stack">
		<h2 class="h2">Current members</h2>
		{#each data.members as member (member.userId)}
			<article class="stack" style="border-top:1px solid var(--line);padding-top:20px">
				<div>
					<strong>{member.email ?? member.userId}</strong>
					<p class="muted">
						{member.onboardedAt ? 'Onboarding complete' : 'Awaiting onboarding'} · {labels[
							member.role
						]}
					</p>
				</div>
				{#if member.role !== 'agent'}
					<form method="POST" action="?/role">
						<input type="hidden" name="userId" value={member.userId} /><label
							for={`role-${member.userId}`}
							class="sr-only">Role for {member.email ?? member.userId}</label
						><select id={`role-${member.userId}`} name="role"
							>{#each data.roles as role}<option value={role} selected={role === member.role}
									>{labels[role]}</option
								>{/each}</select
						><button class="btn">Save role</button>
					</form>
				{/if}
				{#if data.canInvite && member.email && !member.onboardedAt}<form
						method="POST"
						action="?/resend"
					>
						<input type="hidden" name="userId" value={member.userId} /><button class="btn"
							>Resend invitation</button
						><span class="muted"> Replaces previous links.</span>
					</form>{/if}
				<form
					method="POST"
					action="?/remove"
					onsubmit={(event) => {
						if (!confirm(`Remove ${member.email ?? member.userId} from ${data.orgName}?`))
							event.preventDefault();
					}}
				>
					<input type="hidden" name="userId" value={member.userId} /><button class="btn"
						>Remove member</button
					>
				</form>
			</article>
		{/each}
	</section>
</div>
