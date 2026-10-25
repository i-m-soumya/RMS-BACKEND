import { mailConfig } from '../config/mail.config.js';

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function layout(content) {
  const brand = escapeHtml(mailConfig.brand.name);
  const support = escapeHtml(mailConfig.brand.supportEmail);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:24px 12px;background:#f7f1e8;font-family:Arial,Helvetica,sans-serif;color:#272120">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fffaf4;border:1px solid #e8dfd4;border-radius:12px">
      <tr><td style="padding:28px 32px 12px;font-size:20px;font-weight:bold;color:#a63d36">${brand}</td></tr>
      <tr><td style="padding:12px 32px 28px;font-size:15px;line-height:1.6">${content}</td></tr>
      <tr><td style="padding:18px 32px;border-top:1px solid #e8dfd4;font-size:12px;line-height:1.5;color:#746b65">${brand} · <a href="mailto:${support}" style="color:#a63d36">${support}</a></td></tr>
    </table>
  </body></html>`;
}

export function createOtpEmail({ ownerName, code, expiresMinutes = 10 }) {
  const name = escapeHtml(ownerName);
  return {
    subject: `Your Restro360 verification code: ${code}`,
    text: `Hello ${ownerName},\n\nYour Restro360 verification code is ${code}. It expires in ${expiresMinutes} minutes.\n\nIf you did not request this code, you can ignore this email.`,
    html: layout(`<p>Hello ${name},</p><p>Use this verification code to continue:</p>
      <p style="margin:24px 0;padding:16px;text-align:center;background:#f7f1e8;border-radius:8px;font-size:28px;font-weight:bold;letter-spacing:8px;color:#a63d36">${escapeHtml(code)}</p>
      <p>This code expires in ${expiresMinutes} minutes.</p><p>If you did not request this code, you can ignore this email.</p>`),
  };
}

export function createWelcomeEmail({ ownerName, restaurantName, consoleUrl = mailConfig.brand.consoleUrl }) {
  const name = escapeHtml(ownerName);
  const restaurant = escapeHtml(restaurantName);
  const url = escapeHtml(consoleUrl);
  return {
    subject: `Welcome to Restro360, ${ownerName}`,
    text: `Hello ${ownerName},\n\n${restaurantName} is set up on Restro360. Sign in at ${consoleUrl} to complete your table QR, menu and staff setup.\n\nNext steps:\n1. Add tables and generate QR codes.\n2. Add your menu.\n3. Invite your staff.\n\nNeed help? Email ${mailConfig.brand.supportEmail}.`,
    html: layout(`<p>Hello ${name},</p><p><strong>${restaurant}</strong> is set up on Restro360.</p>
      <p>Next steps:</p><ol><li>Add tables and generate QR codes.</li><li>Add your menu.</li><li>Invite your staff.</li></ol>
      <p style="margin:24px 0"><a href="${url}" style="display:inline-block;padding:12px 20px;background:#a63d36;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Open Restro360</a></p>
      <p>You can sign in with the email and password you selected during signup. We will never include your password in an email.</p>`),
  };
}

export function createContactNotificationEmail({ name, email, phone, restaurantName, city, message }) {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safePhone = escapeHtml(phone || 'Not provided');
  const safeRestaurant = escapeHtml(restaurantName);
  const safeCity = escapeHtml(city || 'Not provided');
  const safeMessage = escapeHtml(message || 'No message provided').replace(/\r?\n/g, '<br>');
  return {
    subject: `New Restro360 contact request: ${restaurantName}`,
    text: [
      'A new contact request was submitted on the Restro360 website.',
      '',
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone || 'Not provided'}`,
      `Restaurant: ${restaurantName}`,
      `City: ${city || 'Not provided'}`,
      '',
      'Message:',
      message || 'No message provided',
    ].join('\n'),
    html: layout(`<p>A new contact request was submitted on the Restro360 website.</p>
      <dl><dt><strong>Name</strong></dt><dd>${safeName}</dd>
      <dt><strong>Email</strong></dt><dd>${safeEmail}</dd>
      <dt><strong>Phone</strong></dt><dd>${safePhone}</dd>
      <dt><strong>Restaurant</strong></dt><dd>${safeRestaurant}</dd>
      <dt><strong>City</strong></dt><dd>${safeCity}</dd></dl>
      <p><strong>Message</strong></p><p>${safeMessage}</p>`),
  };
}
