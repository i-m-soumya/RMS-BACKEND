let provider = async () => {
  throw new Error('Captcha provider is not configured');
};

export function setSignupCaptchaProvider(nextProvider) {
  if (typeof nextProvider !== 'function') throw new TypeError('Captcha provider must be a function');
  provider = nextProvider;
}

export async function verifySignupCaptcha(token, req) {
  return provider({ token, req });
}
