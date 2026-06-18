import { APIError } from "better-auth/api";

/**
 * Enforces "only the first account can be created". Throws a 403 when an
 * email signup is attempted while a user already exists. Pure: the caller
 * passes the current user-existence so this stays unit-testable.
 */
export function assertSignupAllowed(path: string, hasUser: boolean): void {
  if (path !== "/sign-up/email") return;
  if (hasUser) {
    throw new APIError("FORBIDDEN", {
      message: "Registration is closed. An account already exists.",
    });
  }
}
