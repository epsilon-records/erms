<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Masters from './Masters.svelte';

	const masters = [
		{
			id: 'm1',
			fileName: 'Nightshift (Original Mix).wav',
			format: 'wav',
			sizeBytes: 118_400_000,
			sha256: '9f2c1e7a4b0d3c5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e',
			status: 'ready',
			createdAt: '2026-11-10T09:12:00Z',
			completedAt: '2026-11-10T09:13:30Z'
		},
		{
			id: 'm2',
			fileName: 'Nightshift (Radio Edit).wav',
			format: 'wav',
			sizeBytes: 41_200_000,
			sha256: null,
			status: 'checking',
			createdAt: '2026-11-12T10:01:00Z',
			completedAt: null
		}
	];

	const { Story } = defineMeta({ title: 'Recording/Masters', component: Masters });
</script>

<Story name="Read only" args={{ recordingId: 'r1', masters, enabled: true }} />
<Story
	name="Upload and delete"
	args={{ recordingId: 'r1', masters, enabled: true, canUpload: true, canDelete: true }}
/>
<Story name="Empty" args={{ recordingId: 'r1', masters: [], enabled: true, canUpload: true }} />
<Story
	name="Storage off"
	args={{ recordingId: 'r1', masters: [], enabled: false, canUpload: true }}
/>
