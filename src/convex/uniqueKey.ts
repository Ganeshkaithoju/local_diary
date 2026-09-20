/**
 * Unique-key account functions.
 *
 * A unique key is a 6-character handle (≥1 uppercase, ≥1 lowercase, ≥1 digit)
 * the user creates in Settings and can then sign in with instead of typing
 * their email and password. Uniqueness is enforced by the `by_uniqueKey`
 * index on the users table (see src/convex/schema.ts) — exactly like GitHub
 * repository names.
 *
 * The sign-in verification itself lives in auth.ts (the credentials
 * provider); the internal functions it queries are in uniqueKeyInternal.ts.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { uniqueKeyIssue } from "./uniqueKeyRules";

const normalize = (key: string) => key.trim();

/** Is this key free to claim? Used for live availability in the UI. */
export const uniqueKeyAvailable = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const key = normalize(args.key);
    const issue = uniqueKeyIssue(key);
    if (issue) return { available: false, reason: issue };
    const taken = await ctx.db
      .query("users")
      .withIndex("by_uniqueKey", (q) => q.eq("uniqueKey", key))
      .unique();
    if (taken) return { available: false, reason: "That key is already taken." };
    return { available: true, reason: null };
  },
});

/**
 * Create (or replace) the signed-in user's unique key. Only signed-in,
 * non-anonymous users may hold a key; guests cannot.
 */
export const setMyUniqueKey = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Sign in first.");
    if (user.isAnonymous) {
      throw new Error(
        "Guests cannot create a unique key. Create an account first.",
      );
    }

    const key = normalize(args.key);
    const issue = uniqueKeyIssue(key);
    if (issue) throw new Error(issue);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_uniqueKey", (q) => q.eq("uniqueKey", key))
      .unique();
    if (existing && existing._id !== userId) {
      throw new Error("That key is already taken. Choose another.");
    }

    await ctx.db.patch(userId, {
      uniqueKey: key,
      uniqueKeyCreatedAt:
        user.uniqueKey === key ? user.uniqueKeyCreatedAt : Date.now(),
    });
    return { key };
  },
});

/** The signed-in user's current key (for showing it in Settings). */
export const myUniqueKey = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user || user.isAnonymous) return null;
    return user.uniqueKey ?? null;
  },
});

/** Remove the signed-in user's unique key. */
export const clearMyUniqueKey = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    await ctx.db.patch(userId, {
      uniqueKey: undefined,
      uniqueKeyCreatedAt: undefined,
    });
  },
});
