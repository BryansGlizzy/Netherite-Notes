import React, { useState, useEffect } from 'react';
import { X, Loader2, Shield } from 'lucide-react';
import * as db from '../../services/storage';
import AdminActivity from './AdminActivity';

// --- Admin Panel Modal ---
const AdminPanelModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    try {
      const list = await db.adminListUsers();
      setUsers(list);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadUsers();
      setError('');
      setSuccess('');
      setEditingUser(null);
    }
  }, [isOpen]);

  const handleEdit = (u: any) => {
    setEditingUser(u);
    setEditUsername(u.username);
    setEditEmail(u.email || '');
    setEditPassword('');
    setError('');
    setSuccess('');
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    setError('');
    try {
      const updates: any = {};
      if (editUsername !== editingUser.username) updates.username = editUsername;
      if (editEmail !== (editingUser.email || '')) updates.email = editEmail || null;
      if (editPassword) updates.newPassword = editPassword;
      await db.adminUpdateUser(editingUser.id, updates);
      setSuccess(`Updated ${editUsername}`);
      setEditingUser(null);
      loadUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (userId: string, username: string) => {
    setError('');
    try {
      await db.adminDeleteUser(userId);
      setSuccess(`Deleted ${username}`);
      setConfirmDeleteId(null);
      loadUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-obsidian-sidebar/90 backdrop-blur-2xl border border-obsidian-border/50 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-obsidian-border/50 bg-white/5">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-400" />
            <h3 className="text-lg font-bold text-white">Admin Panel</h3>
            <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-bold">ADMIN</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-900/20 p-2 rounded">{error}</p>}
          {success && <p className="text-emerald-400 text-sm bg-emerald-900/20 p-2 rounded">{success}</p>}

          {/* Edit Form */}
          {editingUser && (
            <div className="bg-white/5 border border-obsidian-border/50 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-bold text-white">Editing: {editingUser.username}</h4>
              <input 
                value={editUsername}
                onChange={e => setEditUsername(e.target.value)}
                placeholder="Username"
                className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2 text-white text-sm focus:border-obsidian-accent focus:outline-none"
              />
              <input 
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                placeholder="Email"
                className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2 text-white text-sm focus:border-obsidian-accent focus:outline-none"
              />
              <input 
                type="password"
                value={editPassword}
                onChange={e => setEditPassword(e.target.value)}
                placeholder="New password (leave empty to keep)"
                className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2 text-white text-sm focus:border-obsidian-accent focus:outline-none"
              />
              <div className="flex gap-2">
                <button onClick={handleSaveEdit} className="px-4 py-2 bg-obsidian-accent text-white rounded-lg text-sm font-bold hover:bg-opacity-90 transition">Save</button>
                <button onClick={() => setEditingUser(null)} className="px-4 py-2 bg-white/10 text-gray-300 rounded-lg text-sm hover:bg-white/20 transition">Cancel</button>
              </div>
            </div>
          )}

          {/* Users List */}
          {loading ? (
            <div className="flex justify-center p-6"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>
          ) : (
            <div className="space-y-2">
              {users.map(u => (
                <div key={u.id} className="bg-white/5 border border-obsidian-border/30 rounded-xl p-3 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{u.username}</span>
                      {u.isAdmin && <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold">ADMIN</span>}
                      {u.email && !u.emailVerified && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold">UNVERIFIED</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {u.email || <span className="italic text-gray-600">no email</span>}
                      {' · '}{u.noteCount} notes · {u.groups?.length || 0} vaults
                    </div>
                  </div>
                  <div className="flex gap-1 ml-2">
                    <button onClick={() => handleEdit(u)} className="px-2 py-1 text-xs bg-white/10 text-gray-300 rounded hover:bg-white/20 transition">Edit</button>
                    {confirmDeleteId === u.id ? (
                      <>
                        <button onClick={() => handleDelete(u.id, u.username)} className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition font-bold">Confirm?</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 text-xs bg-white/10 text-gray-400 rounded hover:bg-white/20 transition">Cancel</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(u.id)} className="px-2 py-1 text-xs bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 transition">Delete</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <AdminActivity />
        </div>
      </div>
    </div>
  );
};

export default AdminPanelModal;
