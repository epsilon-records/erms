/** Identity comparisons deliberately ignore share percentages and row order. */
export function removedIdentities<T>(
	persisted: T[],
	submitted: string[],
	identity: (item: T) => string
) {
	const kept = new Set(submitted);
	return persisted.filter((item) => !kept.has(identity(item)));
}

export function submittedIdentities(fields: Record<string, string>, kind: 'holder' | 'writer') {
	return Array.from({ length: 20 }, (_, i) => {
		const id = fields[`${kind}_${i}`]?.trim();
		return id
			? kind === 'writer'
				? `${id}:${fields[`role_${i}`] || 'composer_lyricist'}`
				: id
			: '';
	}).filter(Boolean);
}

/** Submit events cover both pointer and keyboard activation; cancel never submits. */
export function confirmRemoval(
	form: HTMLFormElement,
	message: (fields: Record<string, string>) => string | null
) {
	const confirmed = document.createElement('input');
	confirmed.type = 'hidden';
	confirmed.name = 'removalConfirmed';
	form.append(confirmed);
	const submit = (event: SubmitEvent) => {
		confirmed.value = '';
		const fields = Object.fromEntries(new FormData(form)) as Record<string, string>;
		const prompt = message(fields);
		if (prompt && !window.confirm(prompt)) {
			event.preventDefault();
			return;
		}
		if (prompt) confirmed.value = 'yes';
	};
	form.addEventListener('submit', submit);
	return {
		destroy() {
			form.removeEventListener('submit', submit);
			confirmed.remove();
		}
	};
}
