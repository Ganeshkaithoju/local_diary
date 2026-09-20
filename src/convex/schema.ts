import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      /**
       * Unique key — a 6-character handle (1 uppercase, 1 lowercase, 1 digit
       * minimum) the user creates in Settings and can sign in with instead of
       * email + password. The index below makes lookups fast; actual
       * uniqueness is enforced transactionally in setMyUniqueKey (see
       * src/convex/uniqueKey.ts), like GitHub repository names.
       */
      uniqueKey: v.optional(v.string()),
      uniqueKeyCreatedAt: v.optional(v.number()),

      role: v.optional(roleValidator), // role of the user. do not remove
    })
      .index("email", ["email"]) // index for the email. do not remove or modify
      .index("by_uniqueKey", ["uniqueKey"]), // unique-key sign-in lookup

    // add other tables here

    // tableName: defineTable({
    //   ...    //    // table fields
    //  }).index("by_field", ["field"])

    /**
     * Brute-force guard for unique-key sign-in attempts. Keyed by IP-ish
     * identifier sent from the client (a per-browser id); records a rolling
     * window of failed attempts that uniqueKey.ts checks before verifying.
     */
    uniqueKeyAttempts: defineTable({
      identifier: v.string(),
      at: v.number(),
    }).index("by_identifier", ["identifier"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
