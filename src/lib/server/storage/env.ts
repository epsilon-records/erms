import {
	R2_ACCESS_KEY_ID,
	R2_ACCOUNT_ID,
	R2_MASTERS_BUCKET,
	R2_SECRET_ACCESS_KEY
} from '$app/env/private';
import { createR2Storage, type MasterStorage } from './r2';

let instance: MasterStorage | null | undefined;

/** The masters bucket, or null while R2 isn't configured (uploads are then off). */
export function masterStorage(): MasterStorage | null {
	if (instance === undefined) {
		instance =
			R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_MASTERS_BUCKET
				? createR2Storage({
						accountId: R2_ACCOUNT_ID,
						accessKeyId: R2_ACCESS_KEY_ID,
						secretAccessKey: R2_SECRET_ACCESS_KEY,
						bucket: R2_MASTERS_BUCKET
					})
				: null;
	}
	return instance;
}
