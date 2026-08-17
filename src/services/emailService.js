import nodemailer from 'nodemailer';

function buildTransporter() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
    });
  }

  return nodemailer.createTransport({
    jsonTransport: true,
  });
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
  const from = process.env.MAIL_FROM || 'no-reply@rms.local';
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

  const result = await transporter.sendMail({ from, to, subject, text, html });

  return {
    sent: true,
    messageId: result.messageId || null,
    transport: process.env.SMTP_HOST ? 'smtp' : 'json',
    preview: typeof result.message === 'string' ? result.message : null,
  };
}
