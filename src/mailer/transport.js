import nodemailer from 'nodemailer';
import { mailConfig } from '../config/mail.config.js';

export function readSmtpEnv() {
  const from = process.env.SMTP_FROM || process.env.MAIL_FROM;
  const replyTo = process.env.SMTP_REPLY_TO || process.env.MAIL_REPLY_TO;
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const missing = keys.filter((key) => !process.env[key]);
  if (!from) missing.push('SMTP_FROM (or MAIL_FROM)');
  if (!replyTo) missing.push('SMTP_REPLY_TO (or MAIL_REPLY_TO)');
  if (missing.length) throw new Error(`Missing SMTP settings: ${missing.join(', ')}`);

  const fromAddress = (from.match(/<([^>]+)>/) || [null, from])[1].trim().toLowerCase();
  const port = Number(process.env.SMTP_PORT);
  if (!fromAddress.endsWith(`@${mailConfig.sender.fromDomain}`)) {
    throw new Error(`SMTP_FROM must use the domain ${mailConfig.sender.fromDomain}`);
  }
  if (replyTo.trim().toLowerCase() !== mailConfig.brand.supportEmail) {
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
    replyTo,
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
    logger.error({
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
      message: error.message,
    }, 'SMTP verify FAILED');
    return false;
  }
}
