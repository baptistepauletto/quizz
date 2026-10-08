import fs from 'node:fs';
import path from 'node:path';

/** Photos for sprint questions. Paths in drafts are relative to this folder. */
export const PICTURES_DIR = path.resolve(process.env.PICTURES_DIR ?? 'pictures');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/**
 * A draft image path: forward slashes, no `.` or `..` segments, image extension.
 * Returns the normalised relative path, or null when it is not safe.
 */
export function normalizeImagePath(raw: string): string | null {
  const cleaned = raw.replace(/\\/g, '/').trim().replace(/^\/+/, '');
  if (!cleaned) return null;
  const parts = cleaned.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;
  const ext = path.extname(cleaned).toLowerCase();
  if (!IMAGE_EXT.has(ext)) return null;
  return parts.join('/');
}

export function imageFileExists(rel: string): boolean {
  return resolvePicture(rel) !== null;
}

/** Absolute file for a `/media/...` URL path, or null if it escapes the folder or is missing. */
export function resolvePicture(urlPath: string): string | null {
  let rel = urlPath;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const normal = normalizeImagePath(rel);
  if (!normal) return null;
  const root = path.resolve(PICTURES_DIR);
  const abs = path.resolve(root, normal);
  const relative = path.relative(root, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}

export function pictureType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** URL the TV and the host use. Phones never receive this. */
export function mediaUrl(rel: string): string {
  return '/media/' + rel.split('/').map((part) => encodeURIComponent(part)).join('/');
}
