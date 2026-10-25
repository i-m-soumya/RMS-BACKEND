export const appConfig = {
  // Public subscription terms: three free months, then the monthly standard plan.
  plan: {
    trialMonths: 3,
    trialPriceInr: 0,
    standardPriceInr: 599,
    gst: 'as applicable',
  },
  // Bump after updated consent copy and legal text are published.
  policyVersion: '2026-10',
  // Email OTPs are 6 digits; the test-only dummy SMS provider uses 0000.
  otp: {
    emailLength: 6,
    mobileLength: 4,
    ttlSeconds: 600,
    maxAttempts: 3,
    resendCooldownSeconds: 30,
    maxSendsPerHour: 5,
  },
  // Daily non-OTP mail volume guardrails.
  mail: {
    dailyLimit: 150,
    dailyWarn: 120,
  },
  // Replace both test providers before accepting public signups.
  smsProvider: 'dummy',
  paymentProvider: 'dummy',
  features: { stock: false },
  captcha: { enabled: false },
  // API and console CORS allowlist; local ports cover Astro, Vite, and the API.
  corsOrigins: [
    'https://restro360.tech',
    'https://www.restro360.tech',
    'https://console.restro360.tech',
    'http://localhost:3000',
    'http://localhost:4321',
    'http://localhost:4322',
    'http://localhost:4800',
    'http://localhost:5173',
    'http://localhost:4173',
  ],
};
