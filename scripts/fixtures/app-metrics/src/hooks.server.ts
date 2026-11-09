/** Fake service adapter for the real Auth handlers. No Supabase/network calls exist here. */
export const handle = async ({ event, resolve }) => {
	event.locals.supabase = {
		auth: {
			exchangeCodeForSession: async (code) => {
				(globalThis.fixtureAuthInputs ??= []).push({ code });
				return { error: code === 'FAKE_METRIC_SECRET_BAD' ? { code: 'fake_invalid' } : null };
			},
			verifyOtp: async (input) => {
				(globalThis.fixtureAuthInputs ??= []).push(input);
				return {
					error: input.token_hash === 'FAKE_METRIC_SECRET_BAD' ? { code: 'fake_invalid' } : null
				};
			}
		}
	};
	return resolve(event);
};
