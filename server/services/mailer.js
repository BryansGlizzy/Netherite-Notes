const nodemailer = require('nodemailer');
const config = require('../config');
const { escapeHtml } = require('../lib/validate');

const smtpTransporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
  requireTLS: config.smtp.requireTls, // refuse to send links over an unencrypted hop
  ...(config.smtp.user ? { auth: { user: config.smtp.user, pass: config.smtp.pass } } : {}),
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000
});

function layout({ heading, username, intro, button, url, footer }) {
  return `
  <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#1e1e2e;color:#cdd6f4;border-radius:12px">
    <h2 style="color:#cba6f7;margin-bottom:16px">${escapeHtml(heading)}</h2>
    <p>Hi <strong>${escapeHtml(username)}</strong>,</p>
    <p>${escapeHtml(intro)}</p>
    <a href="${escapeHtml(url)}" style="display:inline-block;margin:24px 0;padding:12px 28px;background:#cba6f7;color:#1e1e2e;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(button)}</a>
    <p style="font-size:12px;color:#6c7086">${escapeHtml(footer)}</p>
  </div>`;
}

const send = (to, subject, html) =>
  smtpTransporter.sendMail({ from: `"Netherite Notes" <${config.smtp.from}>`, to, subject, html });

// Links use the URL fragment (#...) so the token is never sent to the server in a request line,
// never appears in access logs, and is not leaked through the Referer header.
function sendPasswordReset(user, token) {
  return send(user.email, 'Password Reset — Netherite Notes', layout({
    heading: 'Password Reset', username: user.username,
    intro: 'We received a request to reset your password. Click the button below to continue:',
    button: 'Reset Password', url: `${config.appUrl}/#reset=${token}`,
    footer: "This link expires in 1 hour. If you didn't request this, you can safely ignore this email."
  }));
}

function sendVerification(user, token) {
  return send(user.email, 'Verify your email — Netherite Notes', layout({
    heading: 'Verify your email', username: user.username,
    intro: 'Please confirm this email address so you can recover your account and receive important notices:',
    button: 'Verify Email', url: `${config.appUrl}/#verify=${token}`,
    footer: "This link expires in 24 hours. If you didn't create this account, you can ignore this email."
  }));
}

module.exports = { smtpTransporter, sendPasswordReset, sendVerification };
