<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import RecordingAnalysis from './RecordingAnalysis.svelte';
	import { analysisDone, analysisEmpty, analysisMixed } from './fixtures.stories-data.js';

	const { Story } = defineMeta({
		title: 'Recording/Analysis',
		component: RecordingAnalysis
	});
</script>

<Story name="Not run yet" args={{ recordingId: 'r1', analysis: analysisEmpty, canRun: true }} />
<Story name="All done" args={{ recordingId: 'r1', analysis: analysisDone, canRun: true }} />
<Story name="Read only" args={{ recordingId: 'r1', analysis: analysisDone }} />
<Story
	name="Failed and running"
	args={{ recordingId: 'r1', analysis: analysisMixed, canRun: true }}
/>
<Story
	name="Queued"
	args={{ recordingId: 'r1', analysis: analysisEmpty, canRun: true, queued: true }}
/>
<Story
	name="Run error"
	args={{
		recordingId: 'r1',
		analysis: analysisEmpty,
		canRun: true,
		runError: 'AudioKit is not configured for this organization.'
	}}
/>
