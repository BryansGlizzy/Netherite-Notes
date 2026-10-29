import { User, Group, Note } from '../types';
import { localDb } from './localDb';

export const isOnline = () => navigator.onLine;

export const sync = async () => {
  if (!isOnline()) return;
  const queue = await localDb.syncQueue.orderBy('createdAt').toArray();
  for (const item of queue) {
    try {
      await request(item.endpoint, { method: item.method, body: item.payload ? JSON.stringify(item.payload) : undefined });
      await localDb.syncQueue.delete(item.id!);
    } catch (e) {
      console.error('Failed to sync item:', item, e);
      break; // Stop syncing on first failure to keep sequential order
    }
  }
};
// ID Generators
export const generateId = (): string => Math.random().toString(36).substring(2, 9);
export const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// --- Auth & Session ---
const SESSION_KEY = 'obsidian_clone_session_id';
const JWT_KEY = 'netherite_jwt';

export const getSession = (): string | null => {
  return localStorage.getItem(SESSION_KEY);
};

export const setSession = (userId: string) => {
  localStorage.setItem(SESSION_KEY, userId);
};

export const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(JWT_KEY);
};

// Called when the server rejects our JWT (expired, revoked by a password change, user deleted).
let authExpiredHandler: (() => void) | null = null;
export const setAuthExpiredHandler = (fn: (() => void) | null) => { authExpiredHandler = fn; };

// Logout / expiry: drop the session AND the offline cache, so the next person on this browser
// cannot read cached notes and queued writes can't replay under a different account.
export const purgeLocalData = async () => {
  clearSession();
  try {
    await localDb.transaction('rw', localDb.notes, localDb.groups, localDb.syncQueue, async () => {
      await Promise.all([localDb.notes.clear(), localDb.groups.clear(), localDb.syncQueue.clear()]);
    });
  } catch (e) {
    console.warn('Could not clear local cache', e);
  }
};

export const getJwt = (): string | null => {
  return localStorage.getItem(JWT_KEY);
};

export const setJwt = (token: string) => {
  localStorage.setItem(JWT_KEY, token);
};

// --- API Client ---

const API_URL = '/api';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const jwt = localStorage.getItem(JWT_KEY);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (jwt) {
    headers['Authorization'] = `Bearer ${jwt}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const isCredentialCall = /^\/(login|register|auth\/)/.test(endpoint);
    if (response.status === 401 && jwt && !isCredentialCall) authExpiredHandler?.();
    throw new Error(typeof error.error === 'string' ? error.error : `Request failed: ${response.statusText}`);
  }
  return response.json();
}

// User
export const registerUser = async (username: string, password: string, email?: string, inviteCode?: string): Promise<User> => {
  const user = await request<User>('/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, email, inviteCode: inviteCode || undefined }),
  });
  if (user.token) setJwt(user.token);
  return user;
};

export const loginUser = async (username: string, password: string): Promise<User> => {
  const user = await request<User>('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (user.token) setJwt(user.token);
  return user;
};

export const fetchUser = async (id: string): Promise<User> => {
  return request<User>(`/user/${id}`);
};

// The AI API key is not part of the profile; it is fetched when the AI panel needs it.
export interface AiConfig { aiEndpoint: string; aiApiKey: string; aiModel: string }
export const fetchAiConfig = async (userId: string): Promise<AiConfig> => {
  return request<AiConfig>(`/user/${userId}/ai-config`);
};

// Public: tells the sign-up form whether an invite code is needed (or sign-up is closed).
export type RegistrationMode = 'open' | 'invite' | 'closed';
export const getAuthConfig = async (): Promise<{ registration: RegistrationMode }> => {
  return request<{ registration: RegistrationMode }>('/auth/config');
};

export const verifyEmail = async (token: string): Promise<{ success: boolean }> => {
  return request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
};

export const resendVerification = async (): Promise<{ success: boolean }> => {
  return request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({}) });
};

// Forgot / Reset Password
export const forgotPassword = async (email: string): Promise<{ success: boolean }> => {
  return request<{ success: boolean }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
};

export const resetPassword = async (token: string, newPassword: string): Promise<{ success: boolean }> => {
  return request<{ success: boolean }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
};

// User Settings (JWT required)
export const updateUserSettings = async (
  userId: string,
  settings: { username?: string; currentPassword?: string; newPassword?: string; email?: string; aiEndpoint?: string; aiApiKey?: string | null; aiModel?: string; keybindSplitBlock?: string; keybindNewLine?: string; }
): Promise<User> => {
  const jwt = getJwt();
  const user = await request<User>(`/user/${userId}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(settings),
  });
  if (user.token) setJwt(user.token);
  return user;
};

// Admin (JWT required)
export const adminListUsers = async (): Promise<any[]> => {
  const jwt = getJwt();
  const res = await request<{ users: any[] }>('/admin/users', {
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
  });
  return res.users;
};

export const adminUpdateUser = async (userId: string, updates: { username?: string; email?: string; newPassword?: string }): Promise<any> => {
  const jwt = getJwt();
  return request<any>(`/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(updates),
  });
};

export const adminDeleteUser = async (userId: string): Promise<any> => {
  const jwt = getJwt();
  return request<any>(`/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
  });
};

export interface AdminInvite { id: number; codePrefix: string; createdAt: number; expiresAt: number | null; usedAt: number | null; usedByName: string | null }
export interface AuditEvent { id: number; ts: number; action: string; target: string | null; ip: string | null; actorName: string | null; detail: any }

export const adminListInvites = async (): Promise<AdminInvite[]> => (await request<{ invites: AdminInvite[] }>('/admin/invites')).invites;
export const adminCreateInvite = async (expiresInDays?: number): Promise<{ id: number; code: string; expiresAt: number | null }> =>
  request('/admin/invites', { method: 'POST', body: JSON.stringify({ expiresInDays }) });
export const adminDeleteInvite = async (id: number): Promise<void> => { await request(`/admin/invites/${id}`, { method: 'DELETE' }); };
export const adminListAudit = async (limit = 100): Promise<AuditEvent[]> => (await request<{ events: AuditEvent[] }>(`/admin/audit?limit=${limit}`)).events;

// Vault sharing (owner): turn joining on/off or replace the share code.
export const updateSharing = async (groupId: string, change: { enabled?: boolean; rotate?: boolean }): Promise<{ joinCode: string; joinEnabled: boolean }> =>
  request(`/groups/${groupId}/sharing`, { method: 'PUT', body: JSON.stringify(change) });

// Groups
export const fetchGroup = async (id: string): Promise<Group> => {
  return request<Group>(`/groups/${id}`);
};

export const createGroup = async (name: string, ownerId: string): Promise<Group> => {
  return request<Group>('/groups', {
    method: 'POST',
    body: JSON.stringify({ name, ownerId }),
  });
};

export const updateGroup = async (id: string, updates: Partial<Group>): Promise<void> => {
  await request(`/groups/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
};

export const joinGroup = async (userId: string, groupId: string): Promise<Group> => {
  return request<Group>('/groups/join', {
    method: 'POST',
    body: JSON.stringify({ userId, groupId }),
  });
};

export const leaveGroup = async (userId: string, groupId: string): Promise<void> => {
  await request('/groups/leave', {
    method: 'POST',
    body: JSON.stringify({ userId, groupId }),
  });
};

export const deleteGroup = async (groupId: string, userId: string): Promise<void> => {
  await request(`/groups/${groupId}`, {
    method: 'DELETE',
    body: JSON.stringify({ userId }),
  });
};

// Notes
export const fetchNotes = async (groupId: string): Promise<Note[]> => {
  if (isOnline()) {
    try {
      const notes = await request<Note[]>(`/notes?groupId=${groupId}`);
      await localDb.notes.bulkPut(notes);
      return notes;
    } catch (e) {
      console.warn('Network fetch failed, falling back to localDb');
    }
  }
  return localDb.notes.where({ groupId }).toArray();
};

export const saveNote = async (note: Note): Promise<Note> => {
  await localDb.notes.put(note);
  if (isOnline()) {
    try {
      return await request<Note>('/notes', { method: 'POST', body: JSON.stringify(note) });
    } catch (e) {
      console.warn('Network save failed, queueing sync');
    }
  }
  await localDb.syncQueue.add({ operation: 'CREATE', endpoint: '/notes', method: 'POST', payload: note, createdAt: Date.now() });
  return note;
};

export const updateNote = async (noteId: string, updates: Partial<Note>): Promise<void> => {
  if (updates.id === undefined) updates.id = noteId; 
  // Get partial note from db and update it
  const existing = await localDb.notes.get(noteId);
  if (existing) {
    await localDb.notes.put({ ...existing, ...updates });
  }

  if (isOnline()) {
    try {
      await request(`/notes/${noteId}`, { method: 'PUT', body: JSON.stringify(updates) });
      return;
    } catch (e) {
      console.warn('Network update failed, queueing sync');
    }
  }
  await localDb.syncQueue.add({ operation: 'UPDATE', endpoint: `/notes/${noteId}`, method: 'PUT', payload: updates, createdAt: Date.now() });
};

export const deleteNote = async (noteId: string): Promise<void> => {
  await localDb.notes.delete(noteId);
  if (isOnline()) {
    try {
      await request(`/notes/${noteId}`, { method: 'DELETE' });
      return;
    } catch (e) {
      console.warn('Network delete failed, queueing sync');
    }
  }
  await localDb.syncQueue.add({ operation: 'DELETE', endpoint: `/notes/${noteId}`, method: 'DELETE', createdAt: Date.now() });
};

// --- Helper: Parse Links for Graph (Client Side) ---

export const getNoteLinks = (notes: Note[]): { source: string, target: string }[] => {
  const links: { source: string, target: string }[] = [];
  
  if (!Array.isArray(notes)) return links;

  // Defensive map creation
  const noteTitles = new Map();
  notes.forEach(n => {
      if (n && n.title && n.id) {
          noteTitles.set(n.title.toLowerCase(), n.id);
      }
  });

  notes.forEach(note => {
    if (!note || !note.content) return; // Skip invalid notes
    
    const regex = /\[\[(.*?)\]\]/g;
    let match;
    // Safety against infinite loops or non-string content
    const content = String(note.content); 
    
    while ((match = regex.exec(content)) !== null) {
      if (match[1]) {
        const linkedTitle = match[1].toLowerCase();
        const targetId = noteTitles.get(linkedTitle);
        if (targetId && targetId !== note.id) {
          links.push({ source: note.id, target: targetId });
        }
      }
    }
  });

  return links;
};


// ============================================================
// API v1 Client Functions (Token Management & External API)
// ============================================================

import { ApiToken, NewApiToken, GraphData as ApiGraphData } from '../types';

const API_V1 = '/api/v1';

// Helper for owner-only v1 routes (token management): authenticated with the user's JWT.
// The userId argument is kept for call-site compatibility; the server derives the user from the token.
async function sessionRequest<T>(endpoint: string, _userId: string, options: RequestInit = {}): Promise<T> {
  const jwt = localStorage.getItem(JWT_KEY);
  const response = await fetch(`${API_V1}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401 && jwt) authExpiredHandler?.();
    throw new Error(error?.error?.message || `Request failed: ${response.statusText}`);
  }
  return response.json();
}

// --- Token Management (session-authenticated, owner only) ---

export const generateVaultToken = async (
  groupId: string,
  userId: string,
  options: { name?: string; permissions?: string[]; expiresAt?: number }
): Promise<NewApiToken> => {
  const res = await sessionRequest<{ token: NewApiToken }>(`/vaults/${groupId}/tokens`, userId, {
    method: 'POST',
    body: JSON.stringify(options),
  });
  return res.token;
};

export const listVaultTokens = async (groupId: string, userId: string): Promise<ApiToken[]> => {
  const res = await sessionRequest<{ tokens: ApiToken[] }>(`/vaults/${groupId}/tokens`, userId);
  return res.tokens;
};

export const revokeVaultToken = async (groupId: string, tokenId: number, userId: string): Promise<void> => {
  await sessionRequest(`/vaults/${groupId}/tokens/${tokenId}`, userId, { method: 'DELETE' });
};

// --- Link Operations (API-token-authenticated, for external use) ---

export const fetchVaultLinks = async (groupId: string, apiToken: string): Promise<ApiGraphData> => {
  const response = await fetch(`${API_V1}/vaults/${groupId}/links`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!response.ok) throw new Error('Failed to fetch vault links');
  return response.json();
};

// --- Vault Export & Import ---

export interface VaultExportData {
  __netherite_export_version: 1;
  exportedAt: number;
  vault: { name: string };
  notes: Array<{
    id: string;
    title: string;
    content: string;
    createdAt: number;
    updatedAt: number;
    isBookmarked: boolean;
  }>;
}

export const exportVault = async (groupId: string): Promise<VaultExportData> => {
  return request<VaultExportData>(`/groups/${groupId}/export`);
};

export const importVault = async (
  data: VaultExportData
): Promise<Group & { noteCount: number }> => {
  return request<Group & { noteCount: number }>('/groups/import', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};