import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SoundDb, SoundRow } from './sound-db';
import { getSetting, setSetting } from './database';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStoreUrl(): string {
  return getSetting('storeServerUrl') || 'http://localhost:9090';
}

function getUploaderToken(): string {
  let token = getSetting('storeUploaderToken');
  if (!token) {
    token = crypto.randomUUID();
    setSetting('storeUploaderToken', token);
  }
  return token;
}

// ── Sync functions ───────────────────────────────────────────────────────────

/**
 * Publish a local category to the store server.
 * Creates the category on the server, then uploads all sounds.
 */
export async function syncCategoryToStore(soundDb: SoundDb, categoryName: string): Promise<void> {
  const storeUrl = getStoreUrl();
  const token = getUploaderToken();

  const cat = soundDb.getCategoryByName(categoryName);
  if (!cat) throw new Error(`Category "${categoryName}" not found`);

  let storeId = soundDb.getCategoryStoreId(categoryName);

  // Create category on store if no storeId
  if (!storeId) {
    const body: Record<string, unknown> = {
      name: cat.name,
      uploader_name: '',
      icon: cat.icon,
      icon_is_base64: cat.icon_is_base64 === 1,
    };

    const res = await fetch(`${storeUrl}/api/categories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uploader-Token': token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Failed to create store category: ${(err as any).error || res.statusText}`);
    }

    const data = await res.json() as { id: number };
    storeId = data.id;
    soundDb.setCategoryStoreId(categoryName, storeId);
  }

  // Use sync endpoint to push full state
  await syncCategoryChanges(soundDb, categoryName);
}

/**
 * Remove a category from the store server.
 */
export async function removeCategoryFromStore(soundDb: SoundDb, categoryName: string): Promise<void> {
  const storeUrl = getStoreUrl();
  const token = getUploaderToken();

  const storeId = soundDb.getCategoryStoreId(categoryName);
  if (!storeId) return; // not on store, nothing to do

  try {
    const res = await fetch(`${storeUrl}/api/categories/${storeId}`, {
      method: 'DELETE',
      headers: { 'X-Uploader-Token': token },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok && res.status !== 404) {
      console.warn(`[store-sync] Failed to delete category from store: ${res.statusText}`);
    }
  } catch (err) {
    console.warn(`[store-sync] Failed to reach store server for deletion:`, err);
  }

  soundDb.setCategoryStoreId(categoryName, null);
}

/**
 * Sync the current state of a public category to the store server.
 * Posts the full category metadata + sound list to the /sync endpoint.
 * Also uploads any sound files the server doesn't have.
 */
export async function syncCategoryChanges(soundDb: SoundDb, categoryName: string): Promise<void> {
  const storeUrl = getStoreUrl();
  const token = getUploaderToken();

  const cat = soundDb.getCategoryByName(categoryName);
  if (!cat) return;
  if (cat.visibility !== 'public') return;

  const storeId = soundDb.getCategoryStoreId(categoryName);
  if (!storeId) {
    // Category not yet on store, do full publish
    await syncCategoryToStore(soundDb, categoryName);
    return;
  }

  const sounds = soundDb.getSoundsByCategory(cat.id);

  // Deduplicate sounds by title within the category — keep the first occurrence
  const seenTitles = new Set<string>();
  const uniqueSounds = sounds.filter(s => {
    const key = s.title.toLowerCase();
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  // Build sync payload — flat structure matching the /sync route expectations
  const syncPayload = {
    name: cat.name,
    icon: cat.icon,
    icon_is_base64: cat.icon_is_base64 === 1 ? 1 : 0,
    sounds: uniqueSounds.map(s => ({
      title: s.title,
      file_name: s.file_name,
      artist: s.artist,
      duration_ms: s.duration_ms,
      sort_order: s.sort_order,
      icon: s.icon,
      icon_is_base64: s.icon_is_base64 === 1 ? 1 : 0,
      hide_title: s.hide_title === 1 ? 1 : 0,
    })),
  };

  try {
    const res = await fetch(`${storeUrl}/api/categories/${storeId}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uploader-Token': token,
      },
      body: JSON.stringify(syncPayload),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      console.warn(`[store-sync] Sync failed:`, (err as any).error || res.statusText);
      return;
    }

    const result = await res.json() as { added: number; deleted: number; updated: number; missingFiles?: string[] };

    // Upload any sound files the server reports as missing
    if (result.missingFiles && result.missingFiles.length > 0) {
      for (const fileName of result.missingFiles) {
        const filePath = path.join(soundDb.getSoundsDir(), fileName);
        if (!fs.existsSync(filePath)) continue;

        await uploadSoundFile(storeUrl, storeId, filePath, fileName, uniqueSounds, token);
      }
    }
  } catch (err) {
    console.warn(`[store-sync] Failed to sync category "${categoryName}":`, err);
  }
}

/**
 * Upload a single sound file to the store server.
 */
async function uploadSoundFile(
  storeUrl: string,
  categoryId: number,
  filePath: string,
  fileName: string,
  sounds: SoundRow[],
  token: string
): Promise<void> {
  const sound = sounds.find(s => s.file_name === fileName);
  if (!sound) return;

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer]);

    const formData = new FormData();
    const file = new File([blob], fileName);
    formData.append('soundFile', file);
    formData.append('title', sound.title);
    formData.append('artist', sound.artist);
    formData.append('duration_ms', String(sound.duration_ms));
    formData.append('sort_order', String(sound.sort_order));
    formData.append('icon', sound.icon || '');
    formData.append('icon_is_base64', sound.icon_is_base64 ? '1' : '0');
    formData.append('hide_title', sound.hide_title ? '1' : '0');

    const res = await fetch(`${storeUrl}/api/categories/${categoryId}/sounds`, {
      method: 'POST',
      headers: { 'X-Uploader-Token': token },
      body: formData,
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      console.warn(`[store-sync] Failed to upload sound "${fileName}": ${res.statusText}`);
    }
  } catch (err) {
    console.warn(`[store-sync] Failed to upload sound "${fileName}":`, err);
  }
}

/**
 * Trigger a sync if a category is public. Called as a post-operation hook.
 * Fails gracefully if the store server is unreachable.
 */
export function trySyncIfPublic(soundDb: SoundDb, categoryName: string): void {
  try {
    const visibility = soundDb.getCategoryVisibility(categoryName);
    if (visibility !== 'public') return;

    // Fire and forget - don't block the caller
    syncCategoryChanges(soundDb, categoryName).catch(err => {
      console.warn(`[store-sync] Background sync failed for "${categoryName}":`, err);
    });
  } catch {
    // Category may not exist or other error - silently ignore
  }
}
