/**
 * Rules for master uploads shared by the browser and the server. The server re-checks
 * everything; the browser checks first so a wrong file fails before any upload starts.
 */

const MiB = 1024 * 1024;

/** WAV's RIFF header stores the size in 32 bits, so a plain WAV can't be larger. */
export const MAX_MASTER_BYTES = 4 * 1024 * MiB;
/** Files above this go up as a multipart upload. */
export const MULTIPART_THRESHOLD = 100 * MiB;
/** Every part but the last is exactly this size (R2 needs equal parts, at least 5 MiB). */
export const PART_SIZE = 64 * MiB;

/** Content types browsers report for WAV. Some report none, which is allowed. */
export const WAV_CONTENT_TYPES = ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'];

export const partCount = (size: number) => Math.ceil(size / PART_SIZE);

/** Why a file can't be uploaded as a master, or null if it can. */
export function wavProblem(file: { name: string; size: number; type: string }): string | null {
	if (!/\.wav$/i.test(file.name)) return 'Masters must be WAV files (.wav).';
	if (file.type && !WAV_CONTENT_TYPES.includes(file.type.toLowerCase())) {
		return `This file is ${file.type}, not WAV.`;
	}
	if (!Number.isSafeInteger(file.size) || file.size <= 0) return 'The file is empty.';
	if (file.size > MAX_MASTER_BYTES) return 'WAV files can be at most 4 GiB.';
	return null;
}

/** Bytes needed to recognise a WAV header. */
export const WAV_HEADER_BYTES = 12;

/** RIFF (or RF64/BW64 for broadcast WAV) container holding WAVE data. */
export function isWavHeader(bytes: Uint8Array) {
	if (bytes.length < WAV_HEADER_BYTES) return false;
	const tag = (from: number) => String.fromCharCode(...bytes.slice(from, from + 4));
	return ['RIFF', 'RF64', 'BW64'].includes(tag(0)) && tag(8) === 'WAVE';
}
