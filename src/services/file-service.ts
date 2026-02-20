import fs from 'node:fs/promises';
import path from 'node:path';
import { ChatGPTClient } from '../api/client.js';
import { ENDPOINTS } from '../api/endpoints.js';
import {
  type FileReference,
  type ConversationDetail,
} from '../api/types.js';
import { sleep } from '../utils/retry.js';

export interface FileDownloadStats {
  downloaded: number;
  skipped: number;
  failed: number;
}

export interface FileDownloadOptions {
  concurrency: number;
  delay: number;
  verbose: boolean;
  skipFileIds?: Set<string>;
  onProgress?: (completed: number, total: number, stats: FileDownloadStats) => void;
  onError?: (fileId: string, error: Error) => void;
}

export interface FileDownloadResult {
  downloaded: number;
  skipped: number;
  failed: number;
  total: number;
  failedFileIds: string[];
}

const FILE_SERVICE_PREFIX = 'file-service://';

function extractFileIdFromPointer(pointer: string): string | null {
  if (!pointer.startsWith(FILE_SERVICE_PREFIX)) return null;
  return pointer.slice(FILE_SERVICE_PREFIX.length);
}

export function extractFileReferences(detail: ConversationDetail): FileReference[] {
  const refs = new Map<string, FileReference>();

  for (const node of Object.values(detail.mapping)) {
    const msg = node.message;
    if (!msg) continue;

    // 1. image_asset_pointer in content.parts[]
    if (msg.content?.parts) {
      for (const part of msg.content.parts) {
        if (part && typeof part === 'object') {
          const obj = part as Record<string, unknown>;
          if (obj.content_type === 'image_asset_pointer') {
            const pointer = obj.asset_pointer as string | undefined;
            if (pointer) {
              const fileId = extractFileIdFromPointer(pointer);
              if (fileId && !refs.has(fileId)) {
                refs.set(fileId, { fileId, source: 'image_asset_pointer' });
              }
            }
          }
        }
      }
    }

    // 2. attachments[] in message metadata
    const metadata = msg.metadata as Record<string, unknown> | undefined;
    if (metadata?.attachments && Array.isArray(metadata.attachments)) {
      for (const att of metadata.attachments) {
        const a = att as Record<string, unknown>;
        const id = a.id as string | undefined;
        if (id && !refs.has(id)) {
          refs.set(id, {
            fileId: id,
            filename: a.name as string | undefined,
            source: 'attachment',
          });
        }
      }
    }

    // 3. citations[] in message metadata
    if (metadata?.citations && Array.isArray(metadata.citations)) {
      for (const cit of metadata.citations) {
        const c = cit as Record<string, unknown>;
        const metadata2 = c.metadata as Record<string, unknown> | undefined;
        const fileId = (metadata2?.file_id ?? c.file_id) as string | undefined;
        if (fileId && !refs.has(fileId)) {
          refs.set(fileId, {
            fileId,
            filename: (metadata2?.title ?? c.title) as string | undefined,
            source: 'citation',
          });
        }
      }
    }
  }

  return Array.from(refs.values());
}

export async function scanAllConversations(inputDir: string): Promise<FileReference[]> {
  const refs = new Map<string, FileReference>();

  const jsonFiles = await collectAllJsonFiles(inputDir);
  for (const jsonPath of jsonFiles) {
    try {
      const raw = await fs.readFile(jsonPath, 'utf-8');
      const detail = JSON.parse(raw) as ConversationDetail;
      for (const ref of extractFileReferences(detail)) {
        if (!refs.has(ref.fileId)) {
          refs.set(ref.fileId, ref);
        }
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  return Array.from(refs.values());
}

async function findJsonFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json') {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return files;
}

async function collectAllJsonFiles(inputDir: string): Promise<string[]> {
  const files: string[] = [];

  const mainDir = path.join(inputDir, 'conversations');
  files.push(...await findJsonFiles(mainDir));

  const projectsDir = path.join(inputDir, 'projects');
  try {
    const projectEntries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const entry of projectEntries) {
      if (entry.isDirectory()) {
        const projectConvDir = path.join(projectsDir, entry.name, 'conversations');
        files.push(...await findJsonFiles(projectConvDir));
      }
    }
  } catch {
    // No projects directory
  }

  return files;
}

async function dirHasFiles(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) return true;
      if (entry.isDirectory()) {
        if (await dirHasFiles(path.join(dir, entry.name))) return true;
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return false;
}

export async function downloadFiles(
  client: ChatGPTClient,
  allRefs: FileReference[],
  outputDir: string,
  options: FileDownloadOptions,
): Promise<FileDownloadResult> {
  const { concurrency, delay, verbose, skipFileIds, onProgress, onError } = options;

  const filesDir = path.join(outputDir, 'files');

  // Filter out previously failed files
  const refs = skipFileIds && skipFileIds.size > 0
    ? allRefs.filter(ref => !skipFileIds.has(ref.fileId))
    : allRefs;

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let completed = 0;
  const failedFileIds: string[] = [];

  const queue = [...refs];
  const inProgress = new Set<Promise<void>>();

  const reportProgress = () => {
    completed++;
    onProgress?.(completed, refs.length, { downloaded, skipped, failed });
  };

  const processOne = async (ref: FileReference): Promise<void> => {
    const fileDir = path.join(filesDir, ref.fileId);

    // Check if already downloaded (walk into subdirs since filenames can contain paths)
    if (await dirHasFiles(fileDir)) {
      skipped++;
      reportProgress();
      return;
    }

    try {
      // Step 1: Get download URL (1 retry — if the file is gone, retrying won't help)
      const meta = await client.fetch<Record<string, unknown>>(ENDPOINTS.FILE_DOWNLOAD(ref.fileId), {
        retryOptions: { maxRetries: 1 },
      });

      if (!meta.download_url) {
        throw new Error('File not available');
      }

      // Step 2: Download the actual file from signed URL (1 retry)
      const buffer = await client.fetchRaw(meta.download_url as string, { maxRetries: 1 });

      // Only create the directory once we have the file data
      // file_name can contain subdirs (e.g. "dalle-generations/uuid.w"), so mkdir the full parent
      const filename = (meta.file_name as string) || ref.filename || ref.fileId;
      const filePath = path.join(fileDir, filename);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, Buffer.from(buffer));

      downloaded++;
      if (verbose) {
        console.log(`  Downloaded file: ${ref.fileId} → ${filename}`);
      }
    } catch (error) {
      failed++;
      failedFileIds.push(ref.fileId);
      onError?.(ref.fileId, error as Error);
    } finally {
      reportProgress();
    }
  };

  while (queue.length > 0 || inProgress.size > 0) {
    while (inProgress.size < concurrency && queue.length > 0) {
      const ref = queue.shift()!;
      const promise = processOne(ref).then(() => {
        inProgress.delete(promise);
      });
      inProgress.add(promise);

      if (queue.length > 0 && delay > 0) {
        await sleep(delay);
      }
    }

    if (inProgress.size > 0) {
      await Promise.race(inProgress);
    }
  }

  return { downloaded, skipped, failed, total: refs.length, failedFileIds };
}

async function findFirstFile(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) return entry.name;
      if (entry.isDirectory()) {
        const nested = await findFirstFile(path.join(dir, entry.name));
        if (nested) return path.join(entry.name, nested);
      }
    }
  } catch {
    // Skip unreadable dirs
  }
  return null;
}

export async function buildFileMap(filesDir: string): Promise<Map<string, string>> {
  const fileMap = new Map<string, string>();

  try {
    const fileIdDirs = await fs.readdir(filesDir, { withFileTypes: true });
    for (const entry of fileIdDirs) {
      if (!entry.isDirectory()) continue;
      const fileId = entry.name;
      const dirPath = path.join(filesDir, fileId);
      const relFile = await findFirstFile(dirPath);
      if (relFile) {
        fileMap.set(fileId, path.join('files', fileId, relFile));
      }
    }
  } catch {
    // files/ directory doesn't exist
  }

  return fileMap;
}
