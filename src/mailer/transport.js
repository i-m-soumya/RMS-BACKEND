import nodemailer from 'nodemailer';
import { mailConfig } from '../config/mail.config.js';

export function readSmtpEnv() {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_REPLY_TO'];
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing SMTP settings: ${missing.join(', ')}`);

  const from = process.env.SMTP_FROM;
  const fromAddress = (from.match(/<([^>]+)>/) || [null, from])[1].trim().toLowerCase();
  const port = Number(process.env.SMTP_PORT);
  if (!fromAddress.endsWith(`@${mailConfig.sender.fromDomain}`)) {
    throw new Error(`SMTP_FROM must use the domain ${mailConfig.sender.fromDomain}`);
  }
  if (process.env.SMTP_REPLY_TO.trim().toLowerCase() !== mailConfig.brand.supportEmail) {
    throw new Error(`SMTP_REPLY_TO must be ${mailConfig.brand.supportEmail}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port');
  }

  return {
    host: process.env.SMTP_HOST,
    port,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from,
    replyTo: process.env.SMTP_REPLY_TO,
  };
}

export function createTransport() {
  const env = readSmtpEnv();
  return nodemailer.createTransport({
    host: env.host,
    port: env.port,
    auth: { user: env.user, pass: env.pass },
    ...mailConfig.smtp,
  });
}

export async function verifyOnStartup(transporter, logger) {
  try {
    await transporter.verify();
    logger.info('SMTP login OK');
    return true;
  } catch (error) {
    logger.error({ code: error.code, message: error.message }, 'SMTP verify FAILED');
    return false;
  }
}
