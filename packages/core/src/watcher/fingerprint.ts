import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export type FingerprintMap = Record<string, string>;

export async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex');
}

export async function loadFingerprints(cacheDir: string): Promise<FingerprintMap> {
  const file = path.join(cacheDir, 'fingerprints.json');
  try {
    const content = await readFile(file, 'utf-8');
    return JSON.parse(content) as FingerprintMap;
  } catch {
    return {};
  }
}

export async function saveFingerprints(cacheDir: string, map: FingerprintMap): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, 'fingerprints.json');
  await writeFile(file, JSON.stringify(map, null, 2), 'utf-8');
}

export async function getChangedFiles(
  files: string[],
  cacheDir: string,
): Promise<{ changed: string[]; unchanged: string[]; updatedMap: FingerprintMap }> {
  const fingerprints = await loadFingerprints(cacheDir);
  const changed: string[] = [];
  const unchanged: string[] = [];
  const updatedMap: FingerprintMap = { ...fingerprints };

  for (const file of files) {
    try {
      const hash = await computeFileHash(file);
      if (fingerprints[file] === hash) {
        unchanged.push(file);
      } else {
        changed.push(file);
        updatedMap[file] = hash;
      }
    } catch {
      // file deleted or unreadable — treat as changed
      changed.push(file);
      delete updatedMap[file];
    }
  }

  return { changed, unchanged, updatedMap };
}
