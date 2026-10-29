import Dexie, { type Table } from 'dexie';
import { Note, Group } from '../types';

export interface SyncQueueItem {
  id?: number; // Auto-incremented primary key
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  endpoint: string;
  method: string;
  payload?: any;
  createdAt: number;
}

export interface LocalGroup extends Group {
  memberCount?: number;
}

export class NetheriteDB extends Dexie {
  notes!: Table<Note, string>;
  groups!: Table<LocalGroup, string>;
  syncQueue!: Table<SyncQueueItem, number>;
  
  constructor() {
    super('NetheriteDB');
    
    // Define the schema: primary keys and indexed fields
    // ++id is an auto-incremented primary key for the syncQueue
    this.version(1).stores({
      notes: 'id, groupId, title, updatedAt',
      groups: 'id, ownerId',
      syncQueue: '++id, createdAt'
    });
  }
}

export const localDb = new NetheriteDB();
