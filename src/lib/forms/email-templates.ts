import "server-only";
import { env } from "@/lib/env";

const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");

export function formSignEmail(
  orgName: string,
  templateName: string,
  rawToken: string,
) {
  const url = `${baseUrl}/forms/sign?token=${rawToken}`;
  return {
    subject: `${orgName}: please sign "${templateName}"`,
    text: `${orgName} has sent you a "${templateName}" form to sign.

Open this single-use link to review and sign (valid for 7 days):

${url}

If you weren't expecting this, you can safely ignore the message.`,
    html: `<p>${orgName} has sent you a <strong>${templateName}</strong> form to sign.</p>
<p><a href="${url}">Open the form to review and sign</a> (valid for 7 days).</p>
<p>If you weren't expecting this, you can safely ignore the message.</p>`,
  };
}
