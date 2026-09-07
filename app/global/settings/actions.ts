'use server';

import { revalidatePath } from 'next/cache';
import { setSettingValue, type SetResult } from '@/lib/claude/settings-writer';

function isPath(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v.length > 0);
}

/** `value === null` on the wire means "delete" (undefined does not survive serialisation).
 * Safe because exactly one schema key accepts `null` as a real value
 * (`teammateDefaultModel`, `type: ["string","null"]`, where `null` means "no default")
 * and deleting that key has the same effect, so the sentinel is harmless there. */
export async function updateSetting(path: string[], value: unknown): Promise<SetResult> {
  if (!isPath(path)) return { ok: false, error: 'Invalid request.' };
  const result = await setSettingValue(path, value === null ? undefined : value);
  if (result.ok) revalidatePath('/global/settings');
  return result;
}
