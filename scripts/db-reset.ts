import postgres from "postgres";
import { runMigrations } from "./migrate";

/** Drops and recreates the schema, then applies all migrations. Refuses to run in production. */
export async function resetDatabase(url: string) {
  if (process.env.NODE_ENV === "production") throw new Error("db:reset tidak boleh dijalankan di production");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(
      "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;",
    );
  } finally {
    await client.end();
  }
  await runMigrations(url);
}

if (process.argv[1]?.endsWith("db-reset.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum di-set");
  resetDatabase(url)
    .then(() => console.log("Database di-reset dan dimigrasi."))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
