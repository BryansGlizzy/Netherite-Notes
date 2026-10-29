import React, { useState, useEffect } from 'react';
import { Settings, Check, X, Loader2, Key } from 'lucide-react';
import { User } from '../../types';
import * as db from '../../services/storage';
import { MIN_PASSWORD_LENGTH } from '../../constants';

// --- Account Settings Modal ---
const AccountSettingsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onUserUpdate: (user: User) => void;
}> = ({ isOpen, onClose, user, onUserUpdate }) => {
  const [username, setUsername] = useState(user.username);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  // AI Settings State
  const [aiEndpoint, setAiEndpoint] = useState(user.aiEndpoint || '');
  // The saved key is never sent to the browser with the profile; this field only holds a NEW key the user types.
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiKeyDirty, setAiKeyDirty] = useState(false);
  const [aiModel, setAiModel] = useState(user.aiModel || '');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  // Keybind Settings State
  const [keybindSplitBlock, setKeybindSplitBlock] = useState(user.keybindSplitBlock || 'Enter');
  const [keybindNewLine, setKeybindNewLine] = useState(user.keybindNewLine || 'Shift+Enter');

  const handleFetchModels = async () => {
    if (!aiEndpoint) {
      setError('Please provide an endpoint to fetch models from');
      return;
    }
    setFetchingModels(true);
    setError('');
    setSuccess('');
    try {
      const url = aiEndpoint.replace(/\/$/, '') + '/v1/models';
      // use the key typed in this form, else the stored one (fetched on demand)
      const key = aiKeyDirty ? aiApiKey : user.hasAiApiKey ? (await db.fetchAiConfig(user.id)).aiApiKey : '';
      const res = await fetch(url, {
        headers: key ? { 'Authorization': `Bearer ${key}` } : {}
      });
      if (!res.ok) throw new Error('Failed to fetch models');
      const data = await res.json();
      if (data.data && Array.isArray(data.data)) {
        setAvailableModels(data.data.map((m: any) => m.id));
        setSuccess('Models fetched successfully');
      } else {
         throw new Error('Unexpected response format');
      }
    } catch (e: any) {
      setError(`Model fetch error: ${e.message}`);
    } finally {
      setFetchingModels(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setUsername(user.username);
      setCurrentPassword('');
      setNewPassword('');
      setEmail('');
      setAiEndpoint(user.aiEndpoint || '');
      setAiApiKey('');
      setAiKeyDirty(false);
      setAiModel(user.aiModel || '');
      setKeybindSplitBlock(user.keybindSplitBlock || 'Enter');
      setKeybindNewLine(user.keybindNewLine || 'Shift+Enter');
      setAvailableModels([]);
      setError('');
      setSuccess('');
    }
  }, [isOpen, user]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const updates: any = {};
      if (username !== user.username) updates.username = username;
      if (newPassword) {
        if (newPassword.length < MIN_PASSWORD_LENGTH) { setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`); setSaving(false); return; }
        updates.currentPassword = currentPassword;
        updates.newPassword = newPassword;
      }
      if (email && !user.email) updates.email = email;

      if (aiEndpoint !== (user.aiEndpoint || '')) updates.aiEndpoint = aiEndpoint;
      if (aiKeyDirty) updates.aiApiKey = aiApiKey; // empty string clears the stored key
      if (aiModel !== (user.aiModel || '')) updates.aiModel = aiModel;
      
      if (keybindSplitBlock !== (user.keybindSplitBlock || 'Enter')) updates.keybindSplitBlock = keybindSplitBlock;
      if (keybindNewLine !== (user.keybindNewLine || 'Shift+Enter')) updates.keybindNewLine = keybindNewLine;

      if (Object.keys(updates).length === 0) {
        setError('No changes to save');
        setSaving(false);
        return;
      }

      const updated = await db.updateUserSettings(user.id, updates);
      setSuccess('Settings updated!');
      onUserUpdate({ ...user, username: updated.username, email: updated.email, isAdmin: updated.isAdmin, token: updated.token, emailVerified: updated.emailVerified, aiEndpoint: updated.aiEndpoint, hasAiApiKey: updated.hasAiApiKey, aiModel: updated.aiModel, keybindSplitBlock: updated.keybindSplitBlock, keybindNewLine: updated.keybindNewLine });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-obsidian-sidebar/90 backdrop-blur-2xl border border-obsidian-border/50 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-obsidian-border/50 bg-white/5">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-obsidian-accent" />
            <h3 className="text-lg font-bold text-white">Account Settings</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Username */}
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-1">Username</label>
            <input 
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-white text-sm focus:border-obsidian-accent focus:outline-none"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-1">Email</label>
            {user.email ? (
              <div className="bg-obsidian-bg/30 border border-obsidian-border/30 rounded-lg p-2.5 text-gray-400 text-sm">{user.email}</div>
            ) : (
              <>
                <input 
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Set an email for password recovery"
                  className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-white text-sm focus:border-obsidian-accent focus:outline-none placeholder-gray-500"
                />
                <p className="text-xs text-gray-600 mt-1">Legacy account — set an email to enable password reset</p>
              </>
            )}
          </div>

          {/* Change Password */}
          <div className="border-t border-obsidian-border/30 pt-4">
            <label className="block text-sm font-bold text-gray-300 mb-2">Change Password</label>
            <input 
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-white text-sm focus:border-obsidian-accent focus:outline-none mb-2 placeholder-gray-500"
            />
            <input 
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="New password (10+ characters)"
              autoComplete="new-password"
              className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-white text-sm focus:border-obsidian-accent focus:outline-none placeholder-gray-500"
            />
          </div>

          {/* AI Settings */}
          <div className="border-t border-obsidian-border/30 pt-4 space-y-3">
            <h4 className="text-sm font-bold text-gray-300">AI Integration</h4>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">OpenAI-Compatible Endpoint</label>
              <input 
                value={aiEndpoint}
                onChange={e => setAiEndpoint(e.target.value)}
                placeholder="e.g., https://api.openai.com or http://localhost:11434"
                className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-white text-sm focus:border-obsidian-accent focus:outline-none placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">API Key</label>
              <input 
                type="password"
                value={aiApiKey}
                onChange={e => { setAiApiKey(e.target.value); setAiKeyDirty(true); }}
                autoComplete="off"
                placeholder={user.hasAiApiKey && !aiKeyDirty ? '•••••••• saved — type to replace' : 'Optional for local models'}
                className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-white text-sm focus:border-obsidian-accent focus:outline-none placeholder-gray-500"
              />
            </div>
            {user.hasAiApiKey && !aiKeyDirty && (
              <button type="button" onClick={() => { setAiApiKey(''); setAiKeyDirty(true); }} className="text-xs text-red-400 hover:text-red-300 -mt-1">
                Remove saved API key
              </button>
            )}
            {aiKeyDirty && aiApiKey === '' && user.hasAiApiKey && <p className="text-xs text-amber-400 -mt-1">The saved key will be removed when you save.</p>}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-gray-400">Model Name</label>
                <button 
                  onClick={handleFetchModels}
                  disabled={fetchingModels || !aiEndpoint}
                  className="text-xs text-obsidian-accent hover:text-white transition disabled:opacity-50"
                >
                  {fetchingModels ? 'Fetching...' : 'Fetch Models'}
                </button>
              </div>
              {availableModels.length > 0 ? (
                <select
                  value={aiModel}
                  onChange={e => setAiModel(e.target.value)}
                  className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-white text-sm focus:border-obsidian-accent focus:outline-none"
                >
                  <option value="">Select a model</option>
                  {availableModels.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input 
                  value={aiModel}
                  onChange={e => setAiModel(e.target.value)}
                  placeholder="e.g., gpt-4o"
                  className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-white text-sm focus:border-obsidian-accent focus:outline-none placeholder-gray-500"
                />
              )}
            </div>
          </div>

          {/* Keybind Settings */}
          <div className="border-t border-obsidian-border/30 pt-4 space-y-3">
            <h4 className="text-sm font-bold text-gray-300">Editor Keybinds</h4>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">Split Block</label>
              <input
                value={keybindSplitBlock}
                readOnly
                onKeyDown={(e) => {
                  e.preventDefault();
                  const keys = [];
                  if (e.ctrlKey) keys.push('Ctrl');
                  if (e.altKey) keys.push('Alt');
                  if (e.shiftKey && e.key !== 'Shift') keys.push('Shift');
                  if (e.metaKey) keys.push('Cmd');
                  
                  const key = e.key;
                  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
                    let keyName = key;
                    if (keyName === ' ') keyName = 'Space';
                    else if (keyName.length === 1) keyName = keyName.toUpperCase();
                    keys.push(keyName);
                    setKeybindSplitBlock(keys.join('+'));
                  }
                }}
                placeholder="Click and press keys..."
                className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-white text-sm focus:border-obsidian-accent focus:outline-none cursor-pointer placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">New Line (Soft Break)</label>
              <input
                value={keybindNewLine}
                readOnly
                onKeyDown={(e) => {
                  e.preventDefault();
                  const keys = [];
                  if (e.ctrlKey) keys.push('Ctrl');
                  if (e.altKey) keys.push('Alt');
                  if (e.shiftKey && e.key !== 'Shift') keys.push('Shift');
                  if (e.metaKey) keys.push('Cmd');
                  
                  const key = e.key;
                  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
                    let keyName = key;
                    if (keyName === ' ') keyName = 'Space';
                    else if (keyName.length === 1) keyName = keyName.toUpperCase();
                    keys.push(keyName);
                    setKeybindNewLine(keys.join('+'));
                  }
                }}
                placeholder="Click and press keys..."
                className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-white text-sm focus:border-obsidian-accent focus:outline-none cursor-pointer placeholder-gray-500"
              />
            </div>
          </div>

          {error && <p className="text-red-400 text-sm bg-red-900/20 p-2 rounded">{error}</p>}
          {success && <p className="text-emerald-400 text-sm bg-emerald-900/20 p-2 rounded">{success}</p>}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 bg-obsidian-accent text-white rounded-lg text-sm font-bold hover:bg-opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountSettingsModal;
