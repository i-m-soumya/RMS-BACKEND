import { appConfig } from './app.config.js';

export const mailConfig = {
  smtp: {
    secure: false,
    requireTLS: true,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 10000,
    socketTimeout: 20000,
  },
  sender: { fromDomain: 'noreply.restro360.tech' },
  limits: { dailyLimit: appConfig.mail.dailyLimit, dailyWarn: appConfig.mail.dailyWarn },
  otp: appConfig.otp,
  queue: {
    name: 'mail',
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
    priority: { otp: 1, transactional: 5, bulk: 10 },
  },
  brand: {
    name: 'Restro360',
    supportEmail: 'support@restro360.tech',
    websiteUrl: 'https://restro360.tech',
    consoleUrl: 'https://console.restro360.tech',
  },
};
