<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
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

	/** The add form's errors: name and role sit under their control, anything else under the form. */
	const formErrors = $derived(
		Object.entries(errors)
			.filter(([k]) => k !== 'name' && k !== 'role')
			.map(([, m]) => m)
	);
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
										<Button type="submit" size="small">Approve</Button>
									</form>
								{/if}
								<form
									method="POST"
									action="?/removeCredit"
									use:confirmRemoval={() =>
										`Remove the ${c.role} credit for ${c.name}? This removes the credit, while keeping the artist and catalog item.`}
								>
									<input type="hidden" name="creditId" value={c.id} />
									<Button
										type="submit"
										variant="danger"
										size="small"
										aria-label="Remove {c.role} credit for {c.name}">Remove</Button
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
	<form method="POST" action="?/addCredit" class="flex flex-wrap items-start gap-2">
		<div class="flex flex-col gap-1.5">
			<label for="credit-name" class="sr-only">Artist name</label>
			<Input
				id="credit-name"
				name="name"
				class="w-[260px]"
				placeholder="Artist name"
				value={values.name ?? ''}
				required
				aria-invalid={errors.name ? true : undefined}
				aria-describedby={errors.name ? 'credit-name-error' : undefined}
			/>
			{#if errors.name}<Field.Error id="credit-name-error">{errors.name}</Field.Error>{/if}
		</div>
		{#if roles.length > 1}
			<div class="flex flex-col gap-1.5">
				<label for="credit-role" class="sr-only">Role</label>
				<NativeSelect.Root
					id="credit-role"
					name="role"
					value={values.role ?? roles[0]}
					wrapperClass="w-fit"
					aria-invalid={errors.role ? true : undefined}
					aria-describedby={errors.role ? 'credit-role-error' : undefined}
				>
					{#each roles as r (r)}<NativeSelect.Option value={r}>{r}</NativeSelect.Option>{/each}
				</NativeSelect.Root>
				{#if errors.role}<Field.Error id="credit-role-error">{errors.role}</Field.Error>{/if}
			</div>
		{:else}
			<input type="hidden" name="role" value={roles[0]} />
		{/if}
		<Button type="submit">Add credit</Button>
	</form>
	<p class="muted" style="margin: 0; font-size: 13px">New credits stay pending until approved.</p>
{/if}
{#if formErrors.length}
	<div class="alert error" role="alert">{formErrors.join('\n')}</div>
{/if}
