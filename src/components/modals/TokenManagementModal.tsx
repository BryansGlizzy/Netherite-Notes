import React, { useState, useEffect } from 'react';
import { Check, X, Loader2, Key, Copy, Shield, Clock, AlertTriangle } from 'lucide-react';
import { ApiToken } from '../../types';
import * as db from '../../services/storage';

// --- Token Management Modal ---
const TokenManagementModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  userId: string;
  isOwner: boolean;
}> = ({ isOpen, onClose, groupId, userId, isOwner }) => {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTokenRevealed, setNewTokenRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [tokenPermissions, setTokenPermissions] = useState<string[]>(['read']);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && isOwner) {
      loadTokens();
    }
  }, [isOpen]);

  const loadTokens = async () => {
    setLoading(true);
    try {
      const result = await db.listVaultTokens(groupId, userId);
      setTokens(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const result = await db.generateVaultToken(groupId, userId, {
        name: tokenName || undefined,
        permissions: tokenPermissions,
      });
      setNewTokenRevealed(result.token);
      setTokenName('');
      setTokenPermissions(['read']);
      loadTokens();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (tokenId: number) => {
    if (!window.confirm('Revoke this token? Any integration using it will immediately lose access.')) return;
    try {
      await db.revokeVaultToken(groupId, tokenId, userId);
      loadTokens();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const copyToken = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setNewTokenRevealed(null); // Wipe token from state on close
    setCopied(false);
    setError('');
    onClose();
  };

  const togglePermission = (perm: string) => {
    setTokenPermissions(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-obsidian-sidebar/90 backdrop-blur-2xl border border-obsidian-border/50 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-obsidian-border/50 bg-white/5">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-obsidian-accent" />
            <h3 className="text-lg font-bold text-white">API Tokens</h3>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-5">
          {/* Token Reveal Banner */}
          {newTokenRevealed && (
            <div className="bg-emerald-900/40 border border-emerald-500/50 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-bold">
                <AlertTriangle className="w-4 h-4" />
                Copy this token now — it won't be shown again
              </div>
              <div className="flex items-center gap-2 bg-black/40 rounded-lg p-3">
                <code className="text-emerald-300 text-xs flex-1 break-all font-mono select-all">{newTokenRevealed}</code>
                <button
                  onClick={() => copyToken(newTokenRevealed)}
                  className={`p-2 rounded-lg transition-colors flex-shrink-0 ${copied ? 'bg-emerald-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={() => setNewTokenRevealed(null)}
                className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
              >
                I've copied it — dismiss
              </button>
            </div>
          )}

          {/* Generate New Token */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-gray-300 uppercase tracking-wide">Generate New Token</h4>
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
                >
                  {perm}
                </button>
              ))}
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating || tokenPermissions.length === 0}
              className="w-full py-2.5 bg-obsidian-accent text-white rounded-lg text-sm font-bold hover:bg-opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
              Generate Token
            </button>
          </div>

          {error && <p className="text-red-400 text-sm bg-red-900/20 p-2 rounded">{error}</p>}

          {/* Existing Tokens */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-gray-300 uppercase tracking-wide">Active Tokens</h4>
            {loading ? (
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
                      className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 px-2 py-1 rounded transition-colors"
                    >
                      Revoke
                    </button>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <code className="text-gray-400 font-mono">{token.tokenPrefix}...</code>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(token.createdAt).toLocaleDateString()}</span>
                    {token.lastUsedAt && <span>Last used: {new Date(token.lastUsedAt).toLocaleDateString()}</span>}
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
        </div>
      </div>
    </div>
  );
};

export default TokenManagementModal;
