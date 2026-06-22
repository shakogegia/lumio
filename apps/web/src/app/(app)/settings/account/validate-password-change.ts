/** Client-side guard for the password-change form. Returns an error message, or null when valid. */
export function validatePasswordChange(
  newPassword: string,
  confirm: string,
): string | null {
  if (newPassword.length < 8) {
    return "New password must be at least 8 characters.";
  }
  if (newPassword !== confirm) {
    return "Passwords do not match.";
  }
  return null;
}
