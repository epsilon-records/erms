<script lang="ts">
	import { confirmRemoval } from '#lib/removal-confirmation.js';
	type Credit = {
		id: string;
		role: string;
		name: string;
		partyId: string;
		approvedAt: Date | string | null;
	};

	let {
		credits,
		canEdit = false,
		canApprove = false,
		roles = [],
		errors = {},
		values = {}
	}: {
		credits: Credit[];
		canEdit?: boolean;
		canApprove?: boolean;
		/** Roles offered when adding; empty hides the add form. */
		roles?: readonly string[];
		errors?: Record<string, string>;
		values?: Record<string, string>;
	} = $props();
</script>

<noscript
	><p class="soft">
		JavaScript is required to confirm removals. Removal requests without confirmation leave existing
		records unchanged.
	</p></noscript
>

<div class="table-wrap">
	<table class="data">
		<thead>
			<tr>
				<th>Role</th>
				<th>Artist</th>
				<th>Status</th>
				{#if canEdit}<th class="num"><span class="sr-only">Actions</span></th>{/if}
			</tr>
		</thead>
		<tbody>
			{#each credits as c (c.id)}
				<tr>
					<td class="mono muted">{c.role}</td>
					<td><a href="/artists/{c.partyId}" class="plain" style="font-weight: 600">{c.name}</a></td
					>
					<td>
						{#if c.approvedAt}
							<span class="muted">Approved</span>
						{:else}
							<span class="pending">Pending</span>
						{/if}
					</td>
					{#if canEdit}
						<td class="num">
							<div class="inline-form" style="justify-content: flex-end">
								{#if !c.approvedAt && canApprove}
									<form method="POST" action="?/approveCredit">
										<input type="hidden" name="creditId" value={c.id} />
										<button class="btn small">Approve</button>
									</form>
								{/if}
								<form
									method="POST"
									action="?/removeCredit"
									use:confirmRemoval={() =>
										`Remove the ${c.role} credit for ${c.name}? This removes the credit, while keeping the artist and catalog item.`}
								>
									<input type="hidden" name="creditId" value={c.id} />
									<button class="btn small danger" aria-label="Remove {c.role} credit for {c.name}"
										>Remove</button
									>
								</form>
							</div>
						</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

{#if canEdit && roles.length}
	<form method="POST" action="?/addCredit" class="inline-form">
		<label for="credit-name" class="sr-only">Artist name</label>
		<input
			id="credit-name"
			name="name"
			placeholder="Artist name"
			value={values.name ?? ''}
			required
		/>
		{#if roles.length > 1}
			<label for="credit-role" class="sr-only">Role</label>
			<select id="credit-role" name="role">
				{#each roles as r (r)}<option value={r} selected={values.role === r}>{r}</option>{/each}
			</select>
		{:else}
			<input type="hidden" name="role" value={roles[0]} />
		{/if}
		<button class="btn">Add credit</button>
	</form>
	<p class="muted" style="margin: 0; font-size: 13px">New credits stay pending until approved.</p>
{/if}
{#if errors.name || errors.role || errors.form}
	<div class="alert error" role="alert">{errors.name ?? errors.role ?? errors.form}</div>
{/if}
