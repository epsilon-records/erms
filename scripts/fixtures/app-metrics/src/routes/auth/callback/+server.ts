import { redirect } from '@sveltejs/kit';
export const GET = () => redirect(303, '/?signed-in');
