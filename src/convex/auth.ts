// Auth providers for Local Diary Core.
//
// Three providers:
//  1. `password`   — email + password sign-in and sign-up (replaces the old
//                    email + one-time-code flow).
//  2. `unique-key` — sign in with the 6-character unique key created in
//                    Settings, as an alternative to email + password.
//  3. `anonymous`  — "continue as guest", data stays on the device.

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { api, internal } from "./_generated/api";
import {
  MAX_ATTEMPTS,
  WINDOW_MS,
  isValidUniqueKey,
} from "./uniqueKeyRules";

/**
 * Unique-key sign-in verification.
 *
 * The key is the only credential: look it up through the unique
 * `by_uniqueKey` index, guarded by a rolling rate limit so a key cannot be
 * brute-forced (10 wrong attempts per device per 10 minutes).
 *
 * Implementation note: this module must import `./_generated/api`, and the
 * generated `api` re-imports this file's `auth` config — which embeds this
 * very `authorize` signature. That cycle makes TypeScript instantiate the
 * provider's context type twice, and it then rejects its own identical type
 * ("two different types with this name exist"). The cast below is only a
 * type-level escape hatch; the runtime behavior is exactly the provider
 * contract: return the userId on success, null on failure, throw on abuse.
 */
async function authorizeUniqueKey(credentials: Record<string, unknown>, ctx: {
  runQuery: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
  runMutation: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
}): Promise<{ userId: string } | null> {
  const key = typeof credentials.key === "string" ? credentials.key : "";
  const identifier =
    typeof credentials.identifier === "string"
      ? credentials.identifier
      : "unknown-device";

  if (!isValidUniqueKey(key)) return null;

  // Brute-force guard: count this identifier's recent failures.
  const attempts = (await ctx.runQuery(
    internal.uniqueKeyInternal.recentKeyAttempts,
    { identifier, cutoff: Date.now() - WINDOW_MS },
  )) as number;
  if (attempts >= MAX_ATTEMPTS) {
    throw new Error(
      "Too many attempts. Wait ten minutes and try your key again.",
    );
  }

  // The by_uniqueKey unique index makes at most one match possible.
  const userId = (await ctx.runQuery(
    internal.uniqueKeyInternal.findUserByUniqueKey,
    { key: key.trim() },
  )) as string | null;
  if (!userId) {
    await ctx.runMutation(internal.uniqueKeyInternal.recordKeyAttempt,{
      identifier,
    });
    return null;
  }
  return { userId };
}

/** The authorize signature the credentials provider expects. */
type CredentialsAuthorize = NonNullable<
  Parameters<typeof ConvexCredentials>[0]["authorize"]
>;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      validatePasswordRequirements: (password: string) => {
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters.");
        }
      },
    }),
    ConvexCredentials({
      id: "unique-key",
      // See authorizeUniqueKey above for why the cast is needed.
      authorize: authorizeUniqueKey as unknown as CredentialsAuthorize,
    }),
    Anonymous,
  ],
});
