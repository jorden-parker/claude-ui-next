'use server';

import { revalidatePath } from 'next/cache';
import { setDeniedTools, type WriteResult } from '@/lib/claude/settings-writer';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export async function updateDeniedTools(add: string[], remove: string[]): Promise<WriteResult> {
  // Every export here is a public POST endpoint — guard at the boundary too.
  if (!isStringArray(add) || !isStringArray(remove)) return { ok: false, error: 'Invalid request.' };
  const result = await setDeniedTools(add, remove);
  if (result.ok) revalidatePath('/global/tools');
  return result;
}
