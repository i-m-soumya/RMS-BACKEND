const DEFAULT_STAFF_SESSION_IDLE_TIMEOUT_DAYS = 7;

const configuredTimeout = Number(process.env.STAFF_SESSION_IDLE_TIMEOUT_DAYS);

export const STAFF_SESSION_IDLE_TIMEOUT_DAYS = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : DEFAULT_STAFF_SESSION_IDLE_TIMEOUT_DAYS;