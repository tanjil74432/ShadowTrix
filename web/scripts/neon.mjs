// Guarded helper for the production Neon database. Usage (from web/):
//   node scripts/neon.mjs validate  offline: structure of .env.neon only, no connection
//   node scripts/neon.mjs check    read-only: confirm the target and its state
//   node scripts/neon.mjs deploy   apply the committed migrations with `prisma migrate deploy` (direct connection)
//   node scripts/neon.mjs verify   read-only: compare the schema with the local development database and Prisma's schema
//
// Secrets live only in web/.env.neon (git-ignored). This script never prints a password or a full connection string, never
// writes data, never seeds, and refuses to run against anything that is not a Neon host or that equals the development URL.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

const cmd = process.argv[2];
if (!["validate", "check", "deploy", "verify"].includes(cmd)) {
  console.error("usage: node scripts/neon.mjs validate|check|deploy|verify");
  process.exit(2);
}
if (!existsSync(".env.neon")) fail("web/.env.neon does not exist.");
dotenv.config({ path: ".env.neon", quiet: true });
const DIRECT = process.env.NEON_DATABASE_URL_DIRECT;
const POOLED = process.env.NEON_DATABASE_URL_POOLED;
const devUrl = existsSync(".env") ? dotenv.parse(readFileSync(".env")).DATABASE_URL : undefined;

function fail(msg) {
  console.error(`STOP: ${msg}`);
  process.exit(1);
}

function describe(label, raw, wantPooler) {
  if (!raw) return fail(`${label} is empty in .env.neon.`);
  let u;
  try { u = new URL(raw); } catch { return fail(`${label} is not a valid URL.`); }
  if (!["postgres:", "postgresql:"].includes(u.protocol)) fail(`${label} is not a postgres URL.`);
  if (!u.hostname.endsWith(".neon.tech")) fail(`${label} host is not a neon.tech host.`);
  if (raw === devUrl) fail(`${label} equals the development DATABASE_URL.`);
  // A role name looks like neondb_owner. A value starting with npg_ is a Neon password pasted into the wrong place: never echo it.
  const role = decodeURIComponent(u.username);
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role) || role.startsWith("npg_")) fail(`${label}: the username part is not a valid role name (it must be like "neondb_owner"). The password may have been pasted into the username position. The value is not shown.`);
  if (!u.password) fail(`${label} has no password.`);
  const pooler = u.hostname.split(".")[0].endsWith("-pooler");
  if (wantPooler !== pooler) fail(`${label} must be a ${wantPooler ? "pooled (-pooler)" : "direct (non-pooler)"} connection string.`);
  if (u.searchParams.get("sslmode") !== "require") console.log(`note: ${label} has no sslmode=require (SSL is still enforced by Neon).`);
  const parts = u.hostname.split(".");
  return { endpoint: parts[0].replace(/-pooler$/, ""), region: parts.slice(1, -2).join("."), db: u.pathname.slice(1), user: decodeURIComponent(u.username) };
}

const d = describe("NEON_DATABASE_URL_DIRECT", DIRECT, false);
const p = describe("NEON_DATABASE_URL_POOLED", POOLED, true);
if (d.endpoint !== p.endpoint || d.db !== p.db || d.user !== p.user) fail("the pooled and direct strings point at different endpoints, databases or roles.");
console.log(`target: endpoint ${d.endpoint} | region ${d.region} | database ${d.db} | role ${d.user}`);
if (cmd === "validate") {
  console.log("structure OK: role name valid, passwords present, pooled host has -pooler, direct host has no -pooler, same endpoint/database/role, not the development URL. No connection was made.");
  process.exit(0);
}

async function connect(url, ssl = true) {
  const c = new pg.Client({ connectionString: url, ...(ssl ? { ssl: { rejectUnauthorized: true } } : {}), connectionTimeoutMillis: 20000 });
  await c.connect();
  return c;
}
const one = async (c, sql) => (await c.query(sql)).rows[0];

async function stats(c) {
  const q = async (sql) => Number((await one(c, sql)).n);
  return {
    tables: await q("select count(*) n from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name <> '_prisma_migrations'"),
    checks: await q("select count(*) n from pg_constraint con join pg_namespace ns on ns.oid=con.connamespace where ns.nspname='public' and con.contype='c'"),
    triggers: await q("select count(*) n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and not t.tgisinternal"),
    indexes: await q("select count(*) n from pg_indexes where schemaname='public'"),
    enums: await q("select count(*) n from pg_type t join pg_namespace ns on ns.oid=t.typnamespace where ns.nspname='public' and t.typtype='e'"),
  };
}

if (cmd === "check") {
  const c = await connect(DIRECT);
  const info = await one(c, "select current_database() db, current_user usr, split_part(version(), ' ', 2) pgver");
  console.log(`connected: database ${info.db} | role ${info.usr} | PostgreSQL ${info.pgver}`);
  for (const g of ["neon.project_id", "neon.branch_id", "neon.endpoint_id"]) {
    const r = await one(c, `select current_setting('${g}', true) v`);
    if (r.v) console.log(`${g} = ${r.v}`);
  }
  const s = await stats(c);
  const hasMig = (await one(c, "select to_regclass('public._prisma_migrations') is not null as has")).has;
  console.log(`public tables: ${s.tables} | _prisma_migrations present: ${hasMig}`);
  if (hasMig) {
    const m = await one(c, "select count(*) n, count(*) filter (where finished_at is null) unfinished from _prisma_migrations");
    console.log(`recorded migrations: ${m.n} (unfinished: ${m.unfinished})`);
  }
  const users = (await one(c, "select to_regclass('public.users') is not null as has")).has ? (await one(c, "select count(*) n from users")).n : "n/a";
  console.log(`users rows: ${users}`);
  await c.end();
  console.log(s.tables === 0 && !hasMig ? "RESULT: empty database, ready for `deploy`." : "RESULT: database is NOT empty; review before deploying.");
}

if (cmd === "deploy") {
  const c = await connect(DIRECT);
  const s = await stats(c);
  const hasMig = (await one(c, "select to_regclass('public._prisma_migrations') is not null as has")).has;
  await c.end();
  if (s.tables > 0 && !hasMig) fail("the target has tables but no Prisma migration history; refusing to deploy into an unknown database.");
  console.log("applying migrations with the direct connection ...");
  const r = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", shell: true, env: { ...process.env, DATABASE_URL: DIRECT } });
  process.exit(r.status ?? 1);
}

if (cmd === "verify") {
  const c = await connect(DIRECT);
  const remote = await stats(c);
  const m = await one(c, "select count(*) n, count(*) filter (where finished_at is null) unfinished, count(*) filter (where rolled_back_at is not null) rolled from _prisma_migrations");
  const rows = {};
  for (const t of ["users", "events", "registrations", "certificates", "org_members", "user_roles"]) rows[t] = Number((await one(c, `select count(*) n from ${t}`)).n);
  await c.end();
  let local = null;
  if (devUrl) { const l = await connect(devUrl, false); local = await stats(l); await l.end(); } // read-only SELECTs
  console.log("neon  :", JSON.stringify(remote), `| migrations ${m.n} (unfinished ${m.unfinished}, rolled back ${m.rolled})`);
  console.log("local :", local ? JSON.stringify(local) : "n/a");
  console.log("rows  :", JSON.stringify(rows));
  const same = local && Object.keys(remote).every((k) => remote[k] === local[k]);
  console.log(same ? "structure matches the local development database" : "WARNING: structure differs from the local development database");
  for (const args of [["migrate", "status"], ["migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"]]) {
    const r = spawnSync("npx", ["prisma", ...args], { stdio: "inherit", shell: true, env: { ...process.env, DATABASE_URL: DIRECT } });
    console.log(`prisma ${args.slice(0, 2).join(" ")} exit ${r.status}`);
  }
}
