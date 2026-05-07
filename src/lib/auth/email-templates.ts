import "server-only";
import { env } from "@/lib/env";

const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");

export function passwordResetEmail(rawToken: string) {
  const url = `${baseUrl}/reset-password?token=${rawToken}`;
  return {
    subject: "Reset your RestoreField password",
    text: `A password reset was requested for your RestoreField account.

Open this link to set a new password (valid for 1 hour):

${url}

If you didn't request this, you can safely ignore this message.`,
    html: `<p>A password reset was requested for your RestoreField account.</p>
<p><a href="${url}">Click here to set a new password</a> (valid for 1 hour).</p>
<p>If you didn't request this, you can safely ignore this message.</p>`,
  };
}

export function inviteEmail(orgName: string, rawToken: string) {
  const url = `${baseUrl}/accept-invite?token=${rawToken}`;
  return {
    subject: `You're invited to ${orgName} on RestoreField`,
    text: `You've been invited to join ${orgName} on RestoreField.

Open this link to set a password and activate your account (valid for 7 days):

${url}`,
    html: `<p>You've been invited to join <strong>${orgName}</strong> on RestoreField.</p>
<p><a href="${url}">Set up your account</a> (valid for 7 days).</p>`,
  };
}

export function subcontractorMagicLinkEmail(orgName: string, rawToken: string) {
  const url = `${baseUrl}/magic?token=${rawToken}`;
  return {
    subject: `Sign in to ${orgName} on RestoreField`,
    text: `Open this link to sign in to ${orgName} on RestoreField (valid for 7 days):

${url}

This is a single-use sign-in link. Don't share it with anyone.`,
    html: `<p>Open this link to sign in to <strong>${orgName}</strong> on RestoreField (valid for 7 days):</p>
<p><a href="${url}">Sign in</a></p>
<p>This is a single-use sign-in link. Don't share it with anyone.</p>`,
  };
}
