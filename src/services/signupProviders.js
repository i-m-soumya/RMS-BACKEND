import { logger } from '../config/logger.js';

export class DummySmsProvider {
  async send({ signupRef }) {
    logger.warn({ signupRef }, 'Dummy SMS provider handled verification; TODO: configure real SMS before public launch');
  }

  async verify({ code }) {
    return code === '0000';
  }
}

export class RealSmsProvider {
  async send() {
    throw new Error('TODO: configure a real SMS provider before public launch');
  }

  async verify() {
    throw new Error('TODO: configure a real SMS provider before public launch');
  }
}

export class DummyPaymentProvider {
  async createSubscription({ simulate }) {
    if (simulate === 'fail') {
      return { success: false };
    }
    return { success: true, provider: 'dummy', providerCustomerId: null, providerSubscriptionId: null };
  }

  async handleWebhook() {
    return { received: true };
  }
}

export class RealPaymentProvider {
  async createSubscription() {
    throw new Error('TODO: configure a real payment provider before public launch');
  }

  async handleWebhook() {
    throw new Error('TODO: configure a real payment provider before public launch');
  }
}
