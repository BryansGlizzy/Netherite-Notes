import React, { useEffect, useState } from 'react';
import { Loader2, Copy, Check } from 'lucide-react';
import * as db from '../../services/storage';

// Invite codes (for REGISTRATION=invite servers) and the recent security activity log.
const when = (ts: number) => new Date(ts).toLocaleString();

const AdminActivity: React.FC = () => {
  const [invites, setInvites] = useState<db.AdminInvite[]>([]);
  const [events, setEvents] = useState<db.AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [i, e] = await Promise.all([db.adminListInvites(), db.adminListAudit(50)]);
      setInvites(i);
      setEvents(e);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const createInvite = async () => {
    setError('');
    try {
      const inv = await db.adminCreateInvite(7);
      setNewCode(inv.code);
      setCopied(false);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const copy = async () => {
    if (!newCode) return;
    await navigator.clipboard.writeText(newCode);
    setCopied(true);
  };

  if (loading) return <div className="flex justify-center p-4"><Loader2 className="w-4 h-4 animate-spin text-gray-500" /></div>;

  return (
    <div className="space-y-4 border-t border-obsidian-border/30 pt-4">
      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-white">Invite codes</h4>
          <button onClick={createInvite} className="px-3 py-1 text-xs bg-obsidian-accent text-white rounded-lg font-bold hover:bg-opacity-90 transition">New invite (7 days)</button>
        </div>
        {newCode && (
          <div className="mb-2 p-2 bg-emerald-900/20 border border-emerald-500/30 rounded-lg text-xs">
            <div className="text-emerald-300 mb-1">Copy it now — it is shown only once:</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all text-white">{newCode}</code>
              <button onClick={copy} className="p-1 text-gray-300 hover:text-white">{copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}</button>
            </div>
          </div>
        )}
        {invites.length === 0 ? <p className="text-xs text-gray-600 italic">No invites yet. They are only required when the server runs with REGISTRATION=invite.</p> : (
          <div className="space-y-1">
            {invites.map(i => (
              <div key={i.id} className="flex items-center justify-between text-xs bg-white/5 rounded-lg px-3 py-1.5">
                <span className="text-gray-300"><code>{i.codePrefix}…</code> · {i.usedAt ? <>used by <b>{i.usedByName || 'deleted user'}</b></> : i.expiresAt && i.expiresAt < Date.now() ? 'expired' : i.expiresAt ? `expires ${when(i.expiresAt)}` : 'no expiry'}</span>
                {!i.usedAt && <button onClick={async () => { await db.adminDeleteInvite(i.id); load(); }} className="text-red-400 hover:text-red-300">Revoke</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-sm font-bold text-white mb-2">Recent activity</h4>
        {events.length === 0 ? <p className="text-xs text-gray-600 italic">Nothing recorded yet.</p> : (
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {events.map(e => (
              <div key={e.id} className="text-xs bg-white/5 rounded-lg px-3 py-1.5 flex flex-wrap gap-x-2">
                <span className="text-gray-500">{when(e.ts)}</span>
                <span className={`font-semibold ${e.action.includes('failed') ? 'text-amber-400' : 'text-gray-200'}`}>{e.action}</span>
                {e.actorName && <span className="text-gray-400">by {e.actorName}</span>}
                {e.target && <span className="text-gray-500">→ {e.target}</span>}
                {e.ip && <span className="text-gray-600">{e.ip}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminActivity;
