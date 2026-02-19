export const BASE_URL = 'https://chatgpt.com';

export const ENDPOINTS = {
  SESSION: '/api/auth/session',
  CONVERSATIONS: '/backend-api/conversations',
  CONVERSATION: (id: string) => `/backend-api/conversation/${id}`,
  PROJECTS_SIDEBAR: '/backend-api/gizmos/snorlax/sidebar',
  PROJECT_CONVERSATIONS: (gizmoId: string) => `/backend-api/gizmos/${gizmoId}/conversations`,
} as const;
