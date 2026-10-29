import React, { useState, useEffect } from 'react';
import { Settings, Check, X, Loader2, Key, Copy, Shield, Clock, AlertTriangle, Download, Upload } from 'lucide-react';
import { ApiToken } from '../../types';
import * as db from '../../services/storage';

// --- Vault Settings Modal ---
const VaultSettingsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  vault: { id: string; name: string } | null;
  userId: string;
  isOwner: boolean;
  onRename: (name: string) => Promise<void>;
  onExport: () => Promise<void>;
  onImportClick: () => void;
  isImporting: boolean;
  sharing?: { joinCode: string; joinEnabled: boolean } | null;
  onUpdateSharing?: (change: { enabled?: boolean; rotate?: boolean }) => Promise<void>;
}> = ({ isOpen, onClose, vault, userId, isOwner, onRename, onExport, onImportClick, isImporting, sharing, onUpdateSharing }) => {
  const [sharingBusy, setSharingBusy] = useState(false);
  const [sharingError, setSharingError] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);
  const changeSharing = async (change: { enabled?: boolean; rotate?: boolean }) => {
    if (!onUpdateSharing) return;
    setSharingBusy(true);
    setSharingError('');
    try { await onUpdateSharing(change); } catch (e: any) { setSharingError(e.message || 'Could not update sharing'); } finally { setSharingBusy(false); }
  };
  const [tab, setTab] = useState<'general' | 'tokens'>('general');
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameSuccess, setRenameSuccess] = useState(false);
  // Token state (mirror of TokenManagementModal)
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [newTokenRevealed, setNewTokenRevealed] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [tokenPermissions, setTokenPermissions] = useState<string[]>(['read']);
  const [generating, setGenerating] = useState(false);
  const [tokenError, setTokenError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setNewName(vault?.name ?? '');
      setRenameSuccess(false);
      setTab('general');
    }
  }, [isOpen, vault]);

  useEffect(() => {
    if (isOpen && tab === 'tokens' && isOwner && vault) {
      loadTokens();
    }
  }, [isOpen, tab]);

  const loadTokens = async () => {
    if (!vault) return;
    setTokenLoading(true);
    try {
      const result = await db.listVaultTokens(vault.id, userId);
      setTokens(result);
    } catch (e: any) { setTokenError(e.message); }
    finally { setTokenLoading(false); }
  };

  const handleRename = async () => {
    if (!newName.trim() || !vault) return;
    setRenaming(true);
    await onRename(newName.trim());
    setRenaming(false);
    setRenameSuccess(true);
    setTimeout(() => setRenameSuccess(false), 2000);
  };

  const handleGenerate = async () => {
    if (!vault) return;
    setGenerating(true);
    setTokenError('');
    try {
      const result = await db.generateVaultToken(vault.id, userId, {
        name: tokenName || undefined,
        permissions: tokenPermissions,
      });
      setNewTokenRevealed(result.token);
      setTokenName('');
      setTokenPermissions(['read']);
      loadTokens();
    } catch (e: any) { setTokenError(e.message); }
    finally { setGenerating(false); }
  };

  const handleRevoke = async (tokenId: number) => {
    if (!vault || !window.confirm('Revoke this token?')) return;
    try {
      await db.revokeVaultToken(vault.id, tokenId, userId);
      loadTokens();
    } catch (e: any) { setTokenError(e.message); }
  };

  const copyToken = async (text: string) => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement('textarea');
      t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
    }
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  const togglePermission = (perm: string) =>
    setTokenPermissions(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]);

  if (!isOpen || !vault) return null;

  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'tokens', label: 'API Tokens' },
  ] as const;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-obsidian-sidebar/90 backdrop-blur-2xl border border-obsidian-border/50 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-obsidian-border/50 bg-white/5">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-obsidian-accent" />
            <h3 className="text-lg font-bold text-white">Vault Settings</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-obsidian-border/50">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                tab === t.id
                  ? 'text-obsidian-accent border-b-2 border-obsidian-accent bg-obsidian-accent/5'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5 max-h-[65vh] overflow-y-auto">
          {/* --- General Tab --- */}
          {tab === 'general' && (
            <div className="space-y-6">
              {/* Rename */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Vault Name</h4>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-white text-sm focus:border-obsidian-accent focus:outline-none"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                    placeholder="Vault name..."
                  />
                  <button
                    onClick={handleRename}
                    disabled={renaming || newName.trim() === vault.name || !newName.trim()}
                    className="px-4 py-2 bg-obsidian-accent text-white rounded-lg text-sm font-bold hover:bg-opacity-90 transition disabled:opacity-40 flex items-center gap-2"
                  >
                    {renaming ? <Loader2 className="w-4 h-4 animate-spin" /> : renameSuccess ? <Check className="w-4 h-4" /> : null}
                    {renameSuccess ? 'Saved' : 'Rename'}
                  </button>
                </div>
              </div>

              {isOwner && sharing && (
                <>
                  <div className="border-t border-obsidian-border/30" />
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Sharing</h4>
                    <p className="text-xs text-gray-500">Anyone signed in who has this code can join the vault as a member.</p>
                    <div className="flex items-center gap-2">
                      <code className={`flex-1 bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-sm font-mono select-all ${sharing.joinEnabled ? 'text-white' : 'text-gray-600 line-through'}`}>{sharing.joinCode}</code>
                      <button
                        disabled={!sharing.joinEnabled}
                        onClick={async () => { await navigator.clipboard.writeText(sharing.joinCode); setCodeCopied(true); setTimeout(() => setCodeCopied(false), 1500); }}
                        className="p-2.5 bg-white/10 rounded-lg text-gray-300 hover:text-white disabled:opacity-40"
                        title="Copy share code"
                      >{codeCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}</button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input type="checkbox" checked={sharing.joinEnabled} disabled={sharingBusy} onChange={e => changeSharing({ enabled: e.target.checked })} />
                        Allow joining with this code
                      </label>
                      <button
                        disabled={sharingBusy}
                        onClick={() => { if (window.confirm('Generate a new code? The old code stops working immediately. Current members keep their access.')) changeSharing({ rotate: true }); }}
                        className="text-xs text-obsidian-accent hover:text-white disabled:opacity-40"
                      >Generate new code</button>
                    </div>
                    {sharingError && <p className="text-xs text-red-400">{sharingError}</p>}
                  </div>
                </>
              )}

              {/* Divider */}
              <div className="border-t border-obsidian-border/30" />

              {/* Export & Import */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Backup & Restore</h4>
                <p className="text-xs text-gray-500">Export this vault as a portable JSON file, or import one to create a new vault.</p>
                <div className="flex flex-col gap-2 mt-3">
                  <button
                    onClick={async () => { await onExport(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-obsidian-border/40 rounded-xl text-sm text-gray-200 font-medium transition-colors"
                  >
                    <Download className="w-4 h-4 text-obsidian-accent flex-shrink-0" />
                    <div className="text-left">
                      <div className="font-semibold">Export Vault</div>
                      <div className="text-xs text-gray-500">Download this vault as a .json backup file</div>
                    </div>
                  </button>
                  <button
                    onClick={() => { onClose(); setTimeout(onImportClick, 50); }}
                    disabled={isImporting}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-obsidian-border/40 rounded-xl text-sm text-gray-200 font-medium transition-colors disabled:opacity-50"
                  >
                    {isImporting
                      ? <Loader2 className="w-4 h-4 text-obsidian-accent animate-spin flex-shrink-0" />
                      : <Upload className="w-4 h-4 text-obsidian-accent flex-shrink-0" />}
                    <div className="text-left">
                      <div className="font-semibold">{isImporting ? 'Importing...' : 'Import Vault'}</div>
                      <div className="text-xs text-gray-500">Load a backup file to create a new vault</div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* --- API Tokens Tab --- */}
          {tab === 'tokens' && (
            <div className="space-y-5">
              {!isOwner ? (
                <p className="text-gray-500 text-sm text-center py-6">Only the vault owner can manage API tokens.</p>
              ) : (
                <>
                  {newTokenRevealed && (
                    <div className="bg-emerald-900/40 border border-emerald-500/50 rounded-xl p-4 space-y-3">
                      <div className="flex items-center gap-2 text-emerald-400 text-sm font-bold">
                        <AlertTriangle className="w-4 h-4" />
                        Copy now — it won't be shown again
                      </div>
                      <div className="flex items-center gap-2 bg-black/40 rounded-lg p-3">
                        <code className="text-emerald-300 text-xs flex-1 break-all font-mono select-all">{newTokenRevealed}</code>
                        <button
                          onClick={() => copyToken(newTokenRevealed)}
                          className={`p-2 rounded-lg transition-colors flex-shrink-0 ${tokenCopied ? 'bg-emerald-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                        >
                          {tokenCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                      <button onClick={() => setNewTokenRevealed(null)} className="text-xs text-emerald-500 hover:text-emerald-400">
                        I've copied it — dismiss
                      </button>
                    </div>
                  )}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Generate New Token</h4>
                    <input
                      className="w-full bg-obsidian-bg/50 border border-obsidian-border/50 rounded-lg p-2.5 text-white text-sm focus:border-obsidian-accent focus:outline-none placeholder-gray-500"
                      placeholder="Token name (e.g. n8n Integration)"
                      value={tokenName}
                      onChange={(e) => setTokenName(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      {['read', 'write', 'delete', 'admin'].map(perm => (
                        <button
                          key={perm}
                          onClick={() => togglePermission(perm)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                            tokenPermissions.includes(perm)
                              ? 'bg-obsidian-accent/30 border-obsidian-accent text-obsidian-accent'
                              : 'bg-white/5 border-obsidian-border/50 text-gray-500 hover:text-gray-300'
                          }`}
                        >{perm}</button>
                      ))}
                    </div>
                    <button
                      onClick={handleGenerate}
                      disabled={generating || tokenPermissions.length === 0}
                      className="w-full py-2.5 bg-obsidian-accent text-white rounded-lg text-sm font-bold hover:bg-opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                      Generate Token
                    </button>
                  </div>
                  {tokenError && <p className="text-red-400 text-sm bg-red-900/20 p-2 rounded">{tokenError}</p>}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Active Tokens</h4>
                    {tokenLoading ? (
                      <div className="flex justify-center p-6"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>
                    ) : tokens.filter(t => t.isActive).length === 0 ? (
                      <p className="text-gray-600 text-sm text-center py-4">No active tokens</p>
                    ) : (
                      tokens.filter(t => t.isActive).map(token => (
                        <div key={token.id} className="bg-white/5 border border-obsidian-border/30 rounded-xl p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Shield className="w-4 h-4 text-obsidian-accent" />
                              <span className="text-sm font-bold text-white">{token.name || 'Unnamed Token'}</span>
                            </div>
                            <button
                              onClick={() => handleRevoke(token.id)}
                              className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 px-2 py-1 rounded"
                            >Revoke</button>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <code className="text-gray-400 font-mono">{token.tokenPrefix}...</code>
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(token.createdAt).toLocaleDateString()}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {token.permissions.map(p => (
                              <span key={p} className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-obsidian-accent/15 text-obsidian-accent rounded">{p}</span>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VaultSettingsModal;
