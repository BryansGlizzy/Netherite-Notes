import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Extra hostnames the DEVELOPMENT server should answer to (comma-separated), e.g. ALLOWED_HOSTS=notes.example.com.
// Has no effect on production, which does not use the Vite server.
const allowedHosts = (process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);

export default defineConfig({
  plugins: [react()],
  server: {
    ...(allowedHosts.length ? { allowedHosts } : {}),
    // Development mode serves project files; keep data and secrets out of reach even there.
    // (Setting `deny` replaces Vite's defaults, so those are repeated first.)
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '*.db', '*.db-*', '**/backups/**', 'server.js', 'server/**', 'scripts/**', 'tests/**', 'docs/**']
    }
  }
});
