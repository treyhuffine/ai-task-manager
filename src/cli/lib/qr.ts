import QRCode from 'qrcode';

/**
 * Render a QR code as terminal-friendly unicode blocks. Small margin, low
 * error-correction so URLs with tokens stay compact.
 */
export async function renderTerminalQr(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'terminal',
    small: true,
    margin: 1,
    errorCorrectionLevel: 'L',
  });
}
