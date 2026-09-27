import fs from 'node:fs/promises';

const MISSING = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM']);

// Missing or unreadable directories are simply empty: a provider may not be installed.
export async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (MISSING.has(error?.code)) return [];
    throw error;
  }
}

export async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function statOrNull(file) {
  try {
    return await fs.stat(file);
  } catch (error) {
    if (MISSING.has(error?.code)) return null;
    throw error;
  }
}
