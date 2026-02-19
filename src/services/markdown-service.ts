import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConversationDetail } from '../api/types.js';

interface MappingNode {
  id: string;
  message?: {
    id: string;
    author: { role: string };
    content?: {
      content_type: string;
      parts?: unknown[];
      text?: string;
    };
    weight?: number;
    metadata?: Record<string, unknown>;
  } | null;
  parent?: string | null;
  children?: string[];
}

export function extractTextFromParts(parts: unknown[]): string {
  const pieces: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      pieces.push(part);
    } else if (part && typeof part === 'object') {
      const obj = part as Record<string, unknown>;
      if (obj.content_type === 'image_asset_pointer') {
        const pointer = obj.asset_pointer as string | undefined;
        pieces.push(`![image](${pointer ?? 'unknown'})`);
      }
    }
  }
  return pieces.join('\n');
}

function getLinearThread(mapping: Record<string, MappingNode>, currentNode?: string | null): MappingNode[] {
  // If we have current_node, walk backwards to find the active path, then output in order
  if (currentNode && mapping[currentNode]) {
    const path: MappingNode[] = [];
    let nodeId: string | null | undefined = currentNode;
    while (nodeId && mapping[nodeId]) {
      path.unshift(mapping[nodeId]);
      nodeId = mapping[nodeId].parent;
    }
    return path;
  }

  // Fallback: find root and follow children[0]
  let root: MappingNode | undefined;
  for (const node of Object.values(mapping)) {
    if (node.parent === null || node.parent === undefined) {
      root = node;
      break;
    }
  }
  if (!root) return [];

  const thread: MappingNode[] = [root];
  let current = root;
  while (current.children && current.children.length > 0) {
    const nextId = current.children[0];
    const next = mapping[nextId];
    if (!next) break;
    thread.push(next);
    current = next;
  }
  return thread;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toISOString().split('T')[0];
}

function formatRole(role: string): string {
  switch (role) {
    case 'user': return 'User';
    case 'assistant': return 'Assistant';
    default: return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

export function convertConversation(detail: ConversationDetail): string {
  const lines: string[] = [];

  // Title
  const title = detail.title ?? 'Untitled';
  lines.push(`# ${title}`);

  // Date
  if (detail.create_time) {
    lines.push(`*${formatDate(detail.create_time)}*`);
  }

  const thread = getLinearThread(
    detail.mapping as unknown as Record<string, MappingNode>,
    detail.current_node,
  );

  let firstMessage = true;
  for (const node of thread) {
    const msg = node.message;
    if (!msg) continue;

    const role = msg.author.role;

    // Skip system and tool messages
    if (role === 'system' || role === 'tool') continue;

    // Skip hidden messages
    if (msg.metadata?.is_visually_hidden_from_conversation) continue;

    // Skip weight: 0 scaffolding
    if (msg.weight === 0) continue;

    // Extract text content
    let text = '';
    if (msg.content) {
      if (msg.content.parts && msg.content.parts.length > 0) {
        text = extractTextFromParts(msg.content.parts);
      } else if (msg.content.text) {
        text = msg.content.text;
      }
    }

    // Skip empty messages (e.g. model_editable_context with no useful text)
    if (!text.trim()) continue;

    // Separator between messages
    if (firstMessage) {
      lines.push('');
      firstMessage = false;
    } else {
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    lines.push(`**${formatRole(role)}:**`);
    lines.push('');
    lines.push(text);
  }

  lines.push('');
  return lines.join('\n');
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
    // Directory doesn't exist, return empty
  }
  return files;
}

async function collectAllJsonFiles(inputDir: string): Promise<string[]> {
  const files: string[] = [];

  // Main conversations
  const mainDir = path.join(inputDir, 'conversations');
  files.push(...await findJsonFiles(mainDir));

  // Project conversations
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

export async function convertDirectory(inputDir: string): Promise<{ converted: number; errors: number }> {
  const jsonFiles = await collectAllJsonFiles(inputDir);

  let converted = 0;
  let errors = 0;

  for (const jsonPath of jsonFiles) {
    try {
      const raw = await fs.readFile(jsonPath, 'utf-8');
      const detail = JSON.parse(raw) as ConversationDetail;
      const markdown = convertConversation(detail);
      const mdPath = jsonPath.replace(/\.json$/, '.md');
      await fs.writeFile(mdPath, markdown, 'utf-8');
      converted++;
    } catch {
      errors++;
    }
  }

  return { converted, errors };
}
