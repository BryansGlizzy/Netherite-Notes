#!/usr/bin/env node
// Create or prepare an admin account from the command line (requires shell access to the server).
// Admin rights are granted to accounts whose email is listed in ADMIN_EMAILS. That address cannot be
// claimed through public sign-up, so this is how you bootstrap it.
//
//   npm run admin:create -- --email you@example.com --username you [--password '...']
//
// - user does not exist           -> created (random password printed once if --password is omitted)
// - user exists without an email  -> the email is set on that account
// - email not in ADMIN_EMAILS     -> reminder to add it, otherwise the account is a normal user
require('dotenv').config({ path: process.env.ENV_FILE || '.env', quiet: true });
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const config = require('../server/config');
const { createDb } = require('../server/db/connection');
const { migrate } = require('../server/db/migrate');
const { createVault } = require('../server/lib/membership');

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};

async function main() {
  const email = (arg('email') || '').trim().toLowerCase();
  const username = (arg('username') || '').trim();
  let password = arg('password');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    console.error('Usage: npm run admin:create -- --email you@example.com --username you [--password "min 10 chars"]');
    process.exit(2);
  }
  if (password !== undefined && (password.length < 10 || Buffer.byteLength(password) > 72)) {
    console.error('Password must be 10 to 72 characters.');
    process.exit(2);
  }

  const db = await createDb(config.dbPath);
  try {
    await migrate(db, { backupDir: config.backupDir, log: () => {} });
    const byEmail = await db.get('SELECT id, username FROM users WHERE lower(email) = ?', [email]);
    const byName = await db.get('SELECT id, username, email FROM users WHERE username = ? COLLATE NOCASE', [username]);

    if (byEmail) {
      console.log(`An account with ${email} already exists (username "${byEmail.username}"); nothing to create.`);
    } else if (byName) {
      if (byName.email) {
        console.error(`User "${byName.username}" already has a different email (${byName.email}). Use the admin panel to change it.`);
        process.exit(1);
      }
      await db.run('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?', [email, byName.id]);
      console.log(`Set email ${email} on existing user "${byName.username}".`);
    } else {
      const generated = password === undefined;
      if (generated) password = crypto.randomBytes(15).toString('base64url');
      const userId = crypto.randomUUID();
      const hash = await bcrypt.hash(password, 12);
      await db.transaction(async (tx) => {
        // shell access vouches for this address, so it is created as verified
        await tx.run('INSERT INTO users (id, username, password, email, email_verified) VALUES (?, ?, ?, ?, 1)', [userId, username, hash, email]);
        await createVault(tx, {
          name: 'My Vault', ownerId: userId,
          welcome: { title: 'Welcome', content: '# Welcome to Netherite Notes\n\nThis is your first note. Try creating links like [[Ideas]].' }
        });
      });
      console.log(`Created admin-eligible user "${username}" <${email}>.`);
      if (generated) console.log(`Generated password (shown once): ${password}`);
    }

    if (!config.adminEmails.includes(email)) {
      console.warn(`\n⚠️  ${email} is not in ADMIN_EMAILS. Add it to .env and restart the server to grant admin rights.`);
    } else {
      console.log('\n✅ This address is listed in ADMIN_EMAILS: the account is an admin.');
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error('admin:create failed:', err.message);
  process.exit(1);
});
