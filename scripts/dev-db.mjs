// Local dev database runner (no Docker / system Postgres required).
// Starts an embedded PostgreSQL matching DATABASE_URL in .env, then stays alive.
// Usage: npm run dev:db  (keep it running in a separate terminal)
import EmbeddedPostgres from "embedded-postgres";

const port = Number(process.env.DEV_PG_PORT ?? 5502);
const user = process.env.DEV_PG_USER ?? "postgres";
const password = process.env.DEV_PG_PASSWORD ?? "tga-dev-only";
const dbName = process.env.DEV_PG_DB ?? "tga";

const pg = new EmbeddedPostgres({
  databaseDir: "./.pgdata",
  user,
  password,
  port,
  persistent: true,
});

const isFirstRun = !(await import("node:fs")).existsSync("./.pgdata/PG_VERSION");
if (isFirstRun) {
  console.log("Initialising embedded Postgres cluster in ./.pgdata ...");
  await pg.initialise();
}
await pg.start();
if (isFirstRun) {
  await pg.createDatabase(dbName);
}
console.log(`Dev Postgres running on localhost:${port}, database "${dbName}".`);
console.log(`DATABASE_URL=postgresql://${user}:<password>@localhost:${port}/${dbName}`);
console.log("Press Ctrl+C to stop.");

const stop = async () => {
  console.log("Stopping dev Postgres ...");
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
