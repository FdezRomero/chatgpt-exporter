import { z } from 'zod';

export const SessionSchema = z.looseObject({
  accessToken: z.string(),
  user: z.looseObject({
    id: z.string(),
    name: z.string().optional(),
    email: z.string().optional(),
    image: z.string().optional(),
  }).optional(),
  expires: z.string().optional(),
});

export type Session = z.infer<typeof SessionSchema>;

export const ConversationItemSchema = z.looseObject({
  id: z.string(),
  title: z.string().nullable(),
  create_time: z.string().or(z.number()).nullable(),
  update_time: z.string().or(z.number()).nullable(),
  mapping: z.record(z.string(), z.unknown()).nullable().optional(),
  current_node: z.string().nullable().optional(),
  conversation_template_id: z.string().nullable().optional(),
  gizmo_id: z.string().nullable().optional(),
  is_archived: z.boolean().optional(),
  workspace_id: z.string().nullable().optional(),
});

export type ConversationItem = z.infer<typeof ConversationItemSchema>;

export const ConversationsResponseSchema = z.looseObject({
  items: z.array(ConversationItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  has_missing_conversations: z.boolean().optional(),
});

export type ConversationsResponse = z.infer<typeof ConversationsResponseSchema>;

export const MessageContentSchema = z.looseObject({
  content_type: z.string(),
  parts: z.array(z.unknown()).optional(),
  text: z.string().optional(),
});

export const MessageSchema = z.looseObject({
  id: z.string(),
  author: z.looseObject({
    role: z.string(),
    name: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  create_time: z.number().nullable().optional(),
  update_time: z.number().nullable().optional(),
  content: MessageContentSchema.optional(),
  status: z.string().optional(),
  end_turn: z.boolean().nullable().optional(),
  weight: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  recipient: z.string().optional(),
});

export const MappingNodeSchema = z.looseObject({
  id: z.string(),
  message: MessageSchema.nullable().optional(),
  parent: z.string().nullable().optional(),
  children: z.array(z.string()).optional(),
});

export const ConversationDetailSchema = z.looseObject({
  id: z.string().optional(),
  title: z.string().nullable(),
  create_time: z.number().nullable(),
  update_time: z.number().nullable(),
  mapping: z.record(z.string(), MappingNodeSchema),
  moderation_results: z.array(z.unknown()).optional(),
  current_node: z.string().nullable().optional(),
  conversation_id: z.string().optional(),
  is_archived: z.boolean().optional(),
});

export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

// Project (snorlax gizmo) types

export const ProjectGizmoSchema = z.looseObject({
  id: z.string(),
  display: z.looseObject({
    name: z.string(),
    theme: z.unknown().optional(),
  }),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  last_interacted_at: z.string().nullable().optional(),
  num_interactions: z.number().optional(),
  is_archived: z.boolean().optional(),
  gizmo_type: z.string().optional(),
});

export type ProjectGizmo = z.infer<typeof ProjectGizmoSchema>;

export const SidebarItemSchema = z.looseObject({
  gizmo: ProjectGizmoSchema,
});

export type SidebarItem = z.infer<typeof SidebarItemSchema>;

export const ProjectsSidebarResponseSchema = z.looseObject({
  items: z.array(SidebarItemSchema),
  cursor: z.string().nullable().optional(),
});

export type ProjectsSidebarResponse = z.infer<typeof ProjectsSidebarResponseSchema>;

export const ProjectConversationsResponseSchema = z.looseObject({
  items: z.array(ConversationItemSchema),
  cursor: z.string().nullable().optional(),
});

export type ProjectConversationsResponse = z.infer<typeof ProjectConversationsResponseSchema>;

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends Error {
  retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class NetworkError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
  }
}
