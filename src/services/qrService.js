import QRCode from 'qrcode';

function normalizeBaseUrl() {
  const raw = process.env.CONSOLE_PUBLIC_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
  return raw.replace(/\/$/, '');
}

export function buildTableQrPayload(restaurantSlug, tableNumber) {
  const baseUrl = normalizeBaseUrl();
  return `${baseUrl}/restaurant/${restaurantSlug}/table/${encodeURIComponent(tableNumber)}`;
}

export async function generateQrDataUrl(payload) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    type: 'image/png',
  });
}

export async function generateQrPngBuffer(payload) {
  return QRCode.toBuffer(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    type: 'png',
  });
}
