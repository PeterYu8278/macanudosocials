// WhatsApp recovery messages intentionally stay English, independent of UI locale.
export function passwordResetLinkMessage(link: string): string {
  return `[Macanudo Socials]\nReset your password using this link:\n${link}\nIf you did not request this, ignore this message. Your password has not been changed.`;
}

export function temporaryPasswordMessage(appName: string, displayName: string | undefined, password: string): string {
  return `[${appName}] Password Reset
Hello ${displayName || 'member'}, your password has been reset.

Temporary password: ${password}

Please sign in and change your password as soon as possible. If you did not request this, contact an administrator immediately.`;
}
