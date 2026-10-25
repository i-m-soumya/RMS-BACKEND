import db from '../db/connection.js';
import { logger } from '../config/logger.js';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export function startSignupCleanup() {
  const cleanup = async () => {
    try {
      const now = new Date();
      await db('handoff_codes').where('expires_at', '<=', now).delete();
      await db('pending_signups').where('expires_at', '<=', now).andWhereNot('step', 'done').delete();
    } catch (error) {
      logger.error({ code: error.code }, 'Expired signup cleanup failed');
    }
  };

  const timer = setInterval(() => void cleanup(), CLEANUP_INTERVAL_MS);
  timer.unref();
  void cleanup();
  return timer;
}
