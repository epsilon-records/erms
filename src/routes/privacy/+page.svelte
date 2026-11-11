<script lang="ts">
	import LegalPage from '#lib/components/LegalPage.svelte';
</script>

<LegalPage title="Privacy notice" effective="12 November 2026">
	<p>
		This notice covers LabelKit: labelkit.co, the label workspaces on it, and branded workspaces
		such as erms.epsilonrecords.com. It says what personal data LabelKit processes, why, and who
		helps us process it.
	</p>

	<h2>1. Who is responsible</h2>
	<p>
		LabelKit is run by Epsilon Records, Nieuwe Uilenburgerstraat 21C, 1011LM Amsterdam, the
		Netherlands. For anything about your personal data, write to
		<a href="mailto:hello@epsilonrecords.com">hello@epsilonrecords.com</a>.
	</p>
	<p>We have two roles:</p>
	<ul>
		<li>
			<strong>Controller</strong> for your account, your label's subscription and billing, and the security
			and support of the service.
		</li>
		<li>
			<strong>Processor</strong> for the catalogue a label keeps in LabelKit: artists, writers, credits,
			splits, agreements, consents and masters. The label decides what goes in and why, so the label is
			the controller of that data. If your details are in a label's catalogue, the label is the one to
			ask first. We act only on the label's instructions and help it answer you.
		</li>
	</ul>

	<h2>2. What we process</h2>
	<ul>
		<li>
			<strong>Account:</strong> your email address, the labels you belong to and your role in each, and
			when you signed in. There are no passwords: we email you a sign-in link.
		</li>
		<li>
			<strong>Activity:</strong> an audit log of changes made in a label (who, what, when). It is append-only
			and does not store email addresses.
		</li>
		<li>
			<strong>Catalogue:</strong> what a label enters or imports, including names of the people it works
			with, their roles and shares, agreements and consents, and uploaded master files with their analysis
			(loudness, key, tempo).
		</li>
		<li>
			<strong>Billing:</strong> for a paid plan, the label's billing name, address, VAT number and payment
			details, handled by Stripe. We never see full card numbers.
		</li>
		<li>
			<strong>Technical:</strong> IP address, browser details and error reports, to deliver pages and
			fix problems.
		</li>
	</ul>
	<p>We do not use any catalogue data or masters to train AI, and we do not sell personal data.</p>

	<h2>3. Who helps us</h2>
	<ul>
		<li>Supabase: database and sign-in. The database is hosted in Frankfurt, Germany.</li>
		<li>Netlify: hosting. Pages are served from its global network.</li>
		<li>Cloudflare R2: private storage for master files.</li>
		<li>AudioKit: audio analysis of masters. It is our own service, hosted on Railway.</li>
		<li>Stripe: payments and invoices for paid plans.</li>
		<li>Resend: sign-in and invitation emails.</li>
		<li>Sentry: error reports.</li>
		<li>Google Fonts: the typefaces. Your browser fetches them from Google.</li>
	</ul>
	<p>
		Several of these are based in the United States or may process data there. They do so under the
		EU-U.S. Data Privacy Framework or the European Commission's Standard Contractual Clauses.
	</p>

	<h2>4. Cookies</h2>
	<p>
		LabelKit sets only the cookies it needs to work: your sign-in session and which label you have
		open. There are no advertising or tracking cookies.
	</p>

	<h2>5. Legal bases</h2>
	<ul>
		<li>
			Providing the service you or your label signed up for: performance of a contract (Article
			6(1)(b) GDPR).
		</li>
		<li>Keeping invoices and tax records: legal obligation (Article 6(1)(c)).</li>
		<li>
			Security, abuse prevention, error reports and support: our legitimate interests (Article
			6(1)(f)). You can object to these at any time.
		</li>
	</ul>

	<h2>6. How long data is kept</h2>
	<ul>
		<li>Account: until you or your label's owner removes it.</li>
		<li>
			Catalogue and masters: until the label deletes them or closes its account. They are then
			deleted within 30 days, and from backups when those expire.
		</li>
		<li>Audit log: for as long as the label exists.</li>
		<li>Invoices and payment records: 7 years, as Dutch tax law requires.</li>
	</ul>

	<h2>7. Your rights</h2>
	<p>
		You can ask for access to your personal data, or to correct, erase, restrict, or receive it in a
		portable form, or object to its processing. Write to the address above. For data in a label's
		catalogue, we pass your request to that label. You can also complain to the Autoriteit
		Persoonsgegevens in the Netherlands, or the authority where you live or work.
	</p>

	<h2>8. Changes</h2>
	<p>
		If what LabelKit processes changes, we update this page and its date. We tell label owners about
		significant changes by email.
	</p>
</LegalPage>
