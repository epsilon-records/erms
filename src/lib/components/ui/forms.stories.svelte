<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { Checkbox } from './checkbox/index.js';
	import * as Field from './field/index.js';
	import { Input } from './input/index.js';
	import { Label } from './label/index.js';
	import * as NativeSelect from './native-select/index.js';
	import { Textarea } from './textarea/index.js';
	import { Button } from './button/index.js';

	const { Story } = defineMeta({ title: 'UI/Form controls' });
</script>

<Story name="Input">
	<div class="max-w-[480px]">
		<Field.Field>
			<Field.Label for="s-title">Release title</Field.Label>
			<Input id="s-title" name="title" placeholder="Nightshift EP" />
			<Field.Description>Shown on the release page and in delivery metadata.</Field.Description>
		</Field.Field>
	</div>
</Story>

<Story name="Input with error">
	<div class="max-w-[480px]">
		<Field.Field data-invalid="true">
			<Field.Label for="s-email">Email</Field.Label>
			<Input
				id="s-email"
				name="email"
				type="email"
				value="ava@"
				aria-invalid="true"
				aria-describedby="s-email-error"
			/>
			<Field.Error id="s-email-error" errors={[{ message: 'Enter a full email address.' }]} />
		</Field.Field>
	</div>
</Story>

<Story name="Disabled input">
	<div class="max-w-[480px]">
		<Field.Field>
			<Field.Label for="s-isrc">ISRC</Field.Label>
			<Input id="s-isrc" value="NLA1Z2600001" disabled />
		</Field.Field>
	</div>
</Story>

<Story name="Textarea">
	<div class="max-w-[480px]">
		<Field.Field>
			<Field.Label for="s-notes">Notes</Field.Label>
			<Textarea
				id="s-notes"
				name="notes"
				placeholder="Anything the mastering engineer should know"
			/>
		</Field.Field>
	</div>
</Story>

<Story name="Select">
	<div class="max-w-[480px]">
		<Field.Field>
			<Field.Label for="s-role">Role</Field.Label>
			<NativeSelect.Root id="s-role" name="role" value="catalog_manager">
				<NativeSelect.Option value="owner">Owner</NativeSelect.Option>
				<NativeSelect.Option value="catalog_manager">Catalog manager</NativeSelect.Option>
				<NativeSelect.Option value="rights_admin">Rights admin</NativeSelect.Option>
			</NativeSelect.Root>
		</Field.Field>
	</div>
</Story>

<Story name="Small select">
	<label for="s-role-sm" class="sr-only">Role</label>
	<NativeSelect.Root id="s-role-sm" name="role" size="sm" value="owner">
		<NativeSelect.Option value="owner">Owner</NativeSelect.Option>
		<NativeSelect.Option value="rights_admin">Rights admin</NativeSelect.Option>
	</NativeSelect.Root>
</Story>

<Story name="Checkbox">
	<div class="flex items-center gap-2">
		<Checkbox id="s-terms" name="terms" />
		<Label for="s-terms">I agree to the terms</Label>
	</div>
</Story>

<Story name="Checked checkbox">
	<div class="flex items-center gap-2">
		<Checkbox id="s-news" name="news" checked />
		<Label for="s-news">Send me release news</Label>
	</div>
</Story>

<Story name="Form rows (responsive)">
	<form class="flex flex-col gap-4" onsubmit={(e) => e.preventDefault()}>
		<Field.Field orientation="responsive">
			<Field.Label for="s-r-email">Email</Field.Label>
			<Input id="s-r-email" type="email" placeholder="name@label.com" />
		</Field.Field>
		<Field.Field orientation="responsive">
			<Field.Label for="s-r-role">Role</Field.Label>
			<NativeSelect.Root id="s-r-role" value="catalog_manager">
				<NativeSelect.Option value="catalog_manager">Catalog manager</NativeSelect.Option>
				<NativeSelect.Option value="rights_admin">Rights admin</NativeSelect.Option>
			</NativeSelect.Root>
		</Field.Field>
		<div class="sm:pl-[160px]"><Button type="submit" variant="primary">Send invite</Button></div>
	</form>
</Story>

<Story name="Field set">
	<Field.Set>
		<Field.Legend>Notifications</Field.Legend>
		<Field.Group>
			<Field.Field orientation="horizontal">
				<Checkbox id="s-n1" checked />
				<Field.Label for="s-n1">Delivery finished</Field.Label>
			</Field.Field>
			<Field.Field orientation="horizontal">
				<Checkbox id="s-n2" />
				<Field.Label for="s-n2">Statement imported</Field.Label>
			</Field.Field>
		</Field.Group>
	</Field.Set>
</Story>
