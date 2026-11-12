import type { Preview } from '@storybook/sveltekit';
import '../src/app.css';
import '../src/tailwind.css';

const preview: Preview = {
	parameters: {
		backgrounds: { disable: true },
		layout: 'padded',
		// Fail the story test on accessibility violations, not just report them.
		a11y: { test: 'error' }
	}
};

export default preview;
