import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";

export class Auth {
  private pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined }) : undefined;
  private sessions = new Map<string, { name: string; email: string; expiresAt: number }>();
  async initialize() { if (!this.pool) return; await this.pool.query("create table if not exists users (id uuid primary key, email text unique not null, name text not null, password_hash text not null, created_at timestamptz default now())"); }
  async register(email: string, name: string, password: string) { if (!this.pool) throw new Error("Accounts are not configured yet."); this.check(email, name, password); const id = randomUUID(); const salt = randomBytes(16).toString("hex"); const hash = `${salt}:${pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("hex")}`; try { await this.pool.query("insert into users (id,email,name,password_hash) values ($1,$2,$3,$4)", [id, email.toLowerCase(), name, hash]); } catch { throw new Error("An account with that email already exists."); } return this.session(name, email); }
  async login(email: string, password: string) { if (!this.pool) throw new Error("Accounts are not configured yet."); const row = (await this.pool.query<{ name: string; email: string; password_hash: string }>("select name,email,password_hash from users where email=$1", [email.toLowerCase()])).rows[0]; if (!row || !this.match(password, row.password_hash)) throw new Error("Email or password is incorrect."); return this.session(row.name, row.email); }
  get(id?: string) { const s = id ? this.sessions.get(id) : undefined; return s && s.expiresAt > Date.now() ? s : undefined; }
  private session(name: string, email: string) { const id = createHash("sha256").update(randomBytes(32)).digest("base64url"); const value = { name, email, expiresAt: Date.now() + 604800000 }; this.sessions.set(id, value); return { id, ...value }; }
  private check(email: string, name: string, password: string) { if (!/^\S+@\S+\.\S+$/.test(email) || !name.trim() || password.length < 10) throw new Error("Use a valid email, a name, and a password with at least 10 characters."); }
  private match(password: string, stored: string) { const [salt, expected] = stored.split(":"); const actual = pbkdf2Sync(password, salt, 210000, 32, "sha256"); return timingSafeEqual(actual, Buffer.from(expected, "hex")); }
}

