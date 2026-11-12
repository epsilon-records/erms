<script lang="ts">
	// LabelKit's public homepage at / on LabelKit's own hosts (see #lib/server/landing.ts).
	// Copy only claims what ships today; store delivery, statements, payouts, the white-label
	// portal and the public API are marked "Soon" until they exist (gap analysis, EPSILON-128).
	let { signupOpen }: { signupOpen: boolean } = $props();

	// Phone nav (audit F-16): under 760 px the links fold behind a Menu button, like epsilonrecords.com.
	let menuOpen = $state(false);

	const today = [
		'Releases, recordings & compositions',
		'Credits and splits per track',
		'Agreements linked to the music they cover',
		'Artist consents, including AI use',
		'Private storage for WAV masters',
		'Loudness, key & tempo by AudioKit',
		'Import from a SymphonicMS export',
		'Team roles per label',
		'Audit trail of every change',
		'Catalogue-wide search by title, ISRC, UPC or cat#'
	];
	const soon = [
		'Delivery to Spotify, Apple Music & more',
		'Royalty statements & artist payouts',
		'White-label portal on your domain',
		'REST API, CLI & MCP server'
	];
	const faq = [
		{
			q: 'How is LabelKit different from DistroKid?',
			a: 'DistroKid is built for artists uploading their own songs. LabelKit is built for labels: many artists per record, splits, agreements and consents, and later the option to run distribution for others under your own name.'
		},
		{
			q: 'Can LabelKit deliver my releases to stores today?',
			a: 'Not yet. Today LabelKit keeps your catalogue, rights and masters in order. Store delivery is coming through a delivery partner, and the same records will feed it.'
		},
		{
			q: 'Who is it for?',
			a: 'Independent labels and collectives first, then small distributors and developers building music products.'
		},
		{
			q: 'Is my music used to train AI?',
			a: 'No. Nothing in your catalogue is used for AI without a consent you recorded, per artist and per track.'
		}
	];

	// schema.org data for search engines and AI models, from the same facts the page shows.
	// A JSON-LD data block is never executed, so the CSP's script-src does not apply to it.
	const structuredData = {
		'@context': 'https://schema.org',
		'@type': 'SoftwareApplication',
		'@id': 'https://labelkit.co/#app',
		name: 'LabelKit',
		url: 'https://labelkit.co/',
		applicationCategory: 'BusinessApplication',
		operatingSystem: 'Web',
		description:
			'Label software for independent labels: releases, recordings, compositions, credits and splits, agreements, artist consents and WAV masters in one place.',
		image: 'https://labelkit.co/og.png',
		featureList: today,
		offers: [
			{ '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'EUR' },
			{
				'@type': 'Offer',
				name: 'Label',
				price: '12',
				priceCurrency: 'EUR',
				priceSpecification: {
					'@type': 'UnitPriceSpecification',
					price: '12',
					priceCurrency: 'EUR',
					unitCode: 'MON'
				}
			}
		],
		publisher: {
			'@type': 'Organization',
			name: 'Epsilon Records',
			url: 'https://epsilonrecords.com/'
		}
	};
	const jsonLd =
		`<script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, '\\u003c')}</` +
		'script>';
</script>

<svelte:head>
	<title>LabelKit: label software for independent labels</title>
	<meta
		name="description"
		content="Catalogue, rights, splits, agreements, consents and masters for independent labels."
	/>
	<link rel="canonical" href="https://labelkit.co/" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="LabelKit" />
	<meta property="og:title" content="LabelKit: label software for independent labels" />
	<meta
		property="og:description"
		content="Catalogue, rights, splits, agreements, consents and masters for independent labels."
	/>
	<meta property="og:url" content="https://labelkit.co/" />
	<meta property="og:image" content="https://labelkit.co/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta
		property="og:image:alt"
		content="LabelKit: run your label's catalogue, rights and masters in one place."
	/>
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="LabelKit: label software for independent labels" />
	<meta
		name="twitter:description"
		content="Catalogue, rights, splits, agreements, consents and masters for independent labels."
	/>
	<meta name="twitter:image" content="https://labelkit.co/og.png" />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- static JSON-LD built from constants below -->
	{@html jsonLd}
</svelte:head>

<div class="landing">
	<header>
		<div class="wrap masthead">
			<a href="/" class="logo">
				<svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
					<rect x="8" y="8" width="16" height="3.4" fill="currentColor" />
					<rect x="8" y="14.3" width="12" height="3.4" fill="currentColor" />
					<rect x="8" y="20.6" width="16" height="3.4" fill="currentColor" />
				</svg>
				<span>LabelKit</span><span class="by">by Epsilon Records</span>
			</a>
			<button
				type="button"
				class="menu-toggle"
				aria-expanded={menuOpen}
				aria-controls="landing-nav"
				onclick={() => (menuOpen = !menuOpen)}>{menuOpen ? 'Close' : 'Menu'}</button
			>
			<!-- Closes the menu after a link is followed; the links themselves handle keys. -->
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
			<nav
				id="landing-nav"
				aria-label="Main"
				class:open={menuOpen}
				onclick={(e) => {
					if ((e.target as HTMLElement).closest('a')) menuOpen = false;
				}}
			>
				<a href="#features">Features</a>
				<a href="#pricing">Pricing</a>
				<a href="#faq">FAQ</a>
				<a href="/login">Sign in</a>
				<a href="/signup" class="cta">Start free</a>
			</nav>
		</div>
	</header>

	<div class="landing-body">
		<section class="wrap hero">
			<div class="copy">
				<p class="kicker">Label software for independent labels</p>
				<h1>Run your label's catalogue, rights and masters in one place.</h1>
				<p class="lede">
					Every release, recording, split, agreement and consent on file, with masters measured by
					AudioKit. Built inside a working label first, now open to yours.
				</p>
				<div class="actions">
					<a href="/signup" class="cta big">Start free</a>
					<a href="/login" class="ghost big">Sign in</a>
				</div>
				<p class="note">
					{signupOpen
						? 'No password: we email you a sign-in link. No card needed.'
						: 'Signup opens soon. Existing labels can sign in.'}
				</p>
			</div>
			<figure class="sample" aria-label="Example release in LabelKit">
				<div class="sample-head"><span>Releases / SMPL-001</span><span>Sample</span></div>
				<div class="sample-body">
					<p class="mono dim">SMPL-001</p>
					<p class="title">Lower Canal</p>
					<p class="dim">Night Index · EP · 4 recordings</p>
					<p class="ok">● Rights complete · Consents recorded</p>
					<dl>
						<div>
							<dt>Loudness</dt>
							<dd>−8.4 LUFS</dd>
						</div>
						<div>
							<dt>Key</dt>
							<dd>A minor</dd>
						</div>
						<div>
							<dt>Tempo</dt>
							<dd>132 BPM</dd>
						</div>
					</dl>
					<ul>
						<li><span>Writer</span><span>50%</span></li>
						<li><span>Producer</span><span>50%</span></li>
						<li><span>Agreement</span><span>Signed · on file</span></li>
					</ul>
				</div>
			</figure>
		</section>

		<section id="features" class="band">
			<div class="wrap pillars">
				<div>
					<p class="num">01</p>
					<h2>Rights you can prove</h2>
					<p>Splits, agreements and consents linked to the exact recordings they cover.</p>
				</div>
				<div>
					<p class="num">02</p>
					<h2>Masters that are checked</h2>
					<p>Upload WAVs privately. AudioKit measures loudness, key and tempo on every one.</p>
				</div>
				<div>
					<p class="num">03</p>
					<h2>Your music is not training data</h2>
					<p>Nothing is used for AI without a consent you recorded, per artist and per track.</p>
				</div>
			</div>
		</section>

		<section class="wrap included">
			<h2 class="section">What's included</h2>
			<div class="lists">
				<ul>
					{#each today as item (item)}<li>{item}</li>{/each}
				</ul>
				<ul class="soon">
					{#each soon as item (item)}<li>{item} <span class="tag">Soon</span></li>{/each}
				</ul>
			</div>
		</section>

		<section id="pricing" class="band">
			<div class="wrap">
				<h2 class="section">Published prices. No sales call.</h2>
				<div class="plans">
					<article>
						<h3>Free</h3>
						<p class="dim">Try it with your own catalogue</p>
						<p class="price">€0</p>
						<a href="/signup" class="ghost">Start free</a>
					</article>
					<article class="featured">
						<h3>Label</h3>
						<p class="dim">One label, its whole catalogue</p>
						<p class="price">€12<span> / month</span></p>
						<p class="dim">or €120 a year</p>
						<a href="/signup" class="cta">Start free</a>
					</article>
					<article>
						<h3>Distributor &amp; API</h3>
						<p class="dim">Run distribution for others, or build on it</p>
						<p class="price soon-price">Soon</p>
					</article>
				</div>
			</div>
		</section>

		<section id="faq" class="wrap">
			<h2 class="section">Questions</h2>
			<dl class="faq">
				{#each faq as item (item.q)}
					<div>
						<dt>{item.q}</dt>
						<dd>{item.a}</dd>
					</div>
				{/each}
			</dl>
		</section>

		<section class="final">
			<div class="wrap">
				<h2>Get your label's records in order.</h2>
				<a href="/signup" class="dark">Start free</a>
			</div>
		</section>
	</div>

	<footer class="wrap">
		<span>© 2015–2026 Epsilon Records · Amsterdam</span>
		<span class="links">
			<a href="/privacy">Privacy</a>
			<a href="/terms">Terms</a>
			<a href="https://epsilonrecords.com">Epsilon Records</a>
		</span>
	</footer>
</div>

<style>
	.landing {
		--lime: #c6f432;
		--bg: #0e0f11;
		--line: #2c3036;
		background: var(--bg);
		color: #e8eaed;
		min-height: 100vh;
		font-size: 16px;
		line-height: 1.55;
	}
	.landing a {
		color: inherit;
		text-decoration: none;
	}
	.wrap {
		max-width: 1200px;
		margin: 0 auto;
		padding-left: 32px;
		padding-right: 32px;
	}
	@media (max-width: 640px) {
		.wrap {
			padding-left: 20px;
			padding-right: 20px;
		}
	}
	header {
		border-bottom: 1px solid var(--line);
		position: sticky;
		top: 0;
		z-index: 5;
		background: var(--bg);
	}
	/* Not .bar: app.css uses that name for 4 px progress bars, which collapsed this row. */
	.masthead {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 12px 24px;
		padding-top: 16px;
		padding-bottom: 16px;
	}
	.logo {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 700;
		font-size: 18px;
	}
	.logo svg {
		color: var(--lime);
	}
	.by,
	.mono,
	.num,
	.kicker,
	.sample-head,
	dt,
	.tag {
		font-family: var(--mono, 'IBM Plex Mono', monospace);
	}
	.by {
		font-size: 12px;
		font-weight: 400;
		color: #a6abb3;
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 24px;
		font-size: 15px;
		color: #c5c9cf;
	}
	nav a {
		/* 44 px touch floor (audit F-11). */
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	nav a:hover {
		color: #fff;
	}
	.menu-toggle {
		display: none;
	}
	@media (max-width: 760px) and (scripting: enabled) {
		.menu-toggle {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
			padding: 0 16px;
			border: 1px solid var(--line-control, #646a73);
			background: transparent;
			color: var(--text);
			font: inherit;
			font-weight: 600;
			cursor: pointer;
		}
		nav {
			display: none;
			flex-basis: 100%;
			flex-direction: column;
			align-items: stretch;
			gap: 0;
		}
		nav.open {
			display: flex;
		}
		nav a {
			border-top: 1px solid var(--line);
		}
		nav a.cta {
			justify-content: center;
			margin-top: 12px;
			border-top: 0;
		}
	}
	@media (max-width: 480px) and (scripting: enabled) {
		/* Logo, tagline and Menu don't fit on one row on a phone. */
		.by {
			display: none;
		}
	}
	.cta,
	.ghost,
	.dark {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 10px 16px;
		box-sizing: border-box;
		font-weight: 600;
	}
	.landing .cta {
		background: var(--lime);
		color: var(--bg);
	}
	.ghost {
		border: 1px solid var(--line);
	}
	.big {
		padding: 14px 22px;
		font-size: 17px;
	}
	.hero {
		display: flex;
		flex-wrap: wrap;
		gap: 56px;
		align-items: center;
		padding-top: 96px;
		padding-bottom: 80px;
	}
	.copy {
		flex: 1 1 480px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.kicker {
		color: var(--lime);
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin: 0;
	}
	h1 {
		font-size: clamp(36px, 5vw, 60px);
		line-height: 1.05;
		letter-spacing: -0.02em;
		margin: 0;
		color: #fff;
	}
	.lede {
		font-size: 19px;
		color: #c5c9cf;
		max-width: 38em;
		margin: 0;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}
	.note,
	.dim {
		color: #a6abb3;
		font-size: 14px;
		margin: 0;
	}
	.sample {
		flex: 1 1 360px;
		margin: 0;
		border: 1px solid var(--line);
		background: #131519;
	}
	.sample-head {
		display: flex;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line);
		font-size: 12px;
		color: #a6abb3;
	}
	.sample-body {
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sample-body p {
		margin: 0;
	}
	.title {
		font-size: 22px;
		font-weight: 600;
		color: #fff;
	}
	.ok {
		color: var(--lime);
		font-size: 14px;
	}
	.sample dl {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin: 16px 0 8px;
	}
	dt {
		font-size: 11px;
		color: #a6abb3;
		text-transform: uppercase;
	}
	dd {
		margin: 0;
	}
	.sample ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.sample li {
		display: flex;
		justify-content: space-between;
		padding: 8px 0;
		border-top: 1px solid var(--line);
		font-size: 14px;
	}
	.band {
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		background: #131519;
	}
	.pillars {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 40px;
		padding-top: 64px;
		padding-bottom: 64px;
	}
	.num {
		color: var(--lime);
		margin: 0 0 8px;
	}
	h2 {
		margin: 0 0 8px;
		font-size: 22px;
		color: #fff;
	}
	.pillars p:not(.num) {
		color: #c5c9cf;
		margin: 0;
	}
	.section {
		font-size: clamp(28px, 3.5vw, 40px);
		letter-spacing: -0.015em;
		margin-bottom: 32px;
	}
	.included,
	#faq {
		padding-top: 96px;
		padding-bottom: 96px;
	}
	.lists {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 0 40px;
	}
	.lists ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.lists li {
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	.soon li {
		color: #a6abb3;
	}
	.tag {
		font-size: 11px;
		border: 1px solid var(--line);
		padding: 2px 6px;
		margin-left: 6px;
		color: var(--lime);
	}
	#pricing .wrap {
		padding-top: 96px;
		padding-bottom: 96px;
	}
	.plans {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 24px;
		margin-bottom: 16px;
	}
	.plans article {
		border: 1px solid var(--line);
		background: var(--bg);
		padding: 28px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		align-items: flex-start;
	}
	.plans .featured {
		border-color: var(--lime);
	}
	h3 {
		margin: 0;
		font-size: 20px;
		color: #fff;
	}
	.price {
		font-size: 40px;
		font-weight: 700;
		color: #fff;
		margin: 12px 0 0;
	}
	.price span {
		font-size: 16px;
		font-weight: 400;
		color: #a6abb3;
	}
	.soon-price {
		color: #a6abb3;
	}
	.plans a {
		margin-top: 16px;
	}
	.faq {
		margin: 0;
		display: grid;
		gap: 28px;
		max-width: 52em;
	}
	.faq dt {
		font-family: inherit;
		font-size: 18px;
		font-weight: 600;
		text-transform: none;
		color: #fff;
		margin-bottom: 6px;
	}
	.faq dd {
		color: #c5c9cf;
	}
	.final {
		background: var(--lime);
		color: var(--bg);
	}
	.final .wrap {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 24px;
		padding-top: 72px;
		padding-bottom: 72px;
	}
	.final h2 {
		color: var(--bg);
		font-size: clamp(26px, 3.5vw, 40px);
		margin: 0;
	}
	.landing .dark {
		background: var(--bg);
		color: #fff;
	}
	.links {
		display: flex;
		gap: 20px;
	}
	.links a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 12px;
		padding-top: 32px;
		padding-bottom: 32px;
		font-size: 14px;
		color: #a6abb3;
	}
</style>
