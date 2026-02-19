import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConversationItem, ConversationDetail } from '../api/types.js';

export interface BackupMetadata {
  timestamp: string;
  totalConversations: number;
  successfulDownloads: number;
  failedDownloads: number;
  errors: Array<{ conversationId: string; error: string }>;
}

export class StorageService {
  private outputDir: string;
  private conversationsDir: string;

  constructor(outputDir: string, projectName?: string) {
    this.outputDir = outputDir;
    if (projectName) {
      const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
      this.conversationsDir = path.join(outputDir, 'projects', safeName, 'conversations');
    } else {
      this.conversationsDir = path.join(outputDir, 'conversations');
    }
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.conversationsDir, { recursive: true });
  }

  async saveConversation(id: string, data: ConversationDetail): Promise<void> {
    const filePath = path.join(this.conversationsDir, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async saveIndex(conversations: ConversationItem[]): Promise<void> {
    const filePath = path.join(this.conversationsDir, 'index.json');
    await fs.writeFile(filePath, JSON.stringify(conversations, null, 2), 'utf-8');
  }

  async saveMetadata(metadata: BackupMetadata): Promise<void> {
    const filePath = path.join(this.outputDir, 'metadata.json');
    await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  async appendLog(message: string): Promise<void> {
    const filePath = path.join(this.outputDir, 'backup.log');
    const timestamp = new Date().toISOString();
    await fs.appendFile(filePath, `[${timestamp}] ${message}\n`, 'utf-8');
  }

  async conversationExists(id: string): Promise<boolean> {
    const filePath = path.join(this.conversationsDir, `${id}.json`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getExistingConversationUpdateTime(id: string): Promise<number | null> {
    const filePath = path.join(this.conversationsDir, `${id}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as ConversationDetail;
      return data.update_time ?? null;
    } catch {
      return null;
    }
  }

  getConversationPath(id: string): string {
    return path.join(this.conversationsDir, `${id}.json`);
  }
}
