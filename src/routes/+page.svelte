<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#if data.membership}
	<pre>
ORG ......... {data.membership.orgName}
ROLE ........ {data.membership.role}
STATUS ...... phase 0 :: foundation online</pre>
{:else}
	<pre>
No organisation membership yet.
Ask an owner to add {data.user?.email} to an org.</pre>
{/if}
