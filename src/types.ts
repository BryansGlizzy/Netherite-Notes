import { SimulationNodeDatum, SimulationLinkDatum } from 'd3';

export interface User {
  id: string;
  username: string;
  email?: string | null;
  groupIds: string[];
  token?: string;
  isAdmin?: boolean;
  emailVerified?: boolean;
  aiEndpoint?: string;
  hasAiApiKey?: boolean; // the key itself is only fetched on demand (see fetchAiConfig)
  aiModel?: string;
  keybindSplitBlock?: string;
  keybindNewLine?: string;
}

export interface Group {
  id: string; // Random string (the share code)
  name: string;
  ownerId: string;
  memberCount?: number;
  joinCode?: string; // owner only
  joinEnabled?: boolean; // owner only
}

export interface Note {
  id: string;
  groupId: string;
  title: string;
  content: string; // Markdown
  createdAt: number;
  updatedAt: number;
  isBookmarked?: boolean;
}

export interface ActiveUser {
  userId: string;
  username: string;
  noteId: string | null;
}

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  group: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

export enum ViewMode {
  EDITOR = 'EDITOR',
  GRAPH = 'GRAPH',
  CANVAS = 'CANVAS' // Placeholder for canvas view
}

export type Command = {
  id: string;
  label: string;
  action: () => void;
  shortcut?: string;
};

// --- API Token Types ---

export interface ApiToken {
  id: number;
  tokenPrefix: string;   // e.g. "nt_a3f8c2d" — for display only
  name: string | null;
  permissions: Array<'read' | 'write' | 'delete' | 'admin'>;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  isActive: boolean;
}

export interface NewApiToken extends ApiToken {
  token: string;  // Raw token — only present on initial creation response
}

export interface NoteLink {
  sourceId: string;
  sourceTitle: string;
  targetId: string;
  targetTitle: string;
  linkText?: string;
}

export interface GraphData {
  nodes: Array<{ id: string; title: string; linkCount: number }>;
  links: NoteLink[];
}

export interface VaultStats {
  noteCount: number;
}