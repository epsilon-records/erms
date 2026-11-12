import Description from './field-description.svelte';
import Error from './field-error.svelte';
import Group from './field-group.svelte';
import Label from './field-label.svelte';
import Legend from './field-legend.svelte';
import Set from './field-set.svelte';
import Field from './field.svelte';

export {
	Field,
	Set,
	Legend,
	Group,
	Label,
	Description,
	Error,
	//
	Set as FieldSet,
	Legend as FieldLegend,
	Group as FieldGroup,
	Label as FieldLabel,
	Description as FieldDescription,
	Error as FieldError
};
export { fieldVariants, type FieldOrientation } from './field.svelte';
