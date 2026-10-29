import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { User } from '../../types';
import * as db from '../../services/storage';
import { USERNAME_PATTERN, MIN_PASSWORD_LENGTH } from '../../constants';

import { URL_TOKENS } from '../../lib/urlTokens';

// --- Auth Component (Internal) ---
const INITIAL_RESET_TOKEN: string = URL_TOKENS.reset;

const AuthScreen: React.FC<{ onLogin: (user: User) => void }> = ({ onLogin }) => {
  type AuthMode = 'login' | 'register' | 'forgot' | 'reset';
  const [mode, setMode] = useState<AuthMode>(INITIAL_RESET_TOKEN ? 'reset' : 'login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [registration, setRegistration] = useState<db.RegistrationMode>('open');

  useEffect(() => {
    db.getAuthConfig().then(c => setRegistration(c.registration)).catch(() => {});
  }, []);
  const [resetToken] = useState(INITIAL_RESET_TOKEN);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (mode === 'register') {
        if (!username.trim() || !password.trim()) { setError('Username and password are required'); return; }
        if (!USERNAME_PATTERN.test(username)) { setError('Username must be 3-32 characters: letters, digits, dot, underscore or hyphen'); return; }
        if (password.length < MIN_PASSWORD_LENGTH) { setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`); return; }
        if (registration === 'closed') { setError('Registration is closed on this server'); return; }
        if (registration === 'invite' && !inviteCode.trim()) { setError('An invite code is required to sign up'); return; }
        const newUser = await db.registerUser(username, password, email || undefined, inviteCode.trim() || undefined);
        db.setSession(newUser.id);
        onLogin(newUser);
      } else if (mode === 'login') {
        if (!username.trim() || !password.trim()) { setError('Username and password are required'); return; }
        const user = await db.loginUser(username, password);
        db.setSession(user.id);
        onLogin(user);
      } else if (mode === 'forgot') {
        if (!email.trim()) { setError('Email is required'); return; }
        await db.forgotPassword(email);
        setSuccess('If an account with that email exists, a reset link has been sent.');
      } else if (mode === 'reset') {
        if (!password.trim() || password !== confirmPassword) { setError('Passwords must match'); return; }
        if (password.length < MIN_PASSWORD_LENGTH) { setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`); return; }
        await db.resetPassword(resetToken, password);
        setSuccess('Password reset! You can now log in.');
        setTimeout(() => setMode('login'), 2000);
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const titles: Record<AuthMode, string> = {
    login: 'Open Vault',
    register: 'Create Vault',
    forgot: 'Forgot Password',
    reset: 'Reset Password',
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-obsidian-bg text-obsidian-text">
      <div className="w-full max-w-md p-8 bg-obsidian-sidebar/60 backdrop-blur-xl rounded-2xl shadow-2xl border border-obsidian-border/50">
        <h1 className="text-3xl font-bold mb-2 text-center text-obsidian-accent drop-shadow-md">Netherite Notes</h1>
        <p className="text-center text-gray-500 text-sm mb-6">{titles[mode]}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {(mode === 'login' || mode === 'register') && (
            <div>
              <label className="block text-sm font-medium mb-1">{mode === 'login' ? 'Username or Email' : 'Username'}</label>
              <input 
                type="text" 
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full p-3 rounded-lg bg-obsidian-bg/50 border border-obsidian-border/50 focus:border-obsidian-accent focus:outline-none shadow-inner"
                placeholder={mode === 'login' ? 'Username or email' : 'Enter username'}
              />
            </div>
          )}
          {mode === 'register' && registration === 'invite' && (
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-300">Invite code</label>
              <input
                type="text"
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                className="w-full p-3 rounded-lg bg-obsidian-bg/50 border border-obsidian-border/50 focus:border-obsidian-accent focus:outline-none shadow-inner"
                placeholder="Paste your invite code"
                autoComplete="off"
              />
            </div>
          )}
          {mode === 'register' && registration === 'closed' && (
            <p className="text-amber-400 text-sm">Registration is closed on this server. Ask the administrator for access.</p>
          )}
          {(mode === 'register' || mode === 'forgot') && (
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-300">Email {mode === 'register' && <span className="text-gray-600">(optional)</span>}</label>
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full p-3 rounded-lg bg-obsidian-bg/50 border border-obsidian-border/50 focus:border-obsidian-accent focus:outline-none shadow-inner"
                placeholder="Enter email"
              />
            </div>
          )}
          {mode !== 'forgot' && (
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-300">
                {mode === 'reset' ? 'New Password' : 'Password'}
              </label>
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full p-3 rounded-lg bg-obsidian-bg/50 border border-obsidian-border/50 focus:border-obsidian-accent focus:outline-none shadow-inner"
                placeholder={mode === 'reset' ? 'New password (10+ characters)' : mode === 'register' ? 'Password (10+ characters)' : 'Enter password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>
          )}
          {mode === 'reset' && (
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-300">Confirm Password</label>
              <input 
                type="password" 
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full p-3 rounded-lg bg-obsidian-bg/50 border border-obsidian-border/50 focus:border-obsidian-accent focus:outline-none shadow-inner"
                placeholder="Confirm password"
              />
            </div>
          )}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {success && <p className="text-emerald-400 text-sm">{success}</p>}
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-obsidian-accent hover:bg-opacity-90 py-2 rounded font-bold text-white transition disabled:opacity-50 flex justify-center"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : titles[mode]}
          </button>
        </form>
        <div className="mt-4 text-center space-y-2">
          {mode === 'login' && (
            <>
              <button 
                onClick={() => { setMode('register'); setError(''); setSuccess(''); }}
                className="text-sm text-gray-400 hover:text-white block mx-auto"
              >
                New here? Create Vault
              </button>
              <button 
                onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}
                className="text-sm text-gray-500 hover:text-gray-300 block mx-auto"
              >
                Forgot password?
              </button>
            </>
          )}
          {mode === 'register' && (
            <button 
              onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
              className="text-sm text-gray-400 hover:text-white"
            >
              Already have a vault? Login
            </button>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <button 
              onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
              className="text-sm text-gray-400 hover:text-white"
            >
              Back to Login
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
