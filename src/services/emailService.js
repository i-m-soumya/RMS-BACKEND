import nodemailer from 'nodemailer';
import { createTransport as createVerifiedTransport } from '../mailer/transport.js';

function buildTransporter() {
  try {
    return createVerifiedTransport();
  } catch (error) {
    if (process.env.SMTP_HOST) throw error;
    return nodemailer.createTransport({ jsonTransport: true });
  }
}

export async function sendAdminCredentialsEmail({
  to,
  adminName,
  restaurantName,
  tempPassword,
}) {
  return sendStaffCredentialsEmail({
    to,
    staffName: adminName,
    restaurantName,
    role: 'restaurant_admin',
    tempPassword,
  });
}

export async function sendStaffCredentialsEmail({
  to,
  staffName,
  restaurantName,
  role,
  tempPassword,
}) {
  const transporter = buildTransporter();
  const from = process.env.SMTP_FROM || process.env.MAIL_FROM || 'no-reply@rms.local';
  const subject = `Your ${restaurantName} RMS Admin Access`;
  const roleLabel = role === 'restaurant_admin'
    ? 'Restaurant Admin'
    : role === 'waiter'
      ? 'Waiter'
      : role === 'chef'
        ? 'Chef'
        : 'Staff';
  const text = [
    `Hello ${staffName},`,
    '',
    `You have been added as ${roleLabel} for ${restaurantName}.`,
    'Login URL: /console',
    `Email: ${to}`,
    `Temporary Password: ${tempPassword}`,
    '',
    'Please reset your password after first login.',
  ].join('\n');

  const html = `
    <p>Hello ${staffName},</p>
    <p>You have been added as <strong>${roleLabel}</strong> for <strong>${restaurantName}</strong>.</p>
    <p>
      <strong>Email:</strong> ${to}<br/>
      <strong>Temporary Password:</strong> ${tempPassword}
    </p>
    <p>Please reset your password after first login.</p>
  `;

  const result = await transporter.sendMail({
    from,
    ...((process.env.SMTP_REPLY_TO || process.env.MAIL_REPLY_TO) && {
      replyTo: process.env.SMTP_REPLY_TO || process.env.MAIL_REPLY_TO,
    }),
    to,
    subject,
    text,
    html,
  });

  return {
    sent: true,
    messageId: result.messageId || null,
    transport: process.env.SMTP_HOST ? 'smtp' : 'json',
    preview: typeof result.message === 'string' ? result.message : null,
  };
}
