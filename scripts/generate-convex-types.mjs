import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "src", "convex", "_generated");

mkdirSync(OUT_DIR, { recursive: true });

const { serverCodegen } = require(
  join(ROOT, "node_modules/convex/dist/cjs/cli/codegen_templates/server.js"),
);
const { apiCodegen } = require(
  join(ROOT, "node_modules/convex/dist/cjs/cli/codegen_templates/api.js"),
);

// 1. server.d.ts and server.js
const server = serverCodegen({ useTypeScript: false });
writeFileSync(join(OUT_DIR, "server.d.ts"), server.DTS);
writeFileSync(join(OUT_DIR, "server.js"), server.JS);

// 2. api.d.ts and api.js
const modules = [
  "auth.js",
  "http.js",
  "uniqueKey.js",
  "uniqueKeyInternal.js",
  "uniqueKeyRules.js",
  "users.js",
];
const api = apiCodegen(modules, { useTypeScript: false });
writeFileSync(join(OUT_DIR, "api.d.ts"), api.DTS);
writeFileSync(join(OUT_DIR, "api.js"), api.JS);

// 3. dataModel.d.ts
const dataModelDTS = `/* eslint-disable */
/**
 * Generated data model types.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run \`npx convex dev\`.
 * @module
 */

import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
} from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";

/**
 * The names of all of your Convex tables.
 */
export type TableNames = TableNamesInDataModel<DataModel>;

/**
 * The type of a document stored in Convex.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Doc<TableName extends TableNames> = DocumentByName<
  DataModel,
  TableName
>;

/**
 * An identifier for a document in Convex.
 *
 * Convex documents are uniquely identified by their \`Id\`, which is accessible
 * on the \`_id\` field. To learn more, see [Document IDs](https://docs.convex.dev/using/document-ids).
 *
 * Documents can be loaded using \`db.get(tableName, id)\` in query and mutation functions.
 *
 * IDs are just strings at runtime, but this type can be used to distinguish them from other
 * strings when type checking.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Id<TableName extends TableNames | SystemTableNames> =
  GenericId<TableName>;

/**
 * A type describing your Convex data model.
 *
 * This type includes information about what tables you have, the type of
 * documents stored in those tables, and the indexes defined on them.
 *
 * This type is used to parameterize methods like \`queryGeneric\` and
 * \`mutationGeneric\` to make them type-safe.
 */
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
`;

writeFileSync(join(OUT_DIR, "dataModel.d.ts"), dataModelDTS);

console.log("Convex generated types written successfully to:", OUT_DIR);
