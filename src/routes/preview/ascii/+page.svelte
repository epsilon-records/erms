<script lang="ts">
	import { onMount } from 'svelte';

	let activeTab = $state<'catalog' | 'distrokid' | 'onboarding' | 'splits'>('catalog');
	let isPlaying = $state(false);
	let playbackProgress = $state(42);
	let autoNormalized = $state(false);

	// Onboarding state
	let newOrgName = $state('Neutrino Recordings');
	let newOrgSlug = $state('neutrino');
	let isrcPrefix = $state('NL-E88');
	let onboardingComplete = $state(false);

	// Stem states
	let stemMute = $state({ drums: false, bass: false, synth: false, vox: false });

	let vuMeterL = $state(74);
	let vuMeterR = $state(71);

	onMount(() => {
		const interval = setInterval(() => {
			if (isPlaying) {
				playbackProgress = (playbackProgress + 0.5) % 100;
				vuMeterL = Math.min(95, Math.max(40, Math.floor(70 + Math.sin(Date.now() / 200) * 18)));
				vuMeterR = Math.min(95, Math.max(40, Math.floor(68 + Math.cos(Date.now() / 240) * 20)));
			}
		}, 120);
		return () => clearInterval(interval);
	});

	function togglePlay() {
		isPlaying = !isPlaying;
	}

	function fixLoudness() {
		autoNormalized = true;
	}

	function handleOnboardingSubmit(e: Event) {
		e.preventDefault();
		onboardingComplete = true;
	}
</script>

<svelte:head>
	<title>ERMS — Modern White Audio Intelligence & Distribution</title>
</svelte:head>

<div class="app-shell">
	<!-- TOP HEADER -->
	<header class="navbar">
		<div class="nav-container">
			<div class="brand-group">
				<div class="logo-mark">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
						<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
						<path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
					</svg>
				</div>
				<span class="brand-name">ERMS</span>
				<span class="brand-sub">Audio Platform</span>
			</div>

			<div class="org-selector">
				<span class="org-label">Organization</span>
				<div class="org-badge">
					<span class="org-dot"></span>
					<span class="org-title">{newOrgName}</span>
					<span class="org-role">Owner</span>
				</div>
			</div>

			<div class="system-status-pills">
				<div class="status-pill status-live">
					<span class="dot"></span>
					<span>AudioKit Engine 1.4</span>
				</div>
				<div class="status-pill status-neutral">
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg
					>
					<span>Postgres 17 RLS</span>
				</div>
				<div class="status-pill status-neutral">
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M3 9h18M9 21V9"
						></path></svg
					>
					<span>Cloudflare R2 Vault</span>
				</div>
			</div>
		</div>
	</header>

	<!-- NAVIGATION TABS -->
	<div class="tab-strip">
		<div class="tab-container">
			<nav class="nav-tabs" aria-label="Sections">
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'catalog'}
					onclick={() => (activeTab = 'catalog')}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"
						></polygon></svg
					>
					Catalog &amp; Audio Flight-Deck
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'distrokid'}
					onclick={() => (activeTab = 'distrokid')}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><rect x="3" y="3" width="18" height="18" rx="2"></rect><line
							x1="9"
							y1="3"
							x2="9"
							y2="21"
						></line></svg
					>
					DistroKid vs. ERMS
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'onboarding'}
					onclick={() => (activeTab = 'onboarding')}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle
							cx="8.5"
							cy="7.5"
							r="4"
						></circle><line x1="20" y1="8" x2="20" y2="14"></line><line
							x1="23"
							y1="11"
							x2="17"
							y2="11"
						></line></svg
					>
					Self-Serve Label Onboarding
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'splits'}
					onclick={() => (activeTab = 'splits')}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><line x1="12" y1="1" x2="12" y2="23"></line><path
							d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
						></path></svg
					>
					Splits &amp; Contracts
				</button>
			</nav>
		</div>
	</div>

	<!-- MAIN CONTENT AREA -->
	<main class="main-content">
		<!-- TAB 1: CATALOG & FLIGHT-DECK -->
		{#if activeTab === 'catalog'}
			<div class="content-stack">
				<!-- HERO RELEASE CARD -->
				<section class="card release-card">
					<div class="release-layout">
						<div class="artwork-block">
							<div class="artwork-inner">
								<svg
									width="48"
									height="48"
									viewBox="0 0 24 24"
									fill="none"
									stroke="#2563EB"
									stroke-width="1.5"
									><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"
									></circle></svg
								>
								<span class="artwork-code">NTR-088</span>
							</div>
						</div>
						<div class="release-details">
							<div class="release-header-row">
								<div>
									<div class="badge-row">
										<span class="tag tag-blue">EP Release</span>
										<span class="tag tag-green">Pre-Flight Passed</span>
										<span class="tag tag-neutral">DDEX ERN 4.3</span>
									</div>
									<h1 class="release-title">Silicon Valley Drift</h1>
									<p class="release-artist">
										Kinetic Cell &amp; Cyberia · <span>Neutrino Recordings</span>
									</p>
								</div>
								<div class="release-actions">
									<button type="button" class="btn btn-secondary">
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline
												points="7 10 12 15 17 10"
											></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg
										>
										Export Stems (FLAC)
									</button>
									<button type="button" class="btn btn-primary">
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg
										>
										Submit to DSP Feed
									</button>
								</div>
							</div>

							<div class="meta-strip">
								<div class="meta-item">
									<span class="meta-label">Catalog No</span>
									<span class="meta-val font-mono">NTR-088</span>
								</div>
								<div class="meta-item">
									<span class="meta-label">UPC / EAN</span>
									<span class="meta-val font-mono">0793573194812</span>
								</div>
								<div class="meta-item">
									<span class="meta-label">Master Vault</span>
									<span class="meta-val font-mono">Cloudflare R2 (4 Tracks)</span>
								</div>
								<div class="meta-item">
									<span class="meta-label">AI Demucs Stems</span>
									<span class="meta-val font-mono">16 Stems Isolated</span>
								</div>
							</div>
						</div>
					</div>
				</section>

				<!-- AUDIOKIT PRE-FLIGHT TELEMETRY TABLE -->
				<section class="card">
					<div class="card-header">
						<div>
							<h2 class="card-title">AudioKit Real-Time Pre-Flight Audit</h2>
							<p class="card-desc">
								Lossless master analysis, compliance verification, and Demucs stem extraction.
							</p>
						</div>
						<div class="header-tags">
							<span class="tag tag-neutral">Loudness Target: -14.0 LUFS</span>
							<span class="tag tag-neutral">True-Peak Ceiling: -1.0 dBTP</span>
						</div>
					</div>

					<div class="table-responsive">
						<table class="modern-table">
							<thead>
								<tr>
									<th>#</th>
									<th>Track Title</th>
									<th>Integrated LUFS</th>
									<th>True Peak</th>
									<th>BPM</th>
									<th>Key</th>
									<th>Stem Status</th>
									<th>CLAP Acoustic AI Tags</th>
									<th style="text-align: right;">Status</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td class="font-mono muted">01</td>
									<td>
										<div class="track-name">Neon Wiretap</div>
										<span class="track-sub font-mono">NL-E88-26-00881</span>
									</td>
									<td class="font-mono">-13.9 LUFS</td>
									<td class="font-mono text-emerald">-0.5 dBTP</td>
									<td class="font-mono">132.0</td>
									<td class="font-mono">Bbm</td>
									<td><span class="badge-chip chip-cyan">4 Stems Ready</span></td>
									<td
										><span class="tag-subtle">Hypnotic</span>
										<span class="tag-subtle">Acid Techno</span></td
									>
									<td style="text-align: right;"
										><span class="badge-pill badge-success">Passed</span></td
									>
								</tr>
								<tr>
									<td class="font-mono muted">02</td>
									<td>
										<div class="track-name">Bipolar Transistor</div>
										<span class="track-sub font-mono">NL-E88-26-00882</span>
									</td>
									<td class="font-mono">-14.1 LUFS</td>
									<td class="font-mono text-emerald">-0.8 dBTP</td>
									<td class="font-mono">135.0</td>
									<td class="font-mono">F#m</td>
									<td><span class="badge-chip chip-cyan">4 Stems Ready</span></td>
									<td
										><span class="tag-subtle">Industrial</span>
										<span class="tag-subtle">Driving</span></td
									>
									<td style="text-align: right;"
										><span class="badge-pill badge-success">Passed</span></td
									>
								</tr>
								<tr class:row-highlight={autoNormalized}>
									<td class="font-mono muted">03</td>
									<td>
										<div class="track-name">Zero-Day Exploit</div>
										<span class="track-sub font-mono">NL-E88-26-00883</span>
									</td>
									<td class="font-mono">{autoNormalized ? '-14.0 LUFS' : '-11.2 LUFS'}</td>
									<td
										class="font-mono"
										class:text-danger={!autoNormalized}
										class:text-emerald={autoNormalized}
									>
										{autoNormalized ? '-1.0 dBTP' : '+0.4 dBTP'}
									</td>
									<td class="font-mono">138.0</td>
									<td class="font-mono">Dm</td>
									<td><span class="badge-chip chip-cyan">4 Stems Ready</span></td>
									<td
										><span class="tag-subtle">Peak-Time</span>
										<span class="tag-subtle">Dark Electro</span></td
									>
									<td style="text-align: right;">
										{#if autoNormalized}
											<span class="badge-pill badge-success">Auto-Normalized</span>
										{:else}
											<span class="badge-pill badge-warning">Clipping (+0.4)</span>
										{/if}
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<!-- ALERT BANNER -->
					{#if !autoNormalized}
						<div class="alert-box alert-warning">
							<div class="alert-icon">
								<svg
									width="20"
									height="20"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									><path
										d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
									></path><line x1="12" y1="9" x2="12" y2="13"></line><line
										x1="12"
										y1="17"
										x2="12.01"
										y2="17"
									></line></svg
								>
							</div>
							<div class="alert-content">
								<strong>Pre-Flight Violation on Track 03:</strong> Spotify and Apple Music True-Peak
								ceiling exceeded (+0.4 dBTP).
								<p class="alert-sub">
									AudioKit can apply transparent gain offset without re-encoding to guarantee
									delivery acceptance.
								</p>
							</div>
							<button type="button" class="btn btn-warning-action" onclick={fixLoudness}>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg
								>
								Auto-Normalize to -1.0 dBTP
							</button>
						</div>
					{:else}
						<div class="alert-box alert-success">
							<div class="alert-icon">
								<svg
									width="20"
									height="20"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline
										points="22 4 12 14.01 9 11.01"
									></polyline></svg
								>
							</div>
							<div class="alert-content">
								<strong>AudioKit Correction Applied:</strong> Gain offset of -1.4 dB written. SHA-256
								hash verified. Ready for delivery.
							</div>
						</div>
					{/if}
				</section>

				<!-- MODERN AUDIO & STEM MIXER CARD -->
				<section class="card mixer-card">
					<div class="card-header">
						<div>
							<h2 class="card-title">Interactive Master &amp; Demucs Stems Console</h2>
							<p class="card-desc">
								Lossless 24-bit/44.1kHz WAV playback with individual stem isolation.
							</p>
						</div>
						<div class="playback-badge">
							<span class="pulse-dot" class:active={isPlaying}></span>
							<span>{isPlaying ? 'Streaming Lossless Master' : 'Ready'}</span>
						</div>
					</div>

					<div class="player-controls-row">
						<button
							type="button"
							class="btn-play-circle"
							onclick={togglePlay}
							aria-label={isPlaying ? 'Pause' : 'Play'}
						>
							{#if isPlaying}
								<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"
									><rect x="6" y="4" width="4" height="16"></rect><rect
										x="14"
										y="4"
										width="4"
										height="16"
									></rect></svg
								>
							{:else}
								<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"
									><polygon points="5 3 19 12 5 21 5 3"></polygon></svg
								>
							{/if}
						</button>

						<div class="waveform-progress-wrap">
							<div class="track-time font-mono">02:41</div>
							<div class="waveform-bar-visualizer">
								<div class="waveform-progress" style:width="{playbackProgress}%"></div>
								<div class="waveform-bars">
									{#each Array(48) as _, i}
										<div
											class="wave-col"
											style:height="{20 + Math.sin(i * 0.4) * 15 + Math.cos(i * 0.9) * 12}px"
										></div>
									{/each}
								</div>
							</div>
							<div class="track-time font-mono">06:24</div>
						</div>

						<div class="master-meter-block font-mono">
							<div class="meter-channel">
								<span>L</span>
								<div class="meter-track">
									<div class="meter-fill" style:width="{vuMeterL}%"></div>
								</div>
								<span>-{((100 - vuMeterL) / 5).toFixed(1)} dB</span>
							</div>
							<div class="meter-channel">
								<span>R</span>
								<div class="meter-track">
									<div class="meter-fill" style:width="{vuMeterR}%"></div>
								</div>
								<span>-{((100 - vuMeterR) / 5).toFixed(1)} dB</span>
							</div>
						</div>
					</div>

					<!-- STEM MIXER CHIPS -->
					<div class="stems-grid">
						<button
							type="button"
							class="stem-card"
							class:stem-muted={stemMute.drums}
							onclick={() => (stemMute.drums = !stemMute.drums)}
						>
							<div class="stem-header">
								<span class="stem-indicator stem-cyan"></span>
								<span class="stem-title">Drums Bus</span>
								<span class="stem-action">{stemMute.drums ? 'Muted' : 'Active'}</span>
							</div>
							<div class="stem-waveform stem-cyan-bg">
								<div class="stem-wave-bar" style="height: 60%"></div>
								<div class="stem-wave-bar" style="height: 90%"></div>
								<div class="stem-wave-bar" style="height: 40%"></div>
								<div class="stem-wave-bar" style="height: 80%"></div>
								<div class="stem-wave-bar" style="height: 50%"></div>
							</div>
						</button>

						<button
							type="button"
							class="stem-card"
							class:stem-muted={stemMute.bass}
							onclick={() => (stemMute.bass = !stemMute.bass)}
						>
							<div class="stem-header">
								<span class="stem-indicator stem-indigo"></span>
								<span class="stem-title">303 Acid Bass</span>
								<span class="stem-action">{stemMute.bass ? 'Muted' : 'Active'}</span>
							</div>
							<div class="stem-waveform stem-indigo-bg">
								<div class="stem-wave-bar" style="height: 40%"></div>
								<div class="stem-wave-bar" style="height: 70%"></div>
								<div class="stem-wave-bar" style="height: 85%"></div>
								<div class="stem-wave-bar" style="height: 60%"></div>
								<div class="stem-wave-bar" style="height: 75%"></div>
							</div>
						</button>

						<button
							type="button"
							class="stem-card"
							class:stem-muted={stemMute.synth}
							onclick={() => (stemMute.synth = !stemMute.synth)}
						>
							<div class="stem-header">
								<span class="stem-indicator stem-violet"></span>
								<span class="stem-title">Monolith Lead Synth</span>
								<span class="stem-action">{stemMute.synth ? 'Muted' : 'Active'}</span>
							</div>
							<div class="stem-waveform stem-violet-bg">
								<div class="stem-wave-bar" style="height: 80%"></div>
								<div class="stem-wave-bar" style="height: 50%"></div>
								<div class="stem-wave-bar" style="height: 70%"></div>
								<div class="stem-wave-bar" style="height: 95%"></div>
								<div class="stem-wave-bar" style="height: 60%"></div>
							</div>
						</button>

						<button
							type="button"
							class="stem-card"
							class:stem-muted={stemMute.vox}
							onclick={() => (stemMute.vox = !stemMute.vox)}
						>
							<div class="stem-header">
								<span class="stem-indicator stem-rose"></span>
								<span class="stem-title">Chopped Vocal Stems</span>
								<span class="stem-action">{stemMute.vox ? 'Muted' : 'Active'}</span>
							</div>
							<div class="stem-waveform stem-rose-bg">
								<div class="stem-wave-bar" style="height: 30%"></div>
								<div class="stem-wave-bar" style="height: 60%"></div>
								<div class="stem-wave-bar" style="height: 45%"></div>
								<div class="stem-wave-bar" style="height: 80%"></div>
								<div class="stem-wave-bar" style="height: 55%"></div>
							</div>
						</button>
					</div>
				</section>
			</div>
		{/if}

		<!-- TAB 2: DISTROKID VS ERMS -->
		{#if activeTab === 'distrokid'}
			<section class="card">
				<div class="card-header">
					<div>
						<h2 class="card-title">Comparative Analysis: DistroKid vs. ERMS Architecture</h2>
						<p class="card-desc">
							Why modern independent labels, imprints, and electronic collectives choose ERMS.
						</p>
					</div>
				</div>

				<div class="table-responsive">
					<table class="modern-table">
						<thead>
							<tr>
								<th>Feature / Requirement</th>
								<th>DistroKid (Commodity DIY)</th>
								<th>ERMS Platform</th>
								<th>The Strategic Advantage</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td class="font-medium">Target Customer</td>
								<td class="muted">Bedroom solo creators ($23/yr)</td>
								<td><strong class="text-blue">Independent Labels &amp; Collectives</strong></td>
								<td>High ARPU, low churn, zero artificial streaming fraud spam.</td>
							</tr>
							<tr>
								<td class="font-medium">Multi-Tenancy &amp; Access</td>
								<td class="muted">Single password or basic teams</td>
								<td><strong class="text-blue">PostgreSQL 17 RLS per Org</strong></td>
								<td>Cryptographic data isolation between catalogs and labels.</td>
							</tr>
							<tr>
								<td class="font-medium">Audio Intelligence</td>
								<td class="muted">Rudimentary limiter (Mixea)</td>
								<td><strong class="text-blue">Rust DSP + Modal L4 GPUs</strong></td>
								<td>EBU R128 compliance, AcoustID, and Demucs stem extraction.</td>
							</tr>
							<tr>
								<td class="font-medium">Master Asset Vault</td>
								<td class="muted">Discards uncompressed stems</td>
								<td><strong class="text-blue">Cloudflare R2 Lossless Vault</strong></td>
								<td>Your masters are stored forever with SHA-256 tamperproof hashes.</td>
							</tr>
							<tr>
								<td class="font-medium">Studio / DAW Integration</td>
								<td class="muted">None (Upload via web browser)</td>
								<td><strong class="text-blue">Epsilon Audio Plugin Export</strong></td>
								<td>One-click bounce from Ableton/Logic directly into catalog staging.</td>
							</tr>
							<tr>
								<td class="font-medium">Contract Splits &amp; Waterfalls</td>
								<td class="muted">Basic percentage split</td>
								<td><strong class="text-blue">Advance Recoupment Waterfall</strong></td>
								<td>Recoups advances automatically before split percentages kick in.</td>
							</tr>
							<tr>
								<td class="font-medium">Auditability</td>
								<td class="muted">Opaque black box</td>
								<td><strong class="text-blue">Append-Only Audit Log</strong></td>
								<td>Immutable audit triggers prove every calculation to artists.</td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		<!-- TAB 3: SELF-SERVE ONBOARDING -->
		{#if activeTab === 'onboarding'}
			<section class="card" style="max-width: 760px; margin: 0 auto;">
				<div class="card-header">
					<div>
						<h2 class="card-title">Self-Serve Organization Provisioning</h2>
						<p class="card-desc">
							Create a new independent record label partition in the ERMS network (Decision 0023).
						</p>
					</div>
				</div>

				{#if onboardingComplete}
					<div class="alert-box alert-success" style="margin: 20px;">
						<div class="alert-icon">
							<svg
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline
									points="22 4 12 14.01 9 11.01"
								></polyline></svg
							>
						</div>
						<div class="alert-content">
							<h3 style="margin: 0 0 4px 0; font-size: 1rem;">
								Label Partition Created Successfully!
							</h3>
							<p style="margin: 0; color: #065F46; font-size: 0.9rem;">
								<strong>{newOrgName}</strong> (slug: <code>{newOrgSlug}</code>) has been
								provisioned. Your Supabase RLS membership role is <strong>Owner</strong>, your
								private Cloudflare R2 bucket partition is ready, and your AudioKit API key has been
								generated.
							</p>
							<button
								type="button"
								class="btn btn-primary"
								style="margin-top: 14px;"
								onclick={() => (onboardingComplete = false)}
							>
								Provision Another Organization
							</button>
						</div>
					</div>
				{:else}
					<form onsubmit={handleOnboardingSubmit} class="form-layout">
						<div class="form-group">
							<label for="orgName" class="form-label">Record Label / Entity Name</label>
							<input
								id="orgName"
								type="text"
								class="input-control"
								bind:value={newOrgName}
								required
								placeholder="e.g. Sub-Zero Recordings"
							/>
							<span class="form-hint"
								>The legal or brand name that appears on releases and contracts.</span
							>
						</div>

						<div class="form-row">
							<div class="form-group">
								<label for="orgSlug" class="form-label">URL Identifier Slug</label>
								<div class="input-prefix-wrap">
									<span class="input-prefix font-mono">erms.epsilonrecords.com/</span>
									<input
										id="orgSlug"
										type="text"
										class="input-control font-mono"
										bind:value={newOrgSlug}
										required
									/>
								</div>
							</div>

							<div class="form-group">
								<label for="isrcPrefix" class="form-label">IFPI Registrant Code (ISRC Prefix)</label
								>
								<input
									id="isrcPrefix"
									type="text"
									class="input-control font-mono"
									bind:value={isrcPrefix}
									required
									placeholder="e.g. NL-E88"
								/>
							</div>
						</div>

						<div class="form-group">
							<label for="audioSuite" class="form-label">Default AudioKit Automation Policy</label>
							<select id="audioSuite" class="input-control">
								<option>Full Automated Suite (Loudness, Stems, Key, Tempo &amp; CLAP Tags)</option>
								<option>Loudness Compliance Only (EBU R128 + True Peak Normalization)</option>
								<option>Manual Dispatch Only</option>
							</select>
						</div>

						<div class="form-footer">
							<button type="submit" class="btn btn-primary btn-lg">
								Provision Label Partition
							</button>
						</div>
					</form>
				{/if}
			</section>
		{/if}

		<!-- TAB 4: SPLITS & CONTRACTS -->
		{#if activeTab === 'splits'}
			<div class="content-stack">
				<section class="card">
					<div class="card-header">
						<div>
							<h2 class="card-title">Contract Recoupment Waterfall</h2>
							<p class="card-desc">
								Tracks master advance recoupment before executing net royalty distributions.
							</p>
						</div>
						<span class="tag tag-blue">Release: NTR-088</span>
					</div>

					<!-- RECOUPMENT PROGRESS BAR -->
					<div class="recoupment-banner">
						<div class="recoupment-header">
							<div>
								<span class="recoupment-title">Studio Master Advance Recoupment</span>
								<span class="recoupment-nums font-mono">$1,170.00 / $1,500.00 Recouped</span>
							</div>
							<span class="recoupment-pct font-mono">78%</span>
						</div>
						<div class="progress-track">
							<div class="progress-fill" style="width: 78%;"></div>
						</div>
						<span class="recoupment-sub muted"
							>$330.00 remaining before producer secondary revenue split activates.</span
						>
					</div>

					<div class="table-responsive">
						<table class="modern-table">
							<thead>
								<tr>
									<th>Beneficiary</th>
									<th>Role</th>
									<th>Split Share</th>
									<th>Waterfall Condition</th>
									<th style="text-align: right;">Status</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td>
										<div class="track-name">Nate Houk</div>
										<span class="track-sub font-mono">nate@epsilonrecords.com</span>
									</td>
									<td>Producer &amp; Mixing</td>
									<td class="font-mono font-medium">45.00%</td>
									<td class="muted">Activates immediately post-recoupment ($1,500)</td>
									<td style="text-align: right;"
										><span class="badge-pill badge-neutral">Pending Recoupment</span></td
									>
								</tr>
								<tr>
									<td>
										<div class="track-name">Cyberia Guest</div>
										<span class="track-sub font-mono">cyberia@artist.net</span>
									</td>
									<td>Featured Vocalist</td>
									<td class="font-mono font-medium">25.00%</td>
									<td class="muted">Dollar-1 gross share (Unrecouped allocation)</td>
									<td style="text-align: right;"
										><span class="badge-pill badge-success">Active &amp; Paying</span></td
									>
								</tr>
								<tr>
									<td>
										<div class="track-name">Neutrino Recordings</div>
										<span class="track-sub font-mono">Label Entity</span>
									</td>
									<td>Master Owner</td>
									<td class="font-mono font-medium">30.00%</td>
									<td class="muted">Recoups 100% of master advance first ($1,500)</td>
									<td style="text-align: right;"
										><span class="badge-pill badge-success">Active Recouping</span></td
									>
								</tr>
							</tbody>
						</table>
					</div>
				</section>

				<!-- AUDIT LOG FEED -->
				<section class="card">
					<div class="card-header">
						<div>
							<h2 class="card-title">Tamperproof Audit Log</h2>
							<p class="card-desc">
								Every catalog change is cryptographically audited via database triggers
								(`withAudit`).
							</p>
						</div>
					</div>

					<div class="audit-list">
						<div class="audit-item">
							<div class="audit-bullet"></div>
							<div class="audit-info">
								<span class="audit-msg"
									><strong>MASTER_COMMIT</strong>: FLAC master sha256:7f3a8... verified and sealed
									in R2</span
								>
								<span class="audit-meta font-mono"
									>2026-11-08 14:02:11 UTC · User: nate@epsilonrecords.com</span
								>
							</div>
						</div>
						<div class="audit-item">
							<div class="audit-bullet"></div>
							<div class="audit-info">
								<span class="audit-msg"
									><strong>AUDIOKIT_JOB</strong>: EBU R128 loudness analysis completed (Integrated:
									-13.9 LUFS, Peak: -0.5 dBTP)</span
								>
								<span class="audit-meta font-mono">2026-11-08 14:02:18 UTC · System Actor</span>
							</div>
						</div>
						<div class="audit-item">
							<div class="audit-bullet"></div>
							<div class="audit-info">
								<span class="audit-msg"
									><strong>STEM_ISOLATION</strong>: Demucs 4-stem decomposition finished on Modal L4
									(Job ID: ak-9012)</span
								>
								<span class="audit-meta font-mono">2026-11-08 14:02:44 UTC · Modal Worker</span>
							</div>
						</div>
						<div class="audit-item">
							<div class="audit-bullet"></div>
							<div class="audit-info">
								<span class="audit-msg"
									><strong>CONTRACT_LOCK</strong>: Royalty split waterfall signed and immutable by
									3/3 parties</span
								>
								<span class="audit-meta font-mono"
									>2026-11-08 14:03:00 UTC · Transaction 0x9bf4</span
								>
							</div>
						</div>
					</div>
				</section>
			</div>
		{/if}
	</main>

	<!-- FOOTER -->
	<footer class="footer">
		<div class="footer-container">
			<div class="footer-left">
				<strong>ERMS</strong> · Modern Music Rights &amp; Audio Distribution Platform
			</div>
			<div class="footer-right">
				<span>AudioKit Engine</span> · <span>Epsilon Audio</span> · <span>Amsterdam</span>
			</div>
		</div>
	</footer>
</div>

<style>
	:global(body) {
		background-color: #f8fafc !important;
		color: #0f172a !important;
		font-family:
			'IBM Plex Sans',
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			Roboto,
			sans-serif !important;
		margin: 0;
		padding: 0;
		-webkit-font-smoothing: antialiased;
	}

	.font-mono {
		font-family: 'IBM Plex Mono', 'SF Mono', Menlo, monospace;
	}

	.app-shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	/* NAVBAR */
	.navbar {
		background: #ffffff;
		border-bottom: 1px solid #e2e8f0;
		position: sticky;
		top: 0;
		z-index: 50;
	}

	.nav-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 24px;
		height: 64px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.brand-group {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.logo-mark {
		width: 32px;
		height: 32px;
		background: #2563eb;
		color: #ffffff;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.brand-name {
		font-weight: 700;
		font-size: 1.15rem;
		letter-spacing: -0.5px;
	}

	.brand-sub {
		font-size: 0.8rem;
		color: #64748b;
		background: #f1f5f9;
		padding: 2px 8px;
		border-radius: 6px;
		font-weight: 500;
	}

	.org-selector {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.org-label {
		font-size: 0.75rem;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		font-weight: 600;
	}

	.org-badge {
		display: flex;
		align-items: center;
		gap: 8px;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		padding: 4px 10px;
		border-radius: 8px;
	}

	.org-dot {
		width: 8px;
		height: 8px;
		background: #10b981;
		border-radius: 50%;
	}

	.org-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #1e293b;
	}

	.org-role {
		font-size: 0.7rem;
		background: #e2e8f0;
		color: #475569;
		padding: 1px 6px;
		border-radius: 4px;
		font-weight: 600;
	}

	.system-status-pills {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.status-pill {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.75rem;
		font-weight: 500;
		padding: 4px 10px;
		border-radius: 20px;
	}

	.status-live {
		background: #ecfdf5;
		color: #065f46;
		border: 1px solid #a7f3d0;
	}

	.status-live .dot {
		width: 6px;
		height: 6px;
		background: #10b981;
		border-radius: 50%;
	}

	.status-neutral {
		background: #f8fafc;
		color: #64748b;
		border: 1px solid #e2e8f0;
	}

	/* TAB STRIP */
	.tab-strip {
		background: #ffffff;
		border-bottom: 1px solid #e2e8f0;
	}

	.tab-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 24px;
	}

	.nav-tabs {
		display: flex;
		gap: 24px;
	}

	.tab-btn {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 14px 4px;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		color: #64748b;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 8px;
		transition: all 0.15s ease;
	}

	.tab-btn:hover {
		color: #0f172a;
	}

	.tab-btn.active {
		color: #2563eb;
		border-bottom-color: #2563eb;
		font-weight: 600;
	}

	/* MAIN CONTENT */
	.main-content {
		max-width: 1200px;
		margin: 24px auto;
		padding: 0 24px;
		width: 100%;
		box-sizing: border-box;
		flex: 1;
	}

	.content-stack {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.card {
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.04);
		overflow: hidden;
	}

	.card-header {
		padding: 20px 24px;
		border-bottom: 1px solid #f1f5f9;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.card-title {
		font-size: 1.05rem;
		font-weight: 600;
		color: #0f172a;
		margin: 0 0 4px 0;
	}

	.card-desc {
		font-size: 0.85rem;
		color: #64748b;
		margin: 0;
	}

	/* RELEASE HERO */
	.release-layout {
		display: flex;
		gap: 24px;
		padding: 24px;
		align-items: center;
	}

	.artwork-block {
		width: 110px;
		height: 110px;
		background: #eff6ff;
		border: 1px solid #bfdbfe;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.artwork-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.artwork-code {
		font-size: 0.7rem;
		font-weight: 700;
		color: #2563eb;
		font-family: monospace;
	}

	.release-details {
		flex: 1;
	}

	.release-header-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 16px;
	}

	.badge-row {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
	}

	.release-title {
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.5px;
		margin: 0 0 4px 0;
		color: #0f172a;
	}

	.release-artist {
		font-size: 0.95rem;
		color: #475569;
		margin: 0;
	}

	.release-artist span {
		color: #2563eb;
		font-weight: 500;
	}

	.release-actions {
		display: flex;
		gap: 8px;
	}

	.meta-strip {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
		background: #f8fafc;
		border: 1px solid #f1f5f9;
		padding: 10px 16px;
		border-radius: 8px;
	}

	.meta-item {
		display: flex;
		flex-direction: column;
	}

	.meta-label {
		font-size: 0.72rem;
		color: #94a3b8;
		text-transform: uppercase;
		font-weight: 600;
		letter-spacing: 0.5px;
	}

	.meta-val {
		font-size: 0.85rem;
		font-weight: 600;
		color: #1e293b;
	}

	/* BUTTONS */
	.btn {
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		padding: 8px 14px;
		border-radius: 8px;
		border: 1px solid transparent;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		transition: all 0.15s ease;
	}

	.btn-primary {
		background: #2563eb;
		color: #ffffff;
	}

	.btn-primary:hover {
		background: #1d4ed8;
	}

	.btn-secondary {
		background: #ffffff;
		border-color: #cbd5e1;
		color: #334155;
	}

	.btn-secondary:hover {
		background: #f8fafc;
		border-color: #94a3b8;
	}

	.btn-warning-action {
		background: #e11d48;
		color: #ffffff;
		padding: 8px 14px;
	}

	.btn-warning-action:hover {
		background: #be123c;
	}

	.btn-lg {
		padding: 12px 20px;
		font-size: 0.95rem;
	}

	/* TAGS & BADGES */
	.tag {
		font-size: 0.75rem;
		padding: 2px 8px;
		border-radius: 6px;
		font-weight: 500;
	}

	.tag-blue {
		background: #eff6ff;
		color: #1d4ed8;
		border: 1px solid #bfdbfe;
	}
	.tag-green {
		background: #ecfdf5;
		color: #047857;
		border: 1px solid #a7f3d0;
	}
	.tag-neutral {
		background: #f1f5f9;
		color: #475569;
		border: 1px solid #e2e8f0;
	}

	.badge-pill {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 3px 10px;
		border-radius: 20px;
		display: inline-block;
	}

	.badge-success {
		background: #ecfdf5;
		color: #065f46;
	}
	.badge-warning {
		background: #fff1f2;
		color: #be123c;
		border: 1px solid #fecdd3;
	}
	.badge-neutral {
		background: #f1f5f9;
		color: #475569;
	}

	.tag-subtle {
		font-size: 0.72rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		color: #475569;
		padding: 2px 6px;
		border-radius: 4px;
		margin-right: 4px;
	}

	.badge-chip {
		font-size: 0.72rem;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 4px;
	}

	.chip-cyan {
		background: #ecfeff;
		color: #0891b2;
		border: 1px solid #a5f3fc;
	}

	/* TABLES */
	.table-responsive {
		overflow-x: auto;
	}

	.modern-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88rem;
		text-align: left;
	}

	.modern-table th {
		background: #f8fafc;
		color: #64748b;
		font-weight: 600;
		padding: 12px 20px;
		border-bottom: 1px solid #e2e8f0;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.modern-table td {
		padding: 14px 20px;
		border-bottom: 1px solid #f1f5f9;
		color: #1e293b;
	}

	.modern-table tbody tr:hover td {
		background: #f8fafc;
	}

	.row-highlight td {
		background: #f0fdf4 !important;
	}

	.track-name {
		font-weight: 600;
		color: #0f172a;
	}

	.track-sub {
		font-size: 0.75rem;
		color: #94a3b8;
	}

	.text-emerald {
		color: #059669;
		font-weight: 600;
	}
	.text-danger {
		color: #e11d48;
		font-weight: 700;
	}
	.text-blue {
		color: #2563eb;
	}
	.muted {
		color: #64748b;
	}

	/* ALERTS */
	.alert-box {
		margin: 20px 24px;
		padding: 14px 18px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.alert-warning {
		background: #fff1f2;
		border: 1px solid #fecdd3;
		color: #9f1239;
	}

	.alert-success {
		background: #f0fdf4;
		border: 1px solid #bbf7d0;
		color: #14532d;
	}

	.alert-icon {
		flex-shrink: 0;
	}

	.alert-content {
		flex: 1;
		font-size: 0.88rem;
	}

	.alert-sub {
		margin: 2px 0 0 0;
		font-size: 0.8rem;
		color: #be123c;
	}

	/* PLAYER & MIXER */
	.mixer-card {
		padding-bottom: 20px;
	}

	.player-controls-row {
		display: flex;
		align-items: center;
		gap: 20px;
		padding: 20px 24px;
		background: #f8fafc;
		border-bottom: 1px solid #f1f5f9;
	}

	.btn-play-circle {
		width: 44px;
		height: 44px;
		background: #2563eb;
		color: #ffffff;
		border: none;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3);
		transition: transform 0.1s ease;
	}

	.btn-play-circle:hover {
		transform: scale(1.05);
	}

	.waveform-progress-wrap {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.track-time {
		font-size: 0.8rem;
		color: #64748b;
	}

	.waveform-bar-visualizer {
		flex: 1;
		height: 40px;
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 6px;
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
	}

	.waveform-bars {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		height: 100%;
		padding: 0 10px;
		box-sizing: border-box;
		position: absolute;
		z-index: 2;
	}

	.wave-col {
		width: 3px;
		background: #94a3b8;
		border-radius: 2px;
	}

	.waveform-progress {
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		background: rgba(37, 99, 235, 0.15);
		border-right: 2px solid #2563eb;
		z-index: 1;
	}

	.master-meter-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 160px;
		font-size: 0.75rem;
		color: #64748b;
	}

	.meter-channel {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.meter-track {
		flex: 1;
		height: 6px;
		background: #e2e8f0;
		border-radius: 3px;
		overflow: hidden;
	}

	.meter-fill {
		height: 100%;
		background: linear-gradient(90deg, #10b981 70%, #f59e0b 85%, #f43f5e 95%);
		border-radius: 3px;
		transition: width 0.1s ease;
	}

	.playback-badge {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8rem;
		color: #64748b;
	}

	.pulse-dot {
		width: 8px;
		height: 8px;
		background: #94a3b8;
		border-radius: 50%;
	}

	.pulse-dot.active {
		background: #10b981;
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
	}

	/* STEMS */
	.stems-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 16px;
		padding: 20px 24px 0 24px;
	}

	.stem-card {
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		padding: 14px;
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
	}

	.stem-card:hover {
		border-color: #cbd5e1;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
	}

	.stem-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 10px;
	}

	.stem-indicator {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.stem-cyan {
		background: #06b6d4;
	}
	.stem-indigo {
		background: #6366f1;
	}
	.stem-violet {
		background: #8b5cf6;
	}
	.stem-rose {
		background: #ec4899;
	}

	.stem-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #1e293b;
		flex: 1;
	}

	.stem-action {
		font-size: 0.7rem;
		font-weight: 600;
		color: #64748b;
		background: #f1f5f9;
		padding: 2px 6px;
		border-radius: 4px;
	}

	.stem-waveform {
		height: 24px;
		border-radius: 4px;
		display: flex;
		align-items: flex-end;
		justify-content: space-around;
		padding: 2px 4px;
	}

	.stem-cyan-bg {
		background: #ecfeff;
	}
	.stem-indigo-bg {
		background: #eef2ff;
	}
	.stem-violet-bg {
		background: #f5f3ff;
	}
	.stem-rose-bg {
		background: #fdf2f8;
	}

	.stem-wave-bar {
		width: 6px;
		background: currentColor;
		border-radius: 2px;
	}

	.stem-cyan-bg .stem-wave-bar {
		background: #06b6d4;
	}
	.stem-indigo-bg .stem-wave-bar {
		background: #6366f1;
	}
	.stem-violet-bg .stem-wave-bar {
		background: #8b5cf6;
	}
	.stem-rose-bg .stem-wave-bar {
		background: #ec4899;
	}

	.stem-muted {
		opacity: 0.45;
		background: #f8fafc;
	}

	/* FORM */
	.form-layout {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
	}

	.form-row {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
	}

	.form-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: #1e293b;
	}

	.form-hint {
		font-size: 0.78rem;
		color: #64748b;
	}

	.input-control {
		padding: 10px 14px;
		font-family: inherit;
		font-size: 0.9rem;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		outline: none;
		background: #ffffff;
		transition: border-color 0.15s ease;
	}

	.input-control:focus {
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
	}

	.input-prefix-wrap {
		display: flex;
		align-items: center;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		overflow: hidden;
		background: #f8fafc;
	}

	.input-prefix {
		font-size: 0.8rem;
		color: #64748b;
		padding: 0 10px;
	}

	.input-prefix-wrap .input-control {
		border: none;
		border-left: 1px solid #e2e8f0;
		border-radius: 0;
		flex: 1;
	}

	.form-footer {
		padding-top: 10px;
	}

	/* RECOUPMENT */
	.recoupment-banner {
		padding: 20px 24px;
		background: #f8fafc;
		border-bottom: 1px solid #f1f5f9;
	}

	.recoupment-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		margin-bottom: 8px;
	}

	.recoupment-title {
		font-weight: 600;
		font-size: 0.95rem;
		color: #0f172a;
		display: block;
	}

	.recoupment-nums {
		font-size: 0.8rem;
		color: #64748b;
	}

	.recoupment-pct {
		font-size: 1.25rem;
		font-weight: 700;
		color: #2563eb;
	}

	.progress-track {
		height: 8px;
		background: #e2e8f0;
		border-radius: 4px;
		overflow: hidden;
		margin-bottom: 6px;
	}

	.progress-fill {
		height: 100%;
		background: #2563eb;
		border-radius: 4px;
	}

	.recoupment-sub {
		font-size: 0.78rem;
	}

	/* AUDIT */
	.audit-list {
		padding: 16px 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.audit-item {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}

	.audit-bullet {
		width: 8px;
		height: 8px;
		background: #2563eb;
		border-radius: 50%;
		margin-top: 6px;
		flex-shrink: 0;
	}

	.audit-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.audit-msg {
		font-size: 0.88rem;
		color: #1e293b;
	}

	.audit-meta {
		font-size: 0.75rem;
		color: #94a3b8;
	}

	/* FOOTER */
	.footer {
		background: #ffffff;
		border-top: 1px solid #e2e8f0;
		padding: 20px 0;
		margin-top: auto;
	}

	.footer-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 24px;
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		color: #64748b;
	}
</style>
