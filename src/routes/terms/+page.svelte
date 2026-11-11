<script lang="ts">
	import LegalPage from '#lib/components/LegalPage.svelte';
</script>

<LegalPage title="Terms of service" effective="[date of publication]">
	<p>
		These terms are an agreement between Epsilon Records, Nieuwe Uilenburgerstraat 21C, 1011LM
		Amsterdam, the Netherlands ("we"), and the label or business that uses LabelKit ("you").
		LabelKit is for labels and other businesses, not for consumers. By creating a label or using
		LabelKit, you accept these terms on behalf of that label.
	</p>

	<h2>1. The service</h2>
	<p>
		LabelKit keeps a label's catalogue, rights and masters: releases, recordings, credits, splits,
		agreements, consents and audio analysis. Features marked "Soon" on labelkit.co are not part of
		the service until we release them. We may change or improve LabelKit. If a change removes
		something your plan relies on, we tell you in advance.
	</p>

	<h2>2. Accounts and members</h2>
	<p>
		Owners of a label decide who is a member and what each member can do. You are responsible for
		what your members do in your label, and for keeping access to the email addresses used to sign
		in.
	</p>

	<h2>3. Your content</h2>
	<p>
		Your catalogue, agreements, master files and everything else you put into LabelKit stays yours.
		You give us permission to store, process and display it only to provide LabelKit to you,
		including analysis of masters by AudioKit. We do not use your content to train AI, and we do not
		share it except with the providers listed in the <a href="/privacy">privacy notice</a>.
	</p>
	<p>
		You confirm that you have the rights and permissions needed to upload your content, including
		any consents needed from the people named in it. Where your content contains personal data, we
		process it for you as your processor. The privacy notice explains how, and we sign a data
		processing agreement on request.
	</p>

	<h2>4. Plans and payment</h2>
	<ul>
		<li>The Free plan costs nothing. Its limits are shown on the Billing page.</li>
		<li>
			The Label plan is billed in advance, monthly or yearly, through Stripe, at the price shown on
			labelkit.co when you subscribe. Tax is calculated at checkout.
		</li>
		<li>
			Subscriptions renew automatically. You can cancel any time from the Billing page. The plan
			stays active until the end of the period you paid for. We do not refund partial periods,
			except where the law requires it.
		</li>
		<li>
			If a payment fails, the plan stays active while Stripe retries. If it still fails, the label
			moves to the Free plan. Nothing is deleted, but you may not be able to add more until you are
			back under the Free limits.
		</li>
		<li>
			We may change prices. We give at least 30 days' notice, and a change applies from your next
			renewal.
		</li>
	</ul>

	<h2>5. Acceptable use</h2>
	<p>
		Don't use LabelKit to break the law or infringe others' rights. Don't try to reach other labels'
		data, disrupt the service, or get around plan limits or security. We may suspend a label that
		does, and we tell you why unless the law prevents it.
	</p>

	<h2>6. Availability and support</h2>
	<p>
		We work to keep LabelKit available and your data safe, but we do not guarantee uninterrupted
		service. Support is by email at
		<a href="mailto:hello@epsilonrecords.com">hello@epsilonrecords.com</a>.
	</p>

	<h2>7. Leaving</h2>
	<p>
		You can stop using LabelKit at any time. Before you close a label, you can export your catalogue
		and download your masters. After a label is closed, we delete its content as the privacy notice
		describes. We may end these terms with 30 days' notice, or straight away if you seriously breach
		them.
	</p>

	<h2>8. Liability</h2>
	<p>
		We are not liable for indirect or consequential loss, or for lost profits, revenue or data you
		could have kept a copy of. Our total liability under these terms is limited to the amount you
		paid us in the 12 months before the claim. Nothing here limits liability that cannot be limited
		by law, including for intent or gross negligence.
	</p>

	<h2>9. Changes to these terms</h2>
	<p>
		We may update these terms. We tell label owners about material changes by email at least 30 days
		before they apply. If you keep using LabelKit after that, the new terms apply.
	</p>

	<h2>10. Law and disputes</h2>
	<p>Dutch law applies. Disputes go to the competent court in Amsterdam.</p>
</LegalPage>
