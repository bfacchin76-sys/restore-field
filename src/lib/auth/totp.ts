import "server-only";
import { authenticator } from "otplib";
import QRCode from "qrcode";

// 30s window, 1 step tolerance — standard.
authenticator.options = { window: 1, step: 30 };

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export async function generateTotpSetup(
  email: string,
  issuer = "RestoreField",
): Promise<TotpSetup> {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(email, issuer, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1 });
  return { secret, otpauthUrl, qrCodeDataUrl };
}

export function verifyTotp(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  const cleaned = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    return authenticator.verify({ token: cleaned, secret });
  } catch {
    return false;
  }
}
