/**
 * Internal unique-key functions — called only by the credentials provider in
 * auth.ts. Kept in a separate file so auth.ts never imports a module that
 * imports auth.ts (which would be circular).
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const findUserByUniqueKey = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    // The by_uniqueKey unique index makes at most one match possible.
    const user = await ctx.db
      .query("users")
      .withIndex("by_uniqueKey", (q) => q.eq("uniqueKey", args.key))
      .unique();
    return user?._id ?? null;
  },
});

export const recordKeyAttempt = internalMutation({
  args: { identifier: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("uniqueKeyAttempts", {
      identifier: args.identifier,
      at: Date.now(),
    });
    // Opportunistic cleanup of this identifier's expired entries.
    const cutoff = Date.now() - 10 * 60 * 1000;
    const stale = await ctx.db
      .query("uniqueKeyAttempts")
      .withIndex("by_identifier", (q) =>
        q.eq("identifier", args.identifier).lt("_creationTime", cutoff),
      )
      .collect();
    for (const row of stale) await ctx.db.delete(row._id);
  },
});

export const recentKeyAttempts = internalQuery({
  args: { identifier: v.string(), cutoff: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("uniqueKeyAttempts")
      .withIndex("by_identifier", (q) =>
        q.eq("identifier", args.identifier).gte("_creationTime", args.cutoff),
      )
      .collect();
    return rows.length;
  },
});
