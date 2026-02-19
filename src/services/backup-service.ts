import { ChatGPTClient } from '../api/client.js';
import { ENDPOINTS } from '../api/endpoints.js';
import { fetchAllConversations, countConversations, fetchAllProjects, fetchProjectConversations } from '../api/pagination.js';
import {
  ConversationDetailSchema,
  type ConversationItem,
  type ConversationDetail,
  type SidebarItem,
} from '../api/types.js';
import { StorageService, type BackupMetadata } from './storage-service.js';
import { sleep } from '../utils/retry.js';

export interface BackupOptions {
  concurrency: number;
  delay: number;
  incremental: boolean;
  verbose: boolean;
  projectGizmoId?: string;
  onListProgress?: (fetched: number, total: number) => void;
  onDownloadProgress?: (completed: number, total: number, current?: string) => void;
  onError?: (id: string, error: Error) => void;
}

export interface BackupResult {
  totalConversations: number;
  downloaded: number;
  skipped: number;
  failed: number;
  errors: Array<{ conversationId: string; error: string }>;
}

export class BackupService {
  private client: ChatGPTClient;
  private storage: StorageService;

  constructor(client: ChatGPTClient, storage: StorageService) {
    this.client = client;
    this.storage = storage;
  }

  async listConversations(options: Pick<BackupOptions, 'delay' | 'onListProgress'>): Promise<ConversationItem[]> {
    const conversations: ConversationItem[] = [];

    for await (const conversation of fetchAllConversations(this.client, {
      delay: options.delay,
      onProgress: options.onListProgress,
    })) {
      conversations.push(conversation);
    }

    return conversations;
  }

  async getConversationCount(): Promise<number> {
    return countConversations(this.client);
  }

  async listProjects(): Promise<SidebarItem[]> {
    return fetchAllProjects(this.client);
  }

  async listProjectConversations(
    gizmoId: string,
    options: Pick<BackupOptions, 'delay' | 'onListProgress'> = {}
  ): Promise<ConversationItem[]> {
    const conversations: ConversationItem[] = [];

    for await (const conversation of fetchProjectConversations(this.client, gizmoId, {
      delay: options.delay,
      onProgress: options.onListProgress,
    })) {
      conversations.push(conversation);
    }

    return conversations;
  }

  async resolveProjectId(nameOrId: string): Promise<{ gizmoId: string; name: string }> {
    const projects = await this.listProjects();
    const match = projects.find(
      (p) =>
        p.gizmo.id === nameOrId ||
        p.gizmo.display.name.toLowerCase() === nameOrId.toLowerCase()
    );
    if (!match) {
      const available = projects.map((p) => p.gizmo.display.name).join(', ');
      throw new Error(
        `Project "${nameOrId}" not found. Available projects: ${available || '(none)'}`
      );
    }
    return { gizmoId: match.gizmo.id, name: match.gizmo.display.name };
  }

  async downloadConversation(id: string): Promise<ConversationDetail> {
    return this.client.fetch<ConversationDetail>(ENDPOINTS.CONVERSATION(id), {
      parseResponse: (data) => ConversationDetailSchema.parse(data),
    });
  }

  async backup(options: BackupOptions): Promise<BackupResult> {
    const {
      concurrency,
      delay,
      incremental,
      verbose,
      projectGizmoId,
      onListProgress,
      onDownloadProgress,
      onError,
    } = options;

    await this.storage.initialize();
    await this.storage.appendLog('Starting backup...');

    const conversations = projectGizmoId
      ? await this.listProjectConversations(projectGizmoId, { delay, onListProgress })
      : await this.listConversations({ delay, onListProgress });
    await this.storage.saveIndex(conversations);

    const errors: Array<{ conversationId: string; error: string }> = [];
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    let completed = 0;

    const toDownload: ConversationItem[] = [];

    for (const conv of conversations) {
      if (incremental) {
        const existingUpdateTime = await this.storage.getExistingConversationUpdateTime(conv.id);
        const convUpdateTime = typeof conv.update_time === 'number'
          ? conv.update_time
          : conv.update_time
            ? new Date(conv.update_time).getTime() / 1000
            : null;

        if (existingUpdateTime !== null && convUpdateTime !== null && existingUpdateTime >= convUpdateTime) {
          skipped++;
          completed++;
          onDownloadProgress?.(completed, conversations.length, conv.title ?? conv.id);
          continue;
        }
      }
      toDownload.push(conv);
    }

    const downloadQueue = [...toDownload];
    const inProgress = new Set<Promise<void>>();

    const processOne = async (conv: ConversationItem): Promise<void> => {
      try {
        const detail = await this.downloadConversation(conv.id);
        await this.storage.saveConversation(conv.id, detail);
        downloaded++;

        if (verbose) {
          await this.storage.appendLog(`Downloaded: ${conv.id} - ${conv.title ?? 'Untitled'}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ conversationId: conv.id, error: errorMessage });
        failed++;
        onError?.(conv.id, error as Error);
        await this.storage.appendLog(`Failed: ${conv.id} - ${errorMessage}`);
      } finally {
        completed++;
        onDownloadProgress?.(completed, conversations.length, conv.title ?? conv.id);
      }
    };

    while (downloadQueue.length > 0 || inProgress.size > 0) {
      while (inProgress.size < concurrency && downloadQueue.length > 0) {
        const conv = downloadQueue.shift()!;
        const promise = processOne(conv).then(() => {
          inProgress.delete(promise);
        });
        inProgress.add(promise);

        if (downloadQueue.length > 0 && delay > 0) {
          await sleep(delay);
        }
      }

      if (inProgress.size > 0) {
        await Promise.race(inProgress);
      }
    }

    const metadata: BackupMetadata = {
      timestamp: new Date().toISOString(),
      totalConversations: conversations.length,
      successfulDownloads: downloaded,
      failedDownloads: failed,
      errors,
    };

    await this.storage.saveMetadata(metadata);
    await this.storage.appendLog(`Backup completed: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed`);

    return {
      totalConversations: conversations.length,
      downloaded,
      skipped,
      failed,
      errors,
    };
  }
}
