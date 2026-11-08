<script lang="ts">
	import { onMount } from 'svelte';

	let activeTab = $state<'catalog' | 'distrokid' | 'onboarding' | 'splits'>('catalog');
	let isPlaying = $state(false);
	let playbackProgress = $state(42);
	let autoNormalized = $state(false);

	// Onboarding form state
	let newOrgName = $state('Neutrino Recordings');
	let newOrgSlug = $state('neutrino');
	let isrcPrefix = $state('NL-E88');
	let onboardingComplete = $state(false);

	// Stem solo / mute states
	let stemMute = $state({ drums: false, bass: false, synth: false, vox: false });

	let vuMeterL = $state(75);
	let vuMeterR = $state(72);

	onMount(() => {
		const interval = setInterval(() => {
			if (isPlaying) {
				playbackProgress = (playbackProgress + 1) % 100;
				vuMeterL = Math.min(95, Math.max(40, Math.floor(70 + Math.sin(Date.now() / 200) * 20)));
				vuMeterR = Math.min(95, Math.max(40, Math.floor(68 + Math.cos(Date.now() / 250) * 22)));
			}
		}, 150);
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
	<title>ERMS // White Cyberpunk ASCII Interface</title>
</svelte:head>

<div class="tui-root">
	<!-- TOP RETRO CYBERPUNK HEADER -->
	<header class="tui-box header-box">
		<div class="top-row">
			<span class="ascii-logo">⚡ ERMS v3.5 // LIGHT-CYBERPUNK</span>
			<span class="badge neon-green">● SYSTEM ONLINE</span>
			<span class="badge cyan">AUDIOKIT DSP: ACTIVE</span>
			<span class="badge magenta">MULTI-TENANT: SELF-SERVE</span>
			<span class="clock">TIME: 2026.11.08 // 14:15 UTC</span>
		</div>
		<pre class="ascii-banner">
 ╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗
 ║  ░░█▀▀░█▀█░▀█▀░█▀▀░█░░░█▀█░█▀█  ░░░█▀▀░█▀▄░█▄█░█▀▀  ░░░█▀█░█░█░█▀▄░▀█▀░█▀█░█░█░▀█▀  ░░░█▀▀░█▀█  ║
 ║  ░░█▀▀░█▀▀░░█░░▀▀█░█░░░█░█░█░█  ░░░█▀▀░█▀▄░█░█░▀▀█  ░░░█▀█░█░█░█░█░░█░░█░█░█▀▄░░█░  ░░░█▀▀░█▀█  ║
 ║  ░░▀▀▀░▀░░░▀▀▀░▀▀▀░▀▀▀░▀▀▀░▀░▀  ░░░▀▀▀░▀░▀░▀░▀░▀▀▀  ░░░▀░▀░▀▀▀░▀▀░░▀▀▀░▀▀▀░▀░▀░░▀░  ░░░▀░▀░▀░▀  ║
 ╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝
		</pre>
		<div class="nav-bar">
			<button
				class="tui-tab"
				class:active={activeTab === 'catalog'}
				onclick={() => (activeTab = 'catalog')}
			>
				[ 01: CATALOG & PRE-FLIGHT ]
			</button>
			<button
				class="tui-tab"
				class:active={activeTab === 'distrokid'}
				onclick={() => (activeTab = 'distrokid')}
			>
				[ 02: DISTROKID VS ERMS ]
			</button>
			<button
				class="tui-tab"
				class:active={activeTab === 'onboarding'}
				onclick={() => (activeTab = 'onboarding')}
			>
				[ 03: SELF-SERVE ONBOARDING ]
			</button>
			<button
				class="tui-tab"
				class:active={activeTab === 'splits'}
				onclick={() => (activeTab = 'splits')}
			>
				[ 04: IMMUTABLE SPLITS ]
			</button>
		</div>
	</header>

	<!-- TAB 1: CATALOG & FLIGHT DECK -->
	{#if activeTab === 'catalog'}
		<section class="tui-box">
			<div class="box-title">
				┌─[ RELEASE: NTR-088 // "SILICON VALLEY DRIFT" (EP) ]──────────────────────────────┐
			</div>
			<div class="release-info-grid">
				<div><strong>ARTIST:</strong> Kinetic Cell & Cyberia</div>
				<div><strong>CATALOG NO:</strong> NTR-088</div>
				<div><strong>UPC:</strong> 0793573194812</div>
				<div><strong>ORGANIZATION:</strong> Neutrino Recordings [Self-Serve Label]</div>
				<div><strong>DISTRIBUTION:</strong> Ready for DDEX ERN 4.3 Export</div>
				<div><strong>R2 MASTER VAULT:</strong> 4 FLAC Masters / 16 Demucs Stems Isolated</div>
			</div>

			<!-- AUDIOKIT LIVE TELEMETRY DECK -->
			<div class="box-subtitle">
				─── [ AUDIOKIT REAL-TIME PRE-FLIGHT AUDIT ] ──────────────────────────────────────────
			</div>
			<div class="table-wrap">
				<table class="tui-table">
					<thead>
						<tr>
							<th>#</th>
							<th>TRACK TITLE</th>
							<th>INTEGRATED LUFS</th>
							<th>TRUE PEAK</th>
							<th>TEMPO</th>
							<th>KEY</th>
							<th>STEMS</th>
							<th>CLAP ZERO-SHOT MOOD</th>
							<th>VERDICT</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>01</td>
							<td>Neon Wiretap</td>
							<td>-13.9 LUFS</td>
							<td>-0.5 dBTP</td>
							<td>132.0 BPM</td>
							<td>Bbm</td>
							<td><span class="badge green">4/4 ISOLATED</span></td>
							<td>Hypnotic, Driving, Acid</td>
							<td><span class="status-pass">✓ PASS</span></td>
						</tr>
						<tr>
							<td>02</td>
							<td>Bipolar Transistor</td>
							<td>-14.1 LUFS</td>
							<td>-0.8 dBTP</td>
							<td>135.0 BPM</td>
							<td>F#m</td>
							<td><span class="badge green">4/4 ISOLATED</span></td>
							<td>Industrial, Electro, Fast</td>
							<td><span class="status-pass">✓ PASS</span></td>
						</tr>
						<tr class:resolved={autoNormalized}>
							<td>03</td>
							<td>Zero-Day Exploit</td>
							<td>{autoNormalized ? '-14.0 LUFS' : '-11.2 LUFS'}</td>
							<td>{autoNormalized ? '-1.0 dBTP' : '+0.4 dBTP'}</td>
							<td>138.0 BPM</td>
							<td>Dm</td>
							<td><span class="badge green">4/4 ISOLATED</span></td>
							<td>Peak-Time Dark Techno</td>
							<td>
								{#if autoNormalized}
									<span class="status-pass">✓ NORMALIZED</span>
								{:else}
									<span class="status-warn">⚠️ CLIPPING (+0.4)</span>
								{/if}
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			{#if !autoNormalized}
				<div class="callout warn-callout">
					<span class="emoji">🚨</span>
					<strong>PRE-FLIGHT FAILURE ON TRACK 03:</strong> Spotify and Apple Music true-peak limit
					exceeded (+0.4 dBTP).
					<button class="tui-btn magenta-btn" onclick={fixLoudness}>
						[ ⚡ TRIGGER AUDIOKIT AUTO-NORMALIZATION TO -1.0 dBTP ]
					</button>
				</div>
			{:else}
				<div class="callout pass-callout">
					<span class="emoji">✨</span>
					<strong>AUDIOKIT CORRECTION APPLIED:</strong> Transparent gain offset applied (-1.4 dB). Output
					hash verified. Ready for DSP ingest.
				</div>
			{/if}

			<!-- INTERACTIVE AUDIO & STEM PLAYER -->
			<div class="player-box">
				<div class="player-controls">
					<button class="tui-btn play-btn" onclick={togglePlay}>
						{isPlaying ? '[ ■ PAUSE ]' : '[ ▶ PLAY PRE-FLIGHT MASTER ]'}
					</button>
					<span class="time-readout">02:41 / 06:24</span>
					<div class="ascii-progress-bar">
						[{'='.repeat(Math.floor(playbackProgress / 4))}{'>'}{'.'.repeat(
							25 - Math.floor(playbackProgress / 4)
						)}]
					</div>
					<span class="bitrate">44.1 kHz · 24-BIT PCM WAV</span>
				</div>

				<div class="vu-meter-row">
					<span class="meter-label">MASTER L:</span>
					<div class="meter-bar"><div class="fill" style:width="{vuMeterL}%"></div></div>
					<span class="meter-val">-{((100 - vuMeterL) / 5).toFixed(1)} dB</span>
					<span class="meter-label">MASTER R:</span>
					<div class="meter-bar"><div class="fill" style:width="{vuMeterR}%"></div></div>
					<span class="meter-val">-{((100 - vuMeterR) / 5).toFixed(1)} dB</span>
				</div>

				<div class="stems-matrix">
					<button
						type="button"
						class="stem-chip"
						class:muted={stemMute.drums}
						onclick={() => (stemMute.drums = !stemMute.drums)}
					>
						DRUMS: [DRUM BUS] {stemMute.drums ? '[MUTE]' : '[SOLO]'}
					</button>
					<button
						type="button"
						class="stem-chip"
						class:muted={stemMute.bass}
						onclick={() => (stemMute.bass = !stemMute.bass)}
					>
						BASS: [303 ACID] {stemMute.bass ? '[MUTE]' : '[SOLO]'}
					</button>
					<button
						type="button"
						class="stem-chip"
						class:muted={stemMute.synth}
						onclick={() => (stemMute.synth = !stemMute.synth)}
					>
						SYNTH: [MONOLITH VST] {stemMute.synth ? '[MUTE]' : '[SOLO]'}
					</button>
					<button
						type="button"
						class="stem-chip"
						class:muted={stemMute.vox}
						onclick={() => (stemMute.vox = !stemMute.vox)}
					>
						VOX: [CHOPPED AI STEM] {stemMute.vox ? '[MUTE]' : '[SOLO]'}
					</button>
				</div>
			</div>
		</section>
	{/if}

	<!-- TAB 2: DISTROKID VS ERMS -->
	{#if activeTab === 'distrokid'}
		<section class="tui-box">
			<div class="box-title">
				┌─[ COMPARATIVE MATRIX: DISTROKID VS ERMS HACKER-LABEL OS ]──────────────────────┐
			</div>
			<p class="section-desc">
				Why independent labels and electronic collectives move away from commodity DIY distributors
				to ERMS.
			</p>

			<div class="table-wrap">
				<table class="tui-table">
					<thead>
						<tr>
							<th>CAPABILITY</th>
							<th>DISTROKID (DIY COMMODITY)</th>
							<th>ERMS + AUDIOKIT + EPSILON AUDIO</th>
							<th>THE STRATEGIC ADVANTAGE</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><strong>Core Customer</strong></td>
							<td>Solo bedroom hobbyists ($23/yr)</td>
							<td>Independent Labels & Music Collectives ($49-$499/mo)</td>
							<td>High retention, high ARPU, zero low-tier spam</td>
						</tr>
						<tr>
							<td><strong>Multi-Tenant Governance</strong></td>
							<td>Single login or basic "Teams" add-on</td>
							<td>Postgres 17 RLS per-org isolation, roles (Owner, Catalog, Rights)</td>
							<td>Strict contractual security for multiple sub-labels</td>
						</tr>
						<tr>
							<td><strong>Audio Intelligence</strong></td>
							<td>Rudimentary limiter (Mixea add-on)</td>
							<td>Native Rust DSP: EBU R128, Beat Grid, Key, Demucs Stems, CLAP AI</td>
							<td>Automated compliance: zero rejected deliveries at DSPs</td>
						</tr>
						<tr>
							<td><strong>Master Storage</strong></td>
							<td>Discards uncompressed stems; paid extras</td>
							<td>Cloudflare R2 private bucket with org-isolated SHA256 integrity</td>
							<td>Your master catalog is an immutable financial asset</td>
						</tr>
						<tr>
							<td><strong>DAW Integration</strong></td>
							<td>None (Upload via slow web forms)</td>
							<td>Direct export from Epsilon Audio plugins (CLAP / VST3 / AU)</td>
							<td>Zero-friction workflow from studio session to vault</td>
						</tr>
						<tr>
							<td><strong>Audit & Proof</strong></td>
							<td>Black box; no transparency</td>
							<td>Cryptographic append-only audit trail (`withAudit()`)</td>
							<td>Auditable statements that artists and managers trust</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<!-- TAB 3: SELF-SERVE ONBOARDING -->
	{#if activeTab === 'onboarding'}
		<section class="tui-box">
			<div class="box-title">
				┌─[ SELF-SERVE LABEL CREATION // REGISTER NEW ORGANISATION ]─────────────────────┐
			</div>
			{#if onboardingComplete}
				<div class="callout pass-callout">
					<span class="emoji">🎉</span>
					<div>
						<strong>ORGANISATION PROVISIONED:</strong> Label <strong>{newOrgName}</strong> (slug:
						<code>{newOrgSlug}</code>) created successfully!
						<br />
						Your Supabase RLS boundaries, Cloudflare R2 bucket partition (<code
							>orgs/{newOrgSlug}/...</code
						>), and AudioKit API key are active.
						<br />
						<button
							class="tui-btn cyan-btn"
							style="margin-top: 10px;"
							onclick={() => (onboardingComplete = false)}
						>
							[ CREATE ANOTHER LABEL ]
						</button>
					</div>
				</div>
			{:else}
				<form onsubmit={handleOnboardingSubmit} class="onboarding-form">
					<p class="section-desc">
						Any label owner can self-serve a new catalog partition. Complete the manifest below:
					</p>

					<div class="form-grid">
						<label>
							<span class="label-tag">LABEL / ORGANISATION NAME:</span>
							<input type="text" class="tui-input" bind:value={newOrgName} required />
						</label>

						<label>
							<span class="label-tag">URL SLUG:</span>
							<input type="text" class="tui-input" bind:value={newOrgSlug} required />
						</label>

						<label>
							<span class="label-tag">IFPI ISRC REGISTRANT PREFIX:</span>
							<input type="text" class="tui-input" bind:value={isrcPrefix} required />
						</label>

						<label>
							<span class="label-tag">AUTOMATED AUDIOKIT PRE-FLIGHT:</span>
							<select class="tui-input">
								<option>Full Suite (Loudness + Stems + CLAP Tags + Key)</option>
								<option>Compliance Only (EBU R128 + True Peak Normalization)</option>
								<option>Manual Dispatch</option>
							</select>
						</label>
					</div>

					<div class="form-actions">
						<button type="submit" class="tui-btn submit-btn">
							[ 💾 PROVISION NEW LABEL ON ERMS ]
						</button>
					</div>
				</form>
			{/if}
		</section>
	{/if}

	<!-- TAB 4: IMMUTABLE SPLITS -->
	{#if activeTab === 'splits'}
		<section class="tui-box">
			<div class="box-title">
				┌─[ CONTRACT RECOUPMENT WATERFALL & SPLIT LEDGER ]──────────────────────────────┐
			</div>
			<p class="section-desc">
				Decentralized accounting engine: tracks master advance recoupment and executes split
				waterfalls.
			</p>

			<div class="table-wrap">
				<table class="tui-table">
					<thead>
						<tr>
							<th>PAYEE / STAKEHOLDER</th>
							<th>ROLE</th>
							<th>SPLIT %</th>
							<th>RECOUPMENT WATERFALL CONDITION</th>
							<th>PAYOUT STATUS</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Nate Houk</td>
							<td>Producer / Mix Engineer</td>
							<td>45.00%</td>
							<td>Post-recoupment ($1,500 advance)</td>
							<td><span class="badge green">VERIFIED</span></td>
						</tr>
						<tr>
							<td>Cyberia Guest</td>
							<td>Featured Vocalist</td>
							<td>25.00%</td>
							<td>From Dollar 1 (Unrecouped gross share)</td>
							<td><span class="badge green">VERIFIED</span></td>
						</tr>
						<tr>
							<td>Neutrino Recordings</td>
							<td>Label / Master Owner</td>
							<td>30.00%</td>
							<td>Recoups $1,500 Studio Advance first</td>
							<td><span class="badge cyan">RECOUPING (78%)</span></td>
						</tr>
					</tbody>
				</table>
			</div>

			<div class="box-subtitle">
				─── [ CRYPTOGRAPHIC AUDIT LOG TAIL ] ─────────────────────────────────────────────
			</div>
			<div class="audit-log-terminal">
				<div class="log-entry">
					<code>[2026-11-08 14:02:11 UTC]</code> <strong>MASTER_UPLOAD</strong>: sha256:7f3a8...
					committed to R2 (user: nate@epsilonrecords.com)
				</div>
				<div class="log-entry">
					<code>[2026-11-08 14:02:18 UTC]</code> <strong>AUDIOKIT_JOB</strong>: Probe + Loudness
					check completed in 412ms (integrated: -13.9 LUFS)
				</div>
				<div class="log-entry">
					<code>[2026-11-08 14:02:44 UTC]</code> <strong>STEM_EXTRACT</strong>: HTDemucs 4-stem
					decomposition finished on Modal L4 (job_id: ak-9012)
				</div>
				<div class="log-entry">
					<code>[2026-11-08 14:03:00 UTC]</code> <strong>SPLIT_LOCK</strong>: Contract hash locked
					by 3/3 signers (`withAudit` transaction 0x9bf4)
				</div>
			</div>
		</section>
	{/if}

	<!-- FOOTER -->
	<footer class="tui-box footer-box">
		<span>ERMS × AUDIOKIT × EPSILON AUDIO // THE RETRO-CYBERPUNK INDIE OPERATING SYSTEM</span>
		<span>AMSTERDAM · OPEN-SOURCE CORE</span>
	</footer>
</div>

<style>
	:global(body) {
		background-color: #fafaf7 !important;
		color: #111317 !important;
		font-family: 'IBM Plex Mono', 'Courier New', monospace !important;
		margin: 0;
		padding: 16px;
	}

	.tui-root {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.tui-box {
		background: #ffffff;
		border: 1px solid #111317;
		padding: 16px;
		box-shadow: 4px 4px 0px #111317;
	}

	.top-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		border-bottom: 1px dashed #111317;
		padding-bottom: 10px;
		margin-bottom: 10px;
	}

	.ascii-logo {
		font-weight: 700;
		font-size: 1.1rem;
		letter-spacing: -0.5px;
	}

	.badge {
		font-size: 0.75rem;
		padding: 2px 8px;
		border: 1px solid #111317;
		font-weight: 600;
	}

	.neon-green {
		background: #00d26a;
		color: #000;
	}
	.cyan {
		background: #00b4d8;
		color: #000;
	}
	.magenta {
		background: #ff0055;
		color: #fff;
	}
	.green {
		background: #d4edda;
		color: #155724;
	}

	.clock {
		margin-left: auto;
		font-size: 0.8rem;
		color: #666;
	}

	.ascii-banner {
		font-size: 9px;
		line-height: 10px;
		color: #111317;
		margin: 8px 0;
		overflow-x: auto;
		font-weight: 700;
	}

	.nav-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 10px;
	}

	.tui-tab {
		background: #fafaf7;
		border: 1px solid #111317;
		padding: 6px 14px;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.1s ease;
	}

	.tui-tab:hover {
		background: #00b4d8;
		color: #000;
	}

	.tui-tab.active {
		background: #111317;
		color: #ffffff;
		box-shadow: 2px 2px 0px #ff0055;
	}

	.box-title {
		font-weight: 700;
		font-size: 0.95rem;
		margin-bottom: 12px;
		color: #111317;
	}

	.box-subtitle {
		font-weight: 700;
		font-size: 0.85rem;
		margin: 16px 0 8px 0;
		color: #444;
	}

	.release-info-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 8px;
		font-size: 0.85rem;
		background: #f4f4f0;
		padding: 10px;
		border: 1px solid #e0e0dc;
		margin-bottom: 14px;
	}

	.table-wrap {
		overflow-x: auto;
	}

	.tui-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}

	.tui-table th {
		background: #111317;
		color: #ffffff;
		text-align: left;
		padding: 8px 10px;
		border: 1px solid #111317;
		font-weight: 600;
	}

	.tui-table td {
		padding: 8px 10px;
		border: 1px solid #d0d0cc;
		background: #ffffff;
	}

	.tui-table tr:nth-child(even) td {
		background: #fafaf7;
	}

	.status-pass {
		color: #008a43;
		font-weight: 700;
	}

	.status-warn {
		color: #c4003d;
		font-weight: 700;
		animation: blink 1.5s infinite;
	}

	@keyframes blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	.callout {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px;
		border: 1px solid #111317;
		margin: 14px 0;
		font-size: 0.85rem;
	}

	.warn-callout {
		background: #fff0f3;
		border-left: 6px solid #ff0055;
	}

	.pass-callout {
		background: #edfff4;
		border-left: 6px solid #00d26a;
	}

	.tui-btn {
		background: #ffffff;
		border: 1px solid #111317;
		padding: 6px 12px;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 2px 2px 0px #111317;
	}

	.tui-btn:hover {
		transform: translate(-1px, -1px);
		box-shadow: 3px 3px 0px #111317;
	}

	.tui-btn:active {
		transform: translate(1px, 1px);
		box-shadow: 1px 1px 0px #111317;
	}

	.magenta-btn {
		background: #ff0055;
		color: #ffffff;
		margin-left: auto;
	}

	.cyan-btn {
		background: #00b4d8;
		color: #000000;
	}

	.play-btn {
		background: #00d26a;
		color: #000000;
	}

	.submit-btn {
		background: #111317;
		color: #ffffff;
		font-size: 0.95rem;
		padding: 10px 18px;
		box-shadow: 3px 3px 0px #00d26a;
	}

	.player-box {
		background: #f4f4f0;
		border: 1px solid #111317;
		padding: 14px;
		margin-top: 14px;
	}

	.player-controls {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		font-size: 0.85rem;
	}

	.ascii-progress-bar {
		font-weight: 700;
		color: #0070f3;
	}

	.bitrate {
		margin-left: auto;
		font-size: 0.75rem;
		color: #666;
	}

	.vu-meter-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 12px 0;
		font-size: 0.78rem;
	}

	.meter-bar {
		flex: 1;
		height: 12px;
		background: #ddd;
		border: 1px solid #111317;
		overflow: hidden;
	}

	.meter-bar .fill {
		height: 100%;
		background: linear-gradient(90deg, #00d26a 60%, #ff8800 80%, #ff0055 95%);
		transition: width 0.1s ease;
	}

	.stems-matrix {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 10px;
	}

	.stem-chip {
		background: #ffffff;
		border: 1px solid #111317;
		padding: 4px 10px;
		font-size: 0.75rem;
		font-family: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.stem-chip.muted {
		opacity: 0.4;
		text-decoration: line-through;
	}

	.section-desc {
		font-size: 0.85rem;
		color: #444;
		margin-top: 0;
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 14px;
		margin: 14px 0;
	}

	.label-tag {
		display: block;
		font-size: 0.78rem;
		font-weight: 700;
		margin-bottom: 4px;
	}

	.tui-input {
		width: 100%;
		padding: 8px 10px;
		font-family: inherit;
		font-size: 0.85rem;
		border: 1px solid #111317;
		background: #ffffff;
		box-sizing: border-box;
	}

	.tui-input:focus {
		outline: 2px solid #00b4d8;
	}

	.form-actions {
		margin-top: 16px;
	}

	.audit-log-terminal {
		background: #111317;
		color: #00d26a;
		padding: 12px;
		font-size: 0.8rem;
		border: 1px solid #111317;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.audit-log-terminal code {
		color: #888;
	}

	.footer-box {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: #666;
		padding: 10px 16px;
	}
</style>
