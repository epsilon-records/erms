<script lang="ts">
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

<table>
	<tbody>
		{#each credits as c (c.id)}
			<tr>
				<td class="dim">{c.role}</td>
				<td><a href="/artists/{c.partyId}">{c.name}</a></td>
				<td>
					{#if !c.approvedAt}
						<span class="warn">pending</span>
						{#if canApprove}
							<form method="POST" action="?/approveCredit">
								<input type="hidden" name="creditId" value={c.id} />
								<button>[ approve ]</button>
							</form>
						{/if}
					{/if}
				</td>
				<td>
					{#if canEdit}
						<form method="POST" action="?/removeCredit">
							<input type="hidden" name="creditId" value={c.id} />
							<button class="danger">[ remove ]</button>
						</form>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>

{#if canEdit && roles.length}
	<form method="POST" action="?/addCredit" class="add">
		<input name="name" placeholder="artist name" value={values.name ?? ''} required />
		<select name="role">
			{#each roles as r}<option value={r} selected={values.role === r}>{r}</option>{/each}
		</select>
		<button>[ add credit ]</button>
	</form>
	<pre class="dim">New credits start as pending until approved.</pre>
{/if}
{#if errors.name || errors.role || errors.form}
	<pre class="err">! {errors.name ?? errors.role ?? errors.form}</pre>
{/if}

<style>
	table {
		border-collapse: collapse;
	}
	td {
		padding: 2px 2ch 2px 0;
	}
	form {
		display: inline;
	}
	.add {
		display: flex;
		gap: 1ch;
		margin-top: 0.5rem;
	}
	.dim {
		color: #8a8a8a;
	}
	.warn {
		color: #ffd166;
	}
	.err {
		color: #ff6b6b;
	}
	:global(button.danger) {
		color: #ff6b6b;
	}
</style>
