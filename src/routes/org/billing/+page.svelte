<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const limits = $derived(data.plan?.limits ?? null);
	const rows = $derived(
		limits
			? [
					{ label: 'Recordings', used: data.usage.tracks, limit: limits.tracks },
					{ label: 'Members', used: data.usage.seats, limit: limits.seats },
					{
						label: 'Analyses this month',
						used: data.usage.analysisJobsThisMonth,
						limit: limits.analysisJobsPerMonth
					}
				]
			: []
	);
	const renews = $derived(data.plan?.current_period_end?.slice(0, 10) ?? null);
</script>

<svelte:head><title>Billing · {page.data.brand?.name ?? 'LabelKit'}</title></svelte:head>

<div class="container">
	<section class="stack">
		<div class="eyebrow"><span>{data.orgName}</span></div>
		<h1 class="title">Billing</h1>
	</section>

	{#if data.checkoutDone}
		<div class="alert ok" role="status">
			Thanks. Your plan updates here as soon as Stripe confirms the payment.
		</div>
	{/if}
	{#if form?.error}
		<div class="alert error" role="alert">{form.error}</div>
	{/if}

	{#if !data.plan}
		<p class="soft">Billing is unavailable right now. Try again in a minute.</p>
	{:else}
		<section class="stack">
			<p class="h2">
				{data.plan.plan === 'label' ? 'Label plan' : 'Free plan'}
				{#if data.plan.status && data.plan.status !== 'active'}
					<span class="tag">{data.plan.status.replace('_', ' ')}</span>
				{/if}
			</p>
			{#if data.plan.plan === 'label' && renews}
				<p class="soft">
					{data.plan.cancel_at_period_end ? 'Ends' : 'Renews'} on {renews}.
				</p>
			{/if}
			{#if data.exempt}
				<p class="soft">Plan limits don't apply to this label.</p>
			{/if}
		</section>

		<div class="table-wrap">
			<table class="data">
				<thead><tr><th>Usage</th><th>Used</th><th>Plan allows</th></tr></thead>
				<tbody>
					{#each rows as row (row.label)}
						<tr>
							<td>{row.label}</td>
							<td style:color={!data.exempt && row.used >= row.limit ? 'var(--warn)' : undefined}
								>{row.used}</td
							>
							<td>{data.exempt ? 'No limit' : row.limit}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if data.plan.plan === 'free'}
			<section class="stack">
				<h2 class="h2">Upgrade to Label</h2>
				<p class="soft">
					More recordings, members and analyses each month. Billed per label; cancel any time.
				</p>
				<div class="actions">
					<form method="POST" action="?/upgrade">
						<input type="hidden" name="interval" value="month" />
						<button class="btn primary">€12 a month</button>
					</form>
					<form method="POST" action="?/upgrade">
						<input type="hidden" name="interval" value="year" />
						<button class="btn">€120 a year</button>
					</form>
				</div>
			</section>
		{:else}
			<form method="POST" action="?/manage">
				<button class="btn">Manage billing</button>
			</form>
		{/if}
		{#if data.plan.plan === 'free' && data.plan.status}
			<form method="POST" action="?/manage">
				<button class="linkish">Invoices and payment details</button>
			</form>
		{/if}
	{/if}
</div>

<style>
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}
</style>
