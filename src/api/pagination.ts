import { ChatGPTClient } from './client.js';
import { ENDPOINTS } from './endpoints.js';
import {
  ConversationsResponseSchema,
  ConversationItem,
  type ConversationsResponse,
  ProjectsSidebarResponseSchema,
  ProjectConversationsResponseSchema,
  type SidebarItem,
  type ProjectsSidebarResponse,
  type ProjectConversationsResponse,
} from './types.js';
import { sleep } from '../utils/retry.js';

export interface PaginationOptions {
  limit?: number;
  delay?: number;
  onProgress?: (fetched: number, total: number) => void;
}

export async function* fetchAllConversations(
  client: ChatGPTClient,
  options: PaginationOptions = {}
): AsyncGenerator<ConversationItem, void, unknown> {
  const { limit = 28, delay = 500, onProgress } = options;
  let offset = 0;
  let total = Infinity;
  let fetched = 0;

  while (offset < total) {
    const response = await client.fetch<ConversationsResponse>(
      `${ENDPOINTS.CONVERSATIONS}?offset=${offset}&limit=${limit}&order=updated`,
      {
        parseResponse: (data) => ConversationsResponseSchema.parse(data),
      }
    );

    total = response.total;

    for (const item of response.items) {
      yield item;
      fetched++;
    }

    onProgress?.(fetched, total);

    offset += limit;

    if (offset < total && delay > 0) {
      await sleep(delay);
    }
  }
}

export async function countConversations(client: ChatGPTClient): Promise<number> {
  const response = await client.fetch<ConversationsResponse>(
    `${ENDPOINTS.CONVERSATIONS}?offset=0&limit=1`,
    {
      parseResponse: (data) => ConversationsResponseSchema.parse(data),
    }
  );
  return response.total;
}

export async function fetchAllProjects(
  client: ChatGPTClient,
  options: { delay?: number } = {}
): Promise<SidebarItem[]> {
  const { delay = 500 } = options;
  const allItems: SidebarItem[] = [];
  let cursor: string | null | undefined = null;

  do {
    const url = cursor
      ? `${ENDPOINTS.PROJECTS_SIDEBAR}?cursor=${encodeURIComponent(cursor)}`
      : ENDPOINTS.PROJECTS_SIDEBAR;

    const response = await client.fetch<ProjectsSidebarResponse>(url, {
      parseResponse: (data) => ProjectsSidebarResponseSchema.parse(data),
    });

    allItems.push(...response.items);
    cursor = response.cursor;

    if (cursor && delay > 0) {
      await sleep(delay);
    }
  } while (cursor);

  return allItems;
}

export async function* fetchProjectConversations(
  client: ChatGPTClient,
  gizmoId: string,
  options: PaginationOptions = {}
): AsyncGenerator<ConversationItem, void, unknown> {
  const { delay = 500, onProgress } = options;
  let cursor: string | null | undefined = '0';
  let fetched = 0;

  while (cursor !== null && cursor !== undefined) {
    const url = `${ENDPOINTS.PROJECT_CONVERSATIONS(gizmoId)}?cursor=${encodeURIComponent(cursor)}`;

    const response = await client.fetch<ProjectConversationsResponse>(url, {
      parseResponse: (data) => ProjectConversationsResponseSchema.parse(data),
    });

    for (const item of response.items) {
      yield item;
      fetched++;
    }

    cursor = response.cursor;
    onProgress?.(fetched, fetched);

    if (cursor && delay > 0) {
      await sleep(delay);
    }
  }
}
