import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  FileText,
  Settings,
  Search,
  Network,
  Plus,
  LogOut,
  Share2,
  Menu,
  Bookmark,
  Hash,
  Box,
  Edit3,
  Check,
  Link as LinkIcon,
  X,
  Loader2,
  Trash2,
  Shield,
  Download,
} from 'lucide-react';
import { User, Group, Note, ViewMode, Command, ActiveUser } from './types';
import * as db from './services/storage';
import GraphView from './components/GraphView';
import MarkdownEditor from './components/MarkdownEditor';
import CommandPalette from './components/CommandPalette';
import AIPane from './components/AIPane';
import { URL_TOKENS } from './lib/urlTokens';

import SimpleModal from './components/modals/SimpleModal';
import AuthScreen from './components/auth/AuthScreen';
import TokenManagementModal from './components/modals/TokenManagementModal';
import VaultSettingsModal from './components/modals/VaultSettingsModal';
import AccountSettingsModal from './components/modals/AccountSettingsModal';
import AdminPanelModal from './components/modals/AdminPanelModal';

// --- Main App Component ---

interface ModalState {
    type: 'create_vault' | 'rename_vault';
    initialValue?: string;
}


// A verification link (#verify=...) is redeemed once at load, whether or not anyone is signed in.
const VERIFY_RESULT: Promise<{ ok: boolean; message: string }> | null = URL_TOKENS.verify
  ? db.verifyEmail(URL_TOKENS.verify).then(
      () => ({ ok: true, message: 'Your email address is verified. Thank you!' }),
      (e: Error) => ({ ok: false, message: e.message || 'That verification link is invalid or has expired.' })
    )
  : null;

const App: React.FC = () => {
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  useEffect(() => {
    VERIFY_RESULT?.then(r => {
      setNotice(r);
      if (r.ok) setUser(u => (u ? { ...u, emailVerified: true } : u));
    });
  }, []);
  const [user, setUser] = useState<User | null>(null);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null);
  const [secondaryNoteId, setSecondaryNoteId] = useState<string | null>(null);
  const [activePane, setActivePane] = useState<'primary' | 'secondary'>('primary');
  const [activeMobileTab, setActiveMobileTab] = useState<'primary' | 'secondary'>('primary');
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.EDITOR);
  const [notes, setNotes] = useState<Note[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isVaultDropdownOpen, setIsVaultDropdownOpen] = useState(false);
  const [joinVaultId, setJoinVaultId] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [vaultSettingsOpen, setVaultSettingsOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [aiPaneOpen, setAiPaneOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      await db.sync();
      // Reload notes to get fresh server data
      if (currentGroupId) {
        db.fetchNotes(currentGroupId).then(notes => setNotes(notes)).catch(() => {});
      }
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial sync
    if (navigator.onLine) db.sync();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [currentGroupId]);

  // Mobile Detection
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile && !sidebarOpen) {
          setSidebarOpen(true); // Auto-open sidebar on desktop if it was closed
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarOpen]);
  
  // WebSocket Ref
  const ws = useRef<WebSocket | null>(null);

  // Touch tracking refs for swipe gesture (refs avoid re-renders during the swipe)
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const swipeInProgress = useRef(false);
  
  // Track current view state so reconnections know what to broadcast
  const focusedNoteId = activePane === 'secondary' && secondaryNoteId ? secondaryNoteId : currentNoteId;
  const viewStateRef = useRef({ viewMode, focusedNoteId });
  useEffect(() => {
      viewStateRef.current = { viewMode, focusedNoteId };
  }, [viewMode, focusedNoteId]);

  // Mobile swipe gestures: Right-swipe to open, Left-swipe to close
  useEffect(() => {
    if (!isMobile) return;   // desktop: never attach

    const SWIPE_THRESHOLD = 40; // minimum px of horizontal travel
    const EDGE_ZONE       = 60; // swipe must start within this many px of left edge to open
    const ANGLE_LIMIT     = 50; // degrees — steeper angles are treated as vertical scroll

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      // If closed, only allow starting from the edge
      if (!sidebarOpen && t.clientX > EDGE_ZONE) return;
      
      touchStartX.current = t.clientX;
      touchStartY.current = t.clientY;
      swipeInProgress.current = true;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!swipeInProgress.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - (touchStartX.current ?? 0);
      const dy = t.clientY - (touchStartY.current ?? 0);
      
      swipeInProgress.current = false;
      touchStartX.current = null;
      touchStartY.current = null;

      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      if (adx < SWIPE_THRESHOLD) return; // too short
      const angle = Math.abs(Math.atan2(ady, adx) * (180 / Math.PI));
      if (angle > ANGLE_LIMIT) return;  // too vertical

      if (!sidebarOpen && dx > SWIPE_THRESHOLD) {
        setSidebarOpen(true);
      } else if (sidebarOpen && dx < -SWIPE_THRESHOLD) {
        setSidebarOpen(false);
      }
    };

    const onTouchCancel = () => {
      swipeInProgress.current = false;
      touchStartX.current = null;
      touchStartY.current = null;
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    document.addEventListener('touchend',   onTouchEnd,   { passive: true, capture: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true, capture: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchend',   onTouchEnd, { capture: true });
      document.removeEventListener('touchcancel', onTouchCancel, { capture: true });
    };
  }, [isMobile, sidebarOpen]);

  // Modal State
  const [modalState, setModalState] = useState<ModalState | null>(null);

  // PWA Install Prompt State
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  // Initialize Session
  useEffect(() => {
    const init = async () => {
      const sessionId = db.getSession();
      if (sessionId) {
        try {
          const storedUser = await db.fetchUser(sessionId);
          setUser(storedUser);
        } catch (e) {
          console.error("Session invalid", e);
          await db.purgeLocalData();
          setUser(null);
        }
      }
      setIsLoading(false);
    };
    init();
  }, []);

  // A 401 on any authenticated request means the session is gone (expired, revoked by a password change,
  // or the account was removed): drop local data and return to the login screen.
  useEffect(() => {
    db.setAuthExpiredHandler(() => {
      void db.purgeLocalData();
      setUser(null);
      setCurrentGroupId(null);
      setCurrentNoteId(null);
    });
    return () => db.setAuthExpiredHandler(null);
  }, []);

  // Ensure default group is selected on login if none selected
  useEffect(() => {
    if (user && !currentGroupId && user.groupIds.length > 0) {
      setCurrentGroupId(user.groupIds[0]);
    }
  }, [user, currentGroupId]);

  // WebSocket Connection & Data Load
  useEffect(() => {
    let reconnectTimer: any;
    let isMounted = true;
    let socket: WebSocket | null = null;

    const loadData = async () => {
      if (user && currentGroupId) {
        setIsLoading(true);
        try {
          const [groupNotes, userGroups] = await Promise.all([
             db.fetchNotes(currentGroupId),
             Promise.all(user.groupIds.map(id => db.fetchGroup(id).catch(() => null)))
          ]);
          
          if (!isMounted) return;
          setNotes(groupNotes);
          setGroups(userGroups.filter(Boolean) as Group[]);

          // Check if selected note exists
          const selectedNoteExists = groupNotes.some(n => n.id === currentNoteId);
          if ((!currentNoteId || !selectedNoteExists) && groupNotes.length > 0) {
             setCurrentNoteId(groupNotes[0].id);
          } else if (groupNotes.length === 0) {
             setCurrentNoteId(null);
          }
        } catch (e) {
          console.error("Failed to load data", e);
        } finally {
          if (isMounted) setIsLoading(false);
        }
      }
    };

    const connectWS = () => {
        if (!user || !currentGroupId || !isMounted) return;

        // Determine protocol (wss for https, ws for http)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // USE SPECIFIC PATH /ws TO AVOID CONFLICT WITH VITE HMR
        const socketUrl = `${protocol}//${window.location.host}/ws`;
        socket = new WebSocket(socketUrl);

        socket.onopen = () => {
            if (!isMounted) return;
            // Join the specific vault channel
            socket!.send(JSON.stringify({ 
                type: 'JOIN', 
                groupId: currentGroupId,
                token: db.getJwt()
            }));
            
            // Send initial viewing state based on up-to-date ref
            const currentView = viewStateRef.current;
            if (currentView.viewMode === ViewMode.EDITOR && currentView.focusedNoteId) {
                socket!.send(JSON.stringify({ type: 'VIEWING', noteId: currentView.focusedNoteId }));
            }
        };

        socket.onmessage = (event) => {
            if (!isMounted) return;
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'ROOM_STATE') {
                    setActiveUsers(data.users || []);
                } else if (data.type === 'PRESENCE_UPDATE') {
                    setActiveUsers(prev => {
                        if (data.user.offline) {
                            return prev.filter(u => u.userId !== data.user.userId);
                        }
                        const exists = prev.find(u => u.userId === data.user.userId);
                        if (exists) {
                            return prev.map(u => u.userId === data.user.userId ? { ...u, ...data.user } : u);
                        } else {
                            return [...prev, data.user];
                        }
                    });
                } else if (data.type === 'UPDATE') {
                    setNotes(prev => prev.map(n => n.id === data.note.id ? data.note : n));
                } else if (data.type === 'CREATE') {
                    setNotes(prev => [data.note, ...prev]);
                } else if (data.type === 'DELETE') {
                    setNotes(prev => prev.filter(n => n.id !== data.id));
                    // If deleted note was open, close it
                    if (currentNoteId === data.id) setCurrentNoteId(null);
                }
            } catch (e) {
                console.error("WS Parse Error", e);
            }
        };

        socket.onclose = (event) => {
            if (isMounted && event.code === 4401) {
                // Server rejected our session (revoked, expired, or no longer a member): don't reconnect-loop.
                console.warn('WebSocket join was rejected by the server; not reconnecting.');
                return;
            }
            if (isMounted) {
                // Try to reconnect in 2.5 seconds
                reconnectTimer = setTimeout(() => {
                    console.log("WebSocket connection dropped. Reconnecting...");
                    connectWS();
                }, 2500);
            }
        };

        ws.current = socket;
    };

    loadData();
    connectWS();

    return () => {
        isMounted = false;
        clearTimeout(reconnectTimer);
        if (socket) {
            socket.onclose = null; // Prevent reconnect loop
            socket.close();
        }
        ws.current = null;
    };

  }, [user, currentGroupId]); // Re-run if vault changes

  // Broadcast viewing changes when navigating
  useEffect(() => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        if (viewMode === ViewMode.EDITOR && focusedNoteId) {
            ws.current.send(JSON.stringify({ type: 'VIEWING', noteId: focusedNoteId }));
        } else {
            ws.current.send(JSON.stringify({ type: 'VIEWING', noteId: null }));
        }
    }
  }, [viewMode, focusedNoteId]);

  // Derived state
  const currentNote = useMemo(() => notes.find(n => n.id === currentNoteId), [notes, currentNoteId]);
  const secondaryNote = useMemo(() => notes.find(n => n.id === secondaryNoteId), [notes, secondaryNoteId]);
  const currentGroup = useMemo(() => groups.find(g => g.id === currentGroupId), [groups, currentGroupId]);
  const isReadOnlyOffline = useMemo(() => !isOnline && currentGroup && (currentGroup.ownerId !== user?.id || (currentGroup.memberCount && currentGroup.memberCount > 1)), [isOnline, currentGroup, user]);


  // Actions
  const handleLogout = () => {
    void db.purgeLocalData();
    setUser(null);
    setCurrentGroupId(null);
    setCurrentNoteId(null);
  };

  const broadcast = (type: string, payload: any) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type, ...payload }));
      }
  };

  const createNote = useCallback(async () => {
    if (!currentGroupId) return;
    
    const newNote: Note = {
      id: db.generateUUID(),
      groupId: currentGroupId,
      title: '',
      content: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    try {
      // Optimistic update
      setNotes(prev => [newNote, ...prev]);
      setCurrentNoteId(newNote.id);
      setViewMode(ViewMode.EDITOR);
      
      // Save and Broadcast
      await db.saveNote(newNote);
      broadcast('CREATE', { note: newNote });
    } catch (e) {
      console.error("Failed to create note", e);
    }
  }, [currentGroupId]);

  const deleteNote = async (id: string) => {
    const prevNotes = [...notes];
    try {
      // Optimistic
      setNotes(prev => prev.filter(n => n.id !== id));
      if (currentNoteId === id) {
        setCurrentNoteId(null);
      }
      // Save and Broadcast
      await db.deleteNote(id);
      broadcast('DELETE', { id });
    } catch (e) {
      console.error("Failed to delete", e);
      setNotes(prevNotes);
    }
  };

  const deleteCurrentNote = async () => {
    if (focusedNoteId) {
      await deleteNote(focusedNoteId);
    }
  };

  const updateNote = async (id: string, updates: Partial<Note>) => {
    const note = notes.find(n => n.id === id);
    if (note) {
      // Optimistic
      const updatedNote = { ...note, ...updates, updatedAt: Date.now() };
      setNotes(prev => prev.map(n => n.id === id ? updatedNote : n));
      
      // Broadcast live (Fire and forget, we save to DB below)
      broadcast('UPDATE', { note: updatedNote });

      try {
        await db.updateNote(id, updatedNote);
      } catch (e) {
        console.error("Update failed", e);
      }
    }
  };

  const handleJoinGroup = async (code?: string) => {
    const vaultCode = code || joinVaultId;
    if (!vaultCode || !user) return;
    
    try {
        const group = await db.joinGroup(user.id, vaultCode);
        const updatedUser = { ...user, groupIds: [...user.groupIds, group.id] };
        setUser(updatedUser); 
        setCurrentGroupId(group.id);
        setJoinVaultId('');
    } catch (e) {
        alert("Vault not found or error joining.");
    }
  };

  const handleLeaveOrDeleteVault = async () => {
      if (!currentGroup || !user) return;
      const isOwner = currentGroup.ownerId === user.id;
      const actionStr = isOwner ? 'delete' : 'leave';
      if (!window.confirm(`Are you sure you want to ${actionStr} this vault?`)) return;

      try {
          if (isOwner) {
              await db.deleteGroup(currentGroup.id, user.id);
          } else {
              await db.leaveGroup(user.id, currentGroup.id);
          }
          
          const updatedUser = { 
              ...user, 
              groupIds: user.groupIds.filter(id => id !== currentGroup.id) 
          };
          setUser(updatedUser);
          
          const remainingGroups = groups.filter(g => g.id !== currentGroup.id);
          setGroups(remainingGroups);
          
          setCurrentGroupId(remainingGroups.length > 0 ? remainingGroups[0].id : null);
          setCurrentNoteId(null);
          setSecondaryNoteId(null);
          setNotes([]);
      } catch (e) {
          console.error(`Failed to ${actionStr} vault`, e);
          alert(`Action failed. Please try again.`);
      }
  };

  // --- Vault Export ---
  const handleExportVault = async () => {
    if (!currentGroup || !user) return;
    try {
      const data = await db.exportVault(currentGroup.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = currentGroup.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
      a.href = url;
      a.download = `netherite-${safeName}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`Export failed: ${e.message}`);
    }
  };

  // --- Vault Import ---
  const handleImportFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const newGroup = await db.importVault(data);
      const updatedUser = { ...user, groupIds: [...user.groupIds, newGroup.id] };
      setUser(updatedUser);
      setGroups(prev => [...prev, { id: newGroup.id, name: newGroup.name, ownerId: newGroup.ownerId }]);
      db.fetchGroup(newGroup.id).then(g => setGroups(prev => prev.map(x => x.id === g.id ? g : x))).catch(() => {});
      setCurrentGroupId(newGroup.id);
      setCurrentNoteId(null);
      alert(`Vault imported! "${newGroup.name}" created with ${newGroup.noteCount} note(s).`);
    } catch (e: any) {
      alert(`Import failed: ${e.message || 'Invalid file'}`);
    } finally {
      setIsImporting(false);
      // Reset file input so the same file can be selected again
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  // --- Modal Handlers ---

  const openCreateVaultModal = () => {
      setModalState({ type: 'create_vault', initialValue: '' });
  };

  const openRenameVaultModal = () => {
      if (currentGroup) {
          setModalState({ type: 'rename_vault', initialValue: currentGroup.name });
      }
  };

  const handleModalConfirm = async (value: string) => {
      if (!modalState || !user) return;
      
      try {
        if (modalState.type === 'create_vault') {
            const group = await db.createGroup(value, user.id);
            const updatedUser = { ...user, groupIds: [...user.groupIds, group.id] };
            
            setUser(updatedUser);
            setGroups(prev => [...prev, group]);
            setCurrentGroupId(group.id);
            
        } else if (modalState.type === 'rename_vault' && currentGroup) {
            await db.updateGroup(currentGroup.id, { name: value });
            setGroups(prev => prev.map(g => g.id === currentGroup.id ? { ...g, name: value } : g));
        }
      } catch (e) {
          console.error("Modal action failed", e);
          alert("Action failed. Please try again.");
      }

      setModalState(null);
  };

  // Robust Copy Function
  const copyVaultId = async () => {
    if (currentGroup?.joinCode) {
        const text = currentGroup.joinCode;
        let success = false;
        
        try {
            await navigator.clipboard.writeText(text);
            success = true;
        } catch (err) {
            // Fallback for http or unsupported contexts
            try {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed'; // Avoid scrolling to bottom
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                const result = document.execCommand('copy');
                document.body.removeChild(textarea);
                if (result) success = true;
            } catch (fallbackErr) {
                console.error("Copy failed", fallbackErr);
            }
        }

        if (success) {
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } else {
            alert(`Could not copy automatically. Vault ID: ${text}`);
        }
    }
  };

  // Helper for static user colors
  const getColorForUser = (userId: string) => {
      const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-cyan-500'];
      let hash = 0;
      for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
      return colors[Math.abs(hash) % colors.length];
  };

  // Commands definition
  const commands: Command[] = useMemo(() => [
    { id: 'new-note', label: 'Create New Note', action: createNote, shortcut: 'Ctrl+N' },
    { id: 'graph-view', label: 'Open Graph View', action: () => setViewMode(ViewMode.GRAPH), shortcut: 'Ctrl+G' },
    { id: 'editor-view', label: 'Open Editor', action: () => setViewMode(ViewMode.EDITOR), shortcut: 'Ctrl+E' },
    { id: 'delete-note', label: 'Delete Current Note', action: deleteCurrentNote },
    { id: 'create-vault', label: 'Create New Vault', action: openCreateVaultModal },
    { id: 'rename-vault', label: 'Rename Current Vault', action: openRenameVaultModal },
    { id: 'logout', label: 'Log Out', action: handleLogout },
    { id: 'toggle-sidebar', label: 'Toggle Sidebar', action: () => setSidebarOpen(!sidebarOpen), shortcut: 'Ctrl+B' },
  ], [createNote, openCreateVaultModal, openRenameVaultModal, deleteCurrentNote, sidebarOpen, currentGroup]);

  // Global Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const filteredNotes = useMemo(() => {
    return notes
      .filter(n => n.title.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        // Bookmarked notes first
        if (a.isBookmarked && !b.isBookmarked) return -1;
        if (!a.isBookmarked && b.isBookmarked) return 1;
        // Then by updatedAt descending
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
  }, [notes, searchQuery]);

  const handleSplit = () => {
    if (!secondaryNoteId && currentNoteId) {
      setSplitModalOpen(true);
    }
  };

  const handleClosePane = (pane: 'primary' | 'secondary') => {
    if (pane === 'secondary') {
      setSecondaryNoteId(null);
      setActivePane('primary');
      setActiveMobileTab('primary');
    } else {
      if (secondaryNoteId) {
        setCurrentNoteId(secondaryNoteId);
        setSecondaryNoteId(null);
        setActivePane('primary');
        setActiveMobileTab('primary');
      } else {
        setCurrentNoteId(null);
      }
    }
  };

  if (isLoading && !user) {
      return <div className="h-screen w-screen bg-obsidian-bg flex items-center justify-center text-obsidian-text">
          <Loader2 className="animate-spin w-8 h-8" />
      </div>;
  }

  if (!user) {
    return <AuthScreen onLogin={setUser} />;
  }

  return (
    <div className="flex h-[100dvh] w-screen bg-transparent text-obsidian-text overflow-hidden fixed inset-0" style={{ touchAction: 'pan-y' }}>
      {(notice || (user.email && user.emailVerified === false)) && (
        <div className={`fixed top-0 inset-x-0 z-[60] px-4 py-2 text-sm flex items-center justify-center gap-3 ${notice ? (notice.ok ? 'bg-emerald-700/90' : 'bg-red-700/90') : 'bg-amber-600/90'} text-white backdrop-blur`}>
          {notice ? (
            <>
              <span>{notice.message}</span>
              <button className="underline" onClick={() => setNotice(null)}>Dismiss</button>
            </>
          ) : (
            <>
              <span>Please verify your email address ({user.email}) — check your inbox for the link.</span>
              <button
                className="underline disabled:opacity-60"
                disabled={resendState !== 'idle'}
                onClick={async () => {
                  setResendState('sending');
                  try { await db.resendVerification(); setResendState('sent'); } catch { setResendState('idle'); }
                }}
              >{resendState === 'sent' ? 'Sent!' : resendState === 'sending' ? 'Sending…' : 'Resend email'}</button>
            </>
          )}
        </div>
      )}


      
      {/* --- Sidebar --- */}
      <div 
        className={`
          ${sidebarOpen ? (isMobile ? 'w-full' : 'w-64') : 'w-0 overflow-hidden'} 
          h-full flex-shrink-0 bg-obsidian-sidebar/40 backdrop-blur-2xl border-r border-obsidian-border/50 
          transition-all duration-300 flex flex-col shadow-xl z-20
        `}
      >
        {/* Vault Switcher & Creator */}
        <div className="p-3 border-b border-obsidian-border/50 space-y-2">
            <div className="flex items-center justify-between gap-1 relative">
                <div 
                    tabIndex={0}
                    onBlur={() => setTimeout(() => setIsVaultDropdownOpen(false), 150)}
                    onClick={() => setIsVaultDropdownOpen(!isVaultDropdownOpen)}
                    className="flex items-center space-x-2 flex-1 min-w-0 bg-obsidian-bg/30 backdrop-blur-md rounded-lg border border-obsidian-border/50 hover:border-obsidian-accent/50 transition-colors shadow-inner cursor-pointer relative"
                >
                    <Box className="w-4 h-4 text-obsidian-accent flex-shrink-0 ml-2" />
                    <div className="bg-transparent text-sm font-bold w-full p-2 truncate select-none text-gray-200 flex items-center justify-between">
                        <span>{currentGroup?.name || 'Select Vault...'}</span>
                        {!isOnline && <span className="ml-2 text-[10px] bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded-full border border-red-500/30 whitespace-nowrap">OFFLINE</span>}
                    </div>
                    
                    {/* Custom Dropdown Overlays */}
                    {isVaultDropdownOpen && (
                        <div className="absolute top-full left-0 mt-2 w-full bg-obsidian-sidebar/90 backdrop-blur-3xl border border-obsidian-border/50 rounded-lg shadow-2xl z-50 overflow-hidden max-h-60 overflow-y-auto">
                            {groups.map(g => (
                                <div 
                                    key={g.id} 
                                    className={`p-2.5 text-sm cursor-pointer hover:bg-obsidian-accent/40 transition-colors ${g.id === currentGroupId ? 'text-white font-bold bg-obsidian-accent/20' : 'text-gray-300'}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsVaultDropdownOpen(false);
                                        if(g.id === currentGroupId) return;
                                        setCurrentNoteId(null);
                                        setSecondaryNoteId(null);
                                        setNotes([]); 
                                        setCurrentGroupId(g.id);
                                    }}
                                >
                                    <div className="truncate">{g.name}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                
                <button 
                    onClick={() => currentGroup && setVaultSettingsOpen(true)}
                    title="Vault Settings"
                    disabled={!currentGroup}
                    className="p-1.5 hover:bg-obsidian-bg hover:text-white rounded transition-colors text-gray-400 flex-shrink-0 disabled:opacity-30"
                >
                    <Settings className="w-4 h-4" />
                </button>
                {/* Hidden file input for import */}
                <input
                    ref={importFileRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleImportFileSelected}
                />
                <button 
                    onClick={openCreateVaultModal} 
                    title="Create New Vault" 
                    className="p-1.5 hover:bg-obsidian-accent/20 hover:text-white rounded transition-colors text-gray-400 flex-shrink-0"
                >
                    <Plus className="w-4 h-4" />
                </button>
                {currentGroup && (
                    <button 
                        onClick={handleLeaveOrDeleteVault}
                        title={currentGroup.ownerId === user?.id ? "Delete Vault" : "Leave Vault"} 
                        className="p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded transition-colors text-gray-400 flex-shrink-0"
                    >
                        {currentGroup.ownerId === user?.id ? <Trash2 className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
                    </button>
                )}
            </div>

            {/* Join Vault Input */}
            <div className="flex items-center bg-obsidian-bg/30 rounded-lg border border-obsidian-border/50 focus-within:border-obsidian-accent shadow-inner mt-2">
                <input 
                    className="bg-transparent w-full p-2 text-sm focus:outline-none ml-1 placeholder-gray-500" 
                    placeholder="Paste Vault ID to join..." 
                    value={joinVaultId}
                    onChange={e => setJoinVaultId(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleJoinGroup();
                    }}
                />
                <button 
                    onClick={() => handleJoinGroup()}
                    disabled={!joinVaultId}
                    className="p-1.5 hover:text-white text-gray-500 disabled:opacity-30"
                    title="Join Vault"
                >
                    <LinkIcon className="w-3 h-3" />
                </button>
            </div>
        </div>

        {/* Search & Tools */}
        <div className="p-2 space-y-2">
            <div className="flex items-center bg-black/30 rounded p-1 border border-transparent focus-within:border-obsidian-accent">
                <Search className="w-4 h-4 text-gray-500 ml-1" />
                <input 
                    className="bg-transparent w-full p-1 text-sm focus:outline-none ml-2" 
                    placeholder="Search files..." 
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                />
            </div>
            <div className="flex space-x-1 justify-around text-gray-400">
                <button 
                    className={`p-1 hover:text-white ${viewMode === ViewMode.EDITOR ? 'text-obsidian-accent' : ''}`}
                    onClick={() => {
                      if (currentNoteId) {
                        setViewMode(ViewMode.EDITOR);
                        if (isMobile) setSidebarOpen(false);
                      }
                    }}
                    title="Editor View"
                    disabled={!currentNoteId}
                >
                    <Edit3 className={`w-4 h-4 ${!currentNoteId ? 'opacity-30' : ''}`} />
                </button>
                <button 
                    className={`p-1 hover:text-white ${viewMode === ViewMode.GRAPH ? 'text-obsidian-accent' : ''}`}
                    onClick={() => {
                        setViewMode(ViewMode.GRAPH);
                        if (isMobile) setSidebarOpen(false);
                    }}
                    title="Graph View"
                >
                    <Network className="w-4 h-4" />
                </button>
                <button 
                     className={`p-1 hover:text-white ${isReadOnlyOffline ? 'opacity-30 cursor-not-allowed' : ''}`}
                     onClick={() => !isReadOnlyOffline && createNote()}
                     title={isReadOnlyOffline ? "Cannot create notes while offline in a shared vault" : "New Note"}
                     disabled={!!isReadOnlyOffline}
                >
                    <FileText className="w-4 h-4" />
                </button>
            </div>
        </div>


        {/* File List */}
        <div className="flex-1 overflow-y-auto p-2">
            <div className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider flex justify-between items-center">
                <span>Files</span>
                <span className="text-[10px]">{filteredNotes.length}</span>
            </div>
            <div className="space-y-0.5">
                {isLoading ? (
                    <div className="flex justify-center p-4"><Loader2 className="w-4 h-4 animate-spin text-gray-500" /></div>
                ) : (
                    filteredNotes.map(note => (
                        <div 
                            key={note.id}
                            onClick={() => {
                                if (activePane === 'secondary' && secondaryNoteId) {
                                  setSecondaryNoteId(note.id);
                                } else {
                                  setCurrentNoteId(note.id);
                                }
                                setViewMode(ViewMode.EDITOR);
                                if (isMobile) setSidebarOpen(false);
                            }}
                            className={`
                                group flex items-center px-3 py-2 rounded-lg cursor-pointer text-sm mb-1 transition-all
                                ${(activePane === 'secondary' && secondaryNoteId ? secondaryNoteId : currentNoteId) === note.id ? 'bg-obsidian-accent/30 text-white shadow-md border border-obsidian-accent/50 box-border' : 'text-gray-400 hover:bg-white/10 hover:text-gray-200 border border-transparent'}
                            `}
                        >
                            <FileText className="w-3 h-3 mr-2 opacity-70" />
                            <span className="truncate flex-1">{note.title || 'Untitled'}</span>
                            {note.isBookmarked && <Bookmark className="w-3 h-3 ml-2 text-yellow-500 fill-yellow-500/20" />}
                            
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if(isReadOnlyOffline) return;
                                    if(window.confirm('Delete note?')) deleteNote(note.id);
                                }}
                                className={`opacity-0 group-hover:opacity-100 p-1 transition-opacity ${isReadOnlyOffline ? 'text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-red-400'}`}
                                title={isReadOnlyOffline ? 'Cannot delete offline' : "Delete Note"}
                                disabled={!!isReadOnlyOffline}
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
        
        {/* User Info / Share */}
        <div className="p-3 border-t border-obsidian-border bg-black/20">
            <div className="flex items-center justify-between mb-2 p-1 rounded hover:bg-white/5 transition group">
                <div className="flex items-center space-x-2 overflow-hidden">
                    <span className="text-xs text-gray-500 flex-shrink-0">Code:</span>
                    <span 
                        className="text-xs text-gray-400 truncate select-all cursor-text font-mono"
                        title="Click to select"
                    >
                        {currentGroup?.joinCode ? (currentGroup.joinEnabled === false ? 'sharing off' : currentGroup.joinCode) : 'owner only'}
                    </span>
                </div>
                {currentGroup?.joinCode && currentGroup.joinEnabled !== false && (
                <button 
                    onClick={copyVaultId}
                    className={`
                        ml-2 text-gray-400 hover:text-white transition-all
                        ${copySuccess ? 'text-green-500 hover:text-green-400' : ''}
                    `}
                    title="Copy share code"
                >
                    {copySuccess ? <Check className="w-3 h-3" /> : <Share2 className="w-3 h-3" />}
                </button>
                )}
            </div>
            <div className="flex items-center space-x-2 text-sm text-gray-400">
                <div className="w-6 h-6 rounded-full bg-obsidian-accent flex items-center justify-center text-white text-xs">
                    {user.username[0].toUpperCase()}
                </div>
                <button 
                  onClick={() => setSettingsModalOpen(true)} 
                  className="truncate flex-1 font-medium text-left hover:text-white transition-colors"
                  title="Account Settings"
                >
                  {user.username}
                </button>
                {user.isAdmin && (
                  <button 
                    onClick={() => setAdminModalOpen(true)} 
                    className="hover:text-red-400 transition-colors" 
                    title="Admin Panel"
                  >
                    <Shield className="w-4 h-4" />
                  </button>
                )}
                {deferredPrompt && (
                  <button 
                    onClick={async () => {
                      if (deferredPrompt) {
                        deferredPrompt.prompt();
                        const { outcome } = await deferredPrompt.userChoice;
                        if (outcome === 'accepted') setDeferredPrompt(null);
                      }
                    }} 
                    className="hover:text-blue-400 text-blue-500 transition-colors" 
                    title="Install App"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
                <button onClick={handleLogout} className="hover:text-white" title="Logout"><LogOut className="w-4 h-4" /></button>
            </div>
        </div>
      </div>

      {/* --- Main Content --- */}
      <div className={`flex-1 flex flex-col min-w-0 bg-obsidian-bg/30 backdrop-blur-sm relative ${isMobile && sidebarOpen ? 'hidden' : 'flex'}`}>
        {/* Top Bar (Mobile / Toggle) */}
        <div className="h-12 border-b border-obsidian-border/50 flex items-center px-4 justify-between bg-obsidian-sidebar/30 backdrop-blur-md z-10 shadow-sm">
            <div className="flex items-center text-gray-400 text-sm">
                <button onClick={() => setSidebarOpen(!sidebarOpen)} className="mr-3 hover:text-white">
                    <Menu className="w-4 h-4" />
                </button>
                <span className="opacity-50 truncate max-w-[200px] md:max-w-xs">
                    {currentGroup?.name} / {viewMode === ViewMode.GRAPH ? 'Graph View' : (activePane === 'secondary' && secondaryNoteId ? secondaryNote?.title : currentNote?.title) || 'Untitled'}
                </span>
                {viewMode === ViewMode.GRAPH && focusedNoteId && (
                    <button 
                        onClick={() => setViewMode(ViewMode.EDITOR)}
                        className="flex items-center ml-4 px-2 py-0.5 bg-obsidian-sidebar border border-obsidian-border rounded text-xs hover:bg-obsidian-border transition"
                    >
                        <Edit3 className="w-3 h-3 mr-1" />
                        Back to Note
                    </button>
                )}
            </div>
            <div className="flex items-center space-x-2 text-gray-400">
                 {/* Live Users Viewing This File */}
                 {focusedNoteId && viewMode === ViewMode.EDITOR && (
                    <div className="flex -space-x-2 mr-4 border-r border-obsidian-border pr-4">
                        {activeUsers.filter(u => u.noteId === focusedNoteId && u.userId !== user?.id).map(u => (
                            <div 
                                key={u.userId}
                                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-white font-bold border-2 border-obsidian-bg ${getColorForUser(u.userId)}`}
                                title={`${u.username} is viewing this note`}
                            >
                                {u.username.substring(0, 2).toUpperCase()}
                            </div>
                        ))}
                    </div>
                 )}
                 
                 {/* Top right actions */}
                 {focusedNoteId && viewMode === ViewMode.EDITOR && (
                    <button 
                        onClick={() => {
                            if (focusedNoteId) {
                              const activeNote = activePane === 'secondary' && secondaryNoteId ? secondaryNote : currentNote;
                              updateNote(focusedNoteId, { isBookmarked: !activeNote?.isBookmarked });
                            }
                        }}
                        className={`p-2 rounded hover:bg-white/10 transition-colors ${(activePane === 'secondary' && secondaryNoteId ? secondaryNote : currentNote)?.isBookmarked ? 'text-yellow-500' : 'hover:text-white'}`}
                        title="Bookmark"
                    >
                        <Bookmark className="w-4 h-4" />
                    </button>
                 )}
                 <button 
                    onClick={() => setCommandPaletteOpen(true)} 
                    title="Command Palette (Ctrl+K)"
                    className="p-2 rounded hover:bg-white/10 hover:text-white transition-colors"
                 >
                    <Hash className="w-4 h-4" />
                 </button>
            </div>
        </div>

        {/* View Area */}
        <div className={`flex-1 overflow-hidden flex relative ${isMobile && aiPaneOpen ? 'flex-col' : 'flex-row'}`}>
          <div className="flex-1 overflow-hidden flex flex-col relative">
            {viewMode === ViewMode.GRAPH ? (
                <GraphView 
                    notes={notes} 
                    onNodeClick={(id) => {
                        if (activePane === 'secondary' && secondaryNoteId) {
                          setSecondaryNoteId(id);
                        } else {
                          setCurrentNoteId(id);
                        }
                        setViewMode(ViewMode.EDITOR);
                    }} 
                />
            ) : currentNote ? (
                <>
                  {secondaryNoteId && secondaryNote ? (
                    <div className="flex h-full w-full flex-col">
                      {/* Mobile Tabs */}
                      {isMobile && (
                        <div className="flex border-b border-obsidian-border/50 bg-obsidian-sidebar/80">
                          <button
                            className={`flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-all ${activeMobileTab === 'primary' ? 'text-obsidian-accent border-b-2 border-obsidian-accent bg-obsidian-accent/10' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
                            onClick={() => setActiveMobileTab('primary')}
                          >
                            <span className="truncate max-w-[120px]">{currentNote.title || 'Untitled'}</span>
                            {activeMobileTab === 'primary' && <X className="w-3 h-3 hover:text-red-400" onClick={(e) => { e.stopPropagation(); handleClosePane('primary'); }} />}
                          </button>
                          <button
                            className={`flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-all ${activeMobileTab === 'secondary' ? 'text-obsidian-accent border-b-2 border-obsidian-accent bg-obsidian-accent/10' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
                            onClick={() => setActiveMobileTab('secondary')}
                          >
                            <span className="truncate max-w-[120px]">{secondaryNote.title || 'Untitled'}</span>
                            {activeMobileTab === 'secondary' && <X className="w-3 h-3 hover:text-red-400" onClick={(e) => { e.stopPropagation(); handleClosePane('secondary'); }} />}
                          </button>
                        </div>
                      )}

                      {/* Editors Container */}
                      <div className="flex flex-1 overflow-hidden flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-obsidian-border/50">
                        {(!isMobile || activeMobileTab === 'primary') && (
                          <div className="flex-1 h-full relative" onClick={() => setActivePane('primary')}>
                            <MarkdownEditor
                              key={`primary-${currentNote.id}`}
                              title={currentNote.title}
                              content={currentNote.content}
                              onChangeTitle={(title) => updateNote(currentNote.id, { title })}
                              onChangeContent={(content) => updateNote(currentNote.id, { content })}
                              readOnly={!!isReadOnlyOffline}
                              notes={notes}
                              onSplit={isMobile ? undefined : handleSplit}
                              onClosePane={() => handleClosePane('primary')}
                              showCloseButton={!isMobile}
                              isFocused={!isMobile && activePane === 'primary'}
                              aiPaneOpen={aiPaneOpen}
                              onToggleAIPane={user ? () => setAiPaneOpen(!aiPaneOpen) : undefined}
                              disableAIToggle={!!(activePane === 'secondary' && secondaryNoteId) || splitModalOpen}
                              keybindSplitBlock={user?.keybindSplitBlock}
                              keybindNewLine={user?.keybindNewLine}
                            />
                          </div>
                        )}
                        {(!isMobile || activeMobileTab === 'secondary') && (
                          <div className="flex-1 h-full relative" onClick={() => setActivePane('secondary')}>
                            <MarkdownEditor
                              key={`secondary-${secondaryNote.id}`}
                              title={secondaryNote.title}
                              content={secondaryNote.content}
                              onChangeTitle={(title) => updateNote(secondaryNote.id, { title })}
                              onChangeContent={(content) => updateNote(secondaryNote.id, { content })}
                              readOnly={!!isReadOnlyOffline}
                              notes={notes}
                              onSplit={undefined}
                              onClosePane={() => handleClosePane('secondary')}
                              showCloseButton={!isMobile}
                              isFocused={!isMobile && activePane === 'secondary'}
                              aiPaneOpen={aiPaneOpen}
                              onToggleAIPane={user ? () => setAiPaneOpen(!aiPaneOpen) : undefined}
                              disableAIToggle={true}
                              keybindSplitBlock={user?.keybindSplitBlock}
                              keybindNewLine={user?.keybindNewLine}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <MarkdownEditor
                        key={currentNote.id} // Re-mount on note change to reset scroll
                        title={currentNote.title}
                        content={currentNote.content}
                        onChangeTitle={(title) => updateNote(currentNote.id, { title })}
                        onChangeContent={(content) => updateNote(currentNote.id, { content })}
                        readOnly={!!isReadOnlyOffline}
                        notes={notes}
                        onSplit={handleSplit}
                        showCloseButton={false}
                        isFocused={false}
                        aiPaneOpen={aiPaneOpen}
                        onToggleAIPane={user ? () => setAiPaneOpen(!aiPaneOpen) : undefined}
                        disableAIToggle={splitModalOpen}
                        keybindSplitBlock={user?.keybindSplitBlock}
                        keybindNewLine={user?.keybindNewLine}
                    />
                  )}
                </>
            ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-600">
                    <Network className="w-16 h-16 mb-4 opacity-20" />
                    <p>No note selected</p>
                    <div className="flex gap-4 mt-4">
                        <button 
                            onClick={() => !isReadOnlyOffline && createNote()} 
                            disabled={!!isReadOnlyOffline}
                            className={`px-5 py-2.5 backdrop-blur-md border border-white/10 rounded-lg shadow-lg transition-all ${isReadOnlyOffline ? 'bg-gray-600 cursor-not-allowed opacity-50' : 'bg-obsidian-accent/80 hover:bg-obsidian-accent text-white hover:scale-105'}`}
                        >
                            Create Note
                        </button>
                        <button onClick={() => setViewMode(ViewMode.GRAPH)} className="px-5 py-2.5 bg-obsidian-sidebar/60 border border-obsidian-border/50 rounded-lg shadow-lg hover:bg-obsidian-sidebar/80 transition-all hover:scale-105">
                            View Graph
                        </button>
                    </div>
                </div>
            )}
          </div>
          {aiPaneOpen && user && (
            <div className={`${isMobile ? 'h-1/2 w-full border-t border-obsidian-border/50' : 'w-[400px] h-full flex-shrink-0'}`}>
               <AIPane 
                  user={user} 
                  note={activePane === 'secondary' && secondaryNoteId ? secondaryNote : currentNote} 
                  onClose={() => setAiPaneOpen(false)} 
                  onAppendContent={(content) => {
                     const targetNoteId = activePane === 'secondary' && secondaryNoteId ? secondaryNoteId : currentNoteId;
                     const targetNote = activePane === 'secondary' && secondaryNoteId ? secondaryNote : currentNote;
                     if (targetNoteId && targetNote) {
                        updateNote(targetNoteId, { content: targetNote.content + '\n\n' + content });
                     }
                  }}
                  onUpdateNote={(title, content) => {
                     const targetNoteId = activePane === 'secondary' && secondaryNoteId ? secondaryNoteId : currentNoteId;
                     if (targetNoteId) {
                        const updates: any = {};
                        if (title !== null) updates.title = title;
                        if (content !== null) updates.content = content;
                        updateNote(targetNoteId, updates);
                     }
                  }}
               />
            </div>
          )}
        </div>
      </div>

      <CommandPalette 
        isOpen={commandPaletteOpen} 
        onClose={() => setCommandPaletteOpen(false)} 
        commands={commands} 
      />
      
      {/* Modal Dialog */}
      <SimpleModal 
        isOpen={!!modalState}
        title={modalState?.type === 'create_vault' ? 'Create New Vault' : 'Rename Vault'}
        initialValue={modalState?.initialValue}
        placeholder="Enter vault name..."
        onClose={() => setModalState(null)}
        onConfirm={handleModalConfirm}
      />

      {/* Split Note Selection Modal */}
      {splitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-obsidian-sidebar border border-obsidian-border rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-obsidian-border flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-200">Select Note to Split</h3>
              <button onClick={() => setSplitModalOpen(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-2 overflow-y-auto flex-1">
              {notes.filter(n => n.id !== currentNoteId).length === 0 ? (
                <div className="p-4 text-center text-gray-500">No other notes available</div>
              ) : (
                notes.filter(n => n.id !== currentNoteId).map(note => (
                  <button
                    key={note.id}
                    onClick={() => {
                      setSecondaryNoteId(note.id);
                      setActivePane('secondary');
                      setActiveMobileTab('secondary');
                      setSplitModalOpen(false);
                    }}
                    className="w-full text-left px-4 py-3 rounded-lg hover:bg-obsidian-accent/20 transition-colors text-gray-300 hover:text-white mb-1 flex items-center"
                  >
                    <FileText className="w-4 h-4 mr-3 opacity-50" />
                    <span className="truncate">{note.title || 'Untitled'}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Vault Settings Modal */}
      {user && (
        <VaultSettingsModal
          isOpen={vaultSettingsOpen}
          onClose={() => setVaultSettingsOpen(false)}
          vault={currentGroup ? { id: currentGroup.id, name: currentGroup.name } : null}
          userId={user.id}
          isOwner={currentGroup?.ownerId === user.id}
          onRename={async (name) => {
            if (!currentGroup) return;
            await db.updateGroup(currentGroup.id, { name });
            setGroups(prev => prev.map(g => g.id === currentGroup.id ? { ...g, name } : g));
          }}
          onExport={handleExportVault}
          onImportClick={() => importFileRef.current?.click()}
          isImporting={isImporting}
          sharing={currentGroup?.joinCode ? { joinCode: currentGroup.joinCode, joinEnabled: currentGroup.joinEnabled !== false } : null}
          onUpdateSharing={async (change) => {
            if (!currentGroup) return;
            const res = await db.updateSharing(currentGroup.id, change);
            setGroups(prev => prev.map(g => g.id === currentGroup.id ? { ...g, joinCode: res.joinCode, joinEnabled: res.joinEnabled } : g));
          }}
        />
      )}

      {/* Account Settings Modal */}
      {user && (
        <AccountSettingsModal
          isOpen={settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
          user={user}
          onUserUpdate={(updated) => setUser(updated)}
        />
      )}

      {/* Admin Panel Modal */}
      {user?.isAdmin && (
        <AdminPanelModal
          isOpen={adminModalOpen}
          onClose={() => setAdminModalOpen(false)}
        />
      )}

      {/* Swipe-right hint pill — visible on mobile when sidebar is closed */}
      {isMobile && !sidebarOpen && (
        <div
          className="fixed left-0 top-1/2 -translate-y-1/2 w-1 h-14 rounded-r-full z-30 pointer-events-none animate-pulse"
          style={{ background: 'var(--color-obsidian-accent, #7c6af7)', opacity: 0.45 }}
          aria-hidden="true"
        />
      )}
    </div>
  );
};

export default App;