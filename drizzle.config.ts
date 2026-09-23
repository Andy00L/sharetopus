import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit settings for the three database scripts in package.json:
 * `bun run db:pull` reads the live database into drizzle/, `bun run
 * db:generate` turns edits of src/db/schema.ts into a SQL migration, and
 * `bun run db:migrate` applies pending migrations.
 *
 * These tools connect through SUPABASE_DB_URL, the Supabase session pooler
 * (port 5432), which keeps prepared statements across a run. The app itself
 * connects through DATABASE_URL, the transaction pooler (src/db/client.ts).
 */
const sessionPoolerUrl = process.env.SUPABASE_DB_URL;
if (!sessionPoolerUrl) {
  throw new Error(
    "[drizzleConfig] SUPABASE_DB_URL is not set. Add the Supabase session pooler connection string to .env.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: sessionPoolerUrl },
  // Only the app's tables. auth, storage and the other schemas belong to Supabase.
  schemaFilter: ["public"],
  // anon, authenticated and service_role are Supabase's roles: never create or drop them.
  entities: { roles: { provider: "supabase" } },
  // snake_case keys, so rows keep the column names the code already reads.
  introspect: { casing: "preserve" },
});
