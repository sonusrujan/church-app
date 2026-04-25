/**
 * PostgreSQL-backed query builder that provides a chainable
 * db.from("table").select().eq()... API used throughout the codebase.
 *
 * Uses the `pg` driver directly so the backend can run against any
 * PostgreSQL instance (AWS RDS, local, etc.).
 */

import { Pool, type PoolClient, type QueryResult } from "pg";
import { logger } from "../utils/logger";
import { getCurrentChurchId } from "../middleware/rlsContext";

/**
 * Wraps pool.query to prepend SET LOCAL for RLS.
 * Uses a single connection so SET LOCAL + the actual query
 * execute in the same implicit transaction.
 */
async function rlsQuery(text: string, values?: unknown[]): Promise<QueryResult> {
  const churchId = getCurrentChurchId();

  // CRIT-03: Always use RLS context. When no church context is set,
  // still go through a transaction with an empty/sentinel church_id
  // so SET LOCAL is always applied. Only truly system-level queries
  // (migrations, health checks) should bypass RLS.
  if (!churchId || churchId === "__NONE__") {
    // Use a transaction with empty church_id so RLS policies still evaluate
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_church_id', $1, true)", [""]);
      const result = await client.query(text, values);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL only lives within the current transaction
    await client.query("SELECT set_config('app.current_church_id', $1, true)", [churchId]);
    const result = await client.query(text, values);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── Connection Pool ────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL || "";
if (!DATABASE_URL) {
  logger.warn("DATABASE_URL not set – database queries will fail.");
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
  ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
});

pool.on("error", (err) => logger.error({ err }, "Unexpected PG pool error"));

// PERF-15: Periodic pool health monitoring
setInterval(() => {
  const { totalCount, idleCount, waitingCount } = pool;
  if (totalCount > 16 || waitingCount > 0) {
    logger.warn({ totalCount, idleCount, waitingCount, max: 20 }, "PG pool pressure");
  }
}, 30_000);

/** Run a raw parameterized query (with RLS context). */
export async function rawQuery<T = Record<string, unknown>>(
  text: string,
  values?: unknown[],
): Promise<{ rows: T[]; rowCount: number }> {
  const result: QueryResult = await rlsQuery(text, values);
  return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
}

/** Get a client for transactions. */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

// ─── Chainable Query Builder ──────────────────────────────

type FilterOp =
  | { type: "eq"; col: string; val: unknown }
  | { type: "neq"; col: string; val: unknown }
  | { type: "gt"; col: string; val: unknown }
  | { type: "gte"; col: string; val: unknown }
  | { type: "lt"; col: string; val: unknown }
  | { type: "lte"; col: string; val: unknown }
  | { type: "like"; col: string; val: unknown }
  | { type: "ilike"; col: string; val: unknown }
  | { type: "is"; col: string; val: unknown }
  | { type: "in"; col: string; val: unknown[] }
  | { type: "or"; expr: string }
  | { type: "match"; obj: Record<string, unknown> }
  | { type: "not"; col: string; op: string; val: unknown }
  | { type: "contains"; col: string; val: unknown }
  | { type: "containedBy"; col: string; val: unknown }
  | { type: "textSearch"; col: string; query: string; config?: string };

type OrderSpec = { col: string; ascending: boolean; nullsFirst?: boolean };

interface BuilderResult<T = any> {
  data: any;
  error: { message: string; code?: string; details?: string } | null;
  count?: number | null;
}

class QueryBuilder<T = Record<string, unknown>> {
  private _table: string;
  private _action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private _selectCols = "*";
  private _countMode: "exact" | null = null;
  private _headOnly = false;
  private _filters: FilterOp[] = [];
  private _orders: OrderSpec[] = [];
  private _limitVal: number | null = null;
  private _rangeFrom: number | null = null;
  private _rangeTo: number | null = null;
  private _single = false;
  private _maybeSingle = false;
  private _payload: Record<string, unknown>[] = [];
  private _updatePayload: Record<string, unknown> = {};
  private _onConflict: string | null = null;
  private _returningCols: string | null = null;

  constructor(table: string) {
    this._table = table;
  }

  // ── Action starters ──

  select(cols?: string, opts?: { count?: "exact"; head?: boolean }): this {
    this._action = "select";
    this._selectCols = cols || "*";
    if (opts?.count) this._countMode = opts.count;
    if (opts?.head) this._headOnly = true;
    return this;
  }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this._action = "insert";
    this._payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(data: Record<string, unknown>): this {
    this._action = "update";
    this._updatePayload = data;
    return this;
  }

  delete(): this {
    this._action = "delete";
    return this;
  }

  upsert(
    rows: Record<string, unknown> | Record<string, unknown>[],
    opts?: { onConflict?: string },
  ): this {
    this._action = "upsert";
    this._payload = Array.isArray(rows) ? rows : [rows];
    this._onConflict = opts?.onConflict || null;
    return this;
  }

  // ── Filters ──

  eq(col: string, val: unknown): this { this._filters.push({ type: "eq", col, val }); return this; }
  neq(col: string, val: unknown): this { this._filters.push({ type: "neq", col, val }); return this; }
  gt(col: string, val: unknown): this { this._filters.push({ type: "gt", col, val }); return this; }
  gte(col: string, val: unknown): this { this._filters.push({ type: "gte", col, val }); return this; }
  lt(col: string, val: unknown): this { this._filters.push({ type: "lt", col, val }); return this; }
  lte(col: string, val: unknown): this { this._filters.push({ type: "lte", col, val }); return this; }
  like(col: string, val: unknown): this { this._filters.push({ type: "like", col, val }); return this; }
  ilike(col: string, val: unknown): this { this._filters.push({ type: "ilike", col, val }); return this; }
  is(col: string, val: unknown): this { this._filters.push({ type: "is", col, val }); return this; }
  in(col: string, val: unknown[]): this { this._filters.push({ type: "in", col, val }); return this; }
  or(expr: string): this { this._filters.push({ type: "or", expr }); return this; }
  match(obj: Record<string, unknown>): this { this._filters.push({ type: "match", obj }); return this; }
  not(col: string, op: string, val: unknown): this { this._filters.push({ type: "not", col, op, val }); return this; }
  contains(col: string, val: unknown): this { this._filters.push({ type: "contains", col, val }); return this; }
  containedBy(col: string, val: unknown): this { this._filters.push({ type: "containedBy", col, val }); return this; }
  textSearch(col: string, query: string, opts?: { config?: string }): this {
    this._filters.push({ type: "textSearch", col, query, config: opts?.config });
    return this;
  }

  // ── Modifiers ──

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this._orders.push({ col, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
    return this;
  }

  limit(n: number): this { this._limitVal = n; return this; }
  range(from: number, to: number): this { this._rangeFrom = from; this._rangeTo = to; return this; }

  single<U = T>(): Promise<BuilderResult<U>> {
    this._single = true;
    return this._execute() as Promise<BuilderResult<U>>;
  }

  maybeSingle<U = T>(): Promise<BuilderResult<U>> {
    this._maybeSingle = true;
    return this._execute() as Promise<BuilderResult<U>>;
  }

  /** Type-only hint, no runtime effect */
  returns<U = T>(): this {
    return this;
  }

  // ── Execution ──

  then<TResult = BuilderResult<T>>(
    resolve: (val: BuilderResult<T>) => TResult | PromiseLike<TResult>,
    reject?: (reason: unknown) => TResult | PromiseLike<TResult>,
  ): Promise<TResult> {
    return this._execute().then(resolve as any, reject as any);
  }

  private async _execute(): Promise<BuilderResult<unknown>> {
    try {
      switch (this._action) {
        case "select":
          return await this._execSelect();
        case "insert":
          return await this._execInsert();
        case "update":
          return await this._execUpdate();
        case "delete":
          return await this._execDelete();
        case "upsert":
          return await this._execUpsert();
        default:
          return { data: null, error: { message: `Unknown action: ${this._action}` } };
      }
    } catch (err: any) {
      logger.error({ err, table: this._table, action: this._action }, "Query builder error");
      return { data: null, error: { message: err.message || String(err), code: err.code } };
    }
  }

  // ── Build WHERE clause ──

  private _buildWhere(params: unknown[]): string {
    if (!this._filters.length) return "";
    const parts: string[] = [];
    for (const f of this._filters) {
      switch (f.type) {
        case "eq":
          params.push(f.val);
          parts.push(`"${f.col}" = $${params.length}`);
          break;
        case "neq":
          params.push(f.val);
          parts.push(`"${f.col}" != $${params.length}`);
          break;
        case "gt":
          params.push(f.val);
          parts.push(`"${f.col}" > $${params.length}`);
          break;
        case "gte":
          params.push(f.val);
          parts.push(`"${f.col}" >= $${params.length}`);
          break;
        case "lt":
          params.push(f.val);
          parts.push(`"${f.col}" < $${params.length}`);
          break;
        case "lte":
          params.push(f.val);
          parts.push(`"${f.col}" <= $${params.length}`);
          break;
        case "like":
          params.push(f.val);
          parts.push(`"${f.col}" LIKE $${params.length}`);
          break;
        case "ilike":
          params.push(f.val);
          parts.push(`"${f.col}" ILIKE $${params.length}`);
          break;
        case "is":
          if (f.val === null) {
            parts.push(`"${f.col}" IS NULL`);
          } else if (f.val === true) {
            parts.push(`"${f.col}" IS TRUE`);
          } else if (f.val === false) {
            parts.push(`"${f.col}" IS FALSE`);
          } else {
            params.push(f.val);
            parts.push(`"${f.col}" IS $${params.length}`);
          }
          break;
        case "in": {
          if (!f.val.length) {
            parts.push("FALSE");
          } else {
            const placeholders = f.val.map((v) => {
              params.push(v);
              return `$${params.length}`;
            });
            parts.push(`"${f.col}" IN (${placeholders.join(",")})`);
          }
          break;
        }
        case "or":
          parts.push(`(${this._parseOrExpr(f.expr, params)})`);
          break;
        case "match":
          for (const [k, v] of Object.entries(f.obj)) {
            params.push(v);
            parts.push(`"${k}" = $${params.length}`);
          }
          break;
        case "not":
          if (f.op === "is" && f.val === null) {
            parts.push(`"${f.col}" IS NOT NULL`);
          } else if (f.op === "eq") {
            params.push(f.val);
            parts.push(`"${f.col}" != $${params.length}`);
          } else if (f.op === "in" && Array.isArray(f.val)) {
            if (!(f.val as unknown[]).length) {
              parts.push("TRUE");
            } else {
              const pl = (f.val as unknown[]).map((v) => { params.push(v); return `$${params.length}`; });
              parts.push(`"${f.col}" NOT IN (${pl.join(",")})`);
            }
          } else {
            params.push(f.val);
            parts.push(`NOT ("${f.col}" = $${params.length})`);
          }
          break;
        case "contains":
          params.push(JSON.stringify(f.val));
          parts.push(`"${f.col}" @> $${params.length}::jsonb`);
          break;
        case "containedBy":
          params.push(JSON.stringify(f.val));
          parts.push(`"${f.col}" <@ $${params.length}::jsonb`);
          break;
        case "textSearch":
          params.push(f.query);
          parts.push(`"${f.col}" @@ plainto_tsquery(${f.config ? `'${f.config}',` : ""}$${params.length})`);
          break;
      }
    }
    return ` WHERE ${parts.join(" AND ")}`;
  }

  /**
   * Parse OR expressions like:
   *   "email.ilike.%query%,full_name.ilike.%query%"
   */
  private _parseOrExpr(expr: string, params: unknown[]): string {
    const parts = expr.split(",").map((segment) => {
      const dot1 = segment.indexOf(".");
      if (dot1 === -1) return segment;
      const col = segment.slice(0, dot1);
      const rest = segment.slice(dot1 + 1);
      const dot2 = rest.indexOf(".");
      if (dot2 === -1) return segment;
      const op = rest.slice(0, dot2);
      const val = rest.slice(dot2 + 1);

      switch (op) {
        case "eq":
          params.push(val);
          return `"${col}" = $${params.length}`;
        case "neq":
          params.push(val);
          return `"${col}" != $${params.length}`;
        case "ilike":
          params.push(val);
          return `"${col}" ILIKE $${params.length}`;
        case "like":
          params.push(val);
          return `"${col}" LIKE $${params.length}`;
        case "gt":
          params.push(val);
          return `"${col}" > $${params.length}`;
        case "gte":
          params.push(val);
          return `"${col}" >= $${params.length}`;
        case "lt":
          params.push(val);
          return `"${col}" < $${params.length}`;
        case "lte":
          params.push(val);
          return `"${col}" <= $${params.length}`;
        case "is":
          if (val === "null") return `"${col}" IS NULL`;
          return `"${col}" IS ${val}`;
        default:
          params.push(val);
          return `"${col}" = $${params.length}`;
      }
    });
    return parts.join(" OR ");
  }

  private _buildOrderBy(): string {
    if (!this._orders.length) return "";
    const parts = this._orders.map((o) => {
      let s = `"${o.col}" ${o.ascending ? "ASC" : "DESC"}`;
      if (o.nullsFirst === true) s += " NULLS FIRST";
      else if (o.nullsFirst === false) s += " NULLS LAST";
      return s;
    });
    return ` ORDER BY ${parts.join(", ")}`;
  }

  private _buildLimit(): string {
    if (this._rangeFrom !== null && this._rangeTo !== null) {
      const limit = this._rangeTo - this._rangeFrom + 1;
      return ` LIMIT ${limit} OFFSET ${this._rangeFrom}`;
    }
    if (this._limitVal !== null) return ` LIMIT ${this._limitVal}`;
    if (this._single || this._maybeSingle) return " LIMIT 1";
    return "";
  }

  private _colsToSql(cols: string): string {
    if (cols === "*") return "*";
    return cols
      .split(",")
      .map((c) => {
        const trimmed = c.trim();
        if (trimmed.includes("(")) return trimmed; // count(*), etc.
        return trimmed;
      })
      .join(", ");
  }

  // ── SELECT ──

  private async _execSelect(): Promise<BuilderResult<unknown>> {
    const params: unknown[] = [];
    const cols = this._headOnly ? "count(*) as __count" : this._colsToSql(this._selectCols);
    let sql = `SELECT ${cols} FROM "${this._table}"`;
    sql += this._buildWhere(params);
    sql += this._buildOrderBy();
    sql += this._buildLimit();

    const result = await rlsQuery(sql, params);

    if (this._headOnly || this._countMode) {
      // Need to get count in a separate query
      const countParams: unknown[] = [];
      let countSql = `SELECT count(*) as __count FROM "${this._table}"`;
      countSql += this._buildWhere(countParams);
      const countResult = await rlsQuery(countSql, countParams);
      const count = parseInt(countResult.rows[0]?.__count || "0", 10);
      if (this._headOnly) {
        return { data: null, error: null, count };
      }
      if (this._single) {
        return { data: result.rows[0] || null, error: result.rows[0] ? null : { message: "No rows returned", code: "PGRST116" }, count };
      }
      if (this._maybeSingle) {
        return { data: result.rows[0] || null, error: null, count };
      }
      return { data: result.rows, error: null, count };
    }

    if (this._single) {
      if (!result.rows.length) {
        return { data: null, error: { message: "No rows returned", code: "PGRST116" } };
      }
      return { data: result.rows[0], error: null };
    }
    if (this._maybeSingle) {
      return { data: result.rows[0] || null, error: null };
    }
    return { data: result.rows, error: null };
  }

  // ── INSERT ──

  private async _execInsert(): Promise<BuilderResult<unknown>> {
    if (!this._payload.length) {
      return { data: null, error: { message: "No data to insert" } };
    }
    const allKeys = Array.from(
      new Set(this._payload.flatMap((r) => Object.keys(r))),
    );
    const params: unknown[] = [];
    const valueGroups: string[] = [];
    for (const row of this._payload) {
      const placeholders: string[] = [];
      for (const key of allKeys) {
        const val = row[key];
        if (val !== undefined) {
          params.push(this._serializeValue(val));
          placeholders.push(`$${params.length}`);
        } else {
          placeholders.push("DEFAULT");
        }
      }
      valueGroups.push(`(${placeholders.join(", ")})`);
    }

    const colList = allKeys.map((k) => `"${k}"`).join(", ");
    const returning = this._returningCols
      ? ` RETURNING ${this._colsToSql(this._returningCols)}`
      : "";
    const sql = `INSERT INTO "${this._table}" (${colList}) VALUES ${valueGroups.join(", ")}${returning}`;
    const result = await rlsQuery(sql, params);

    if (this._single) {
      return { data: result.rows[0] || null, error: result.rows[0] ? null : { message: "No rows returned", code: "PGRST116" } };
    }
    if (this._maybeSingle) {
      return { data: result.rows[0] || null, error: null };
    }
    return { data: result.rows.length ? result.rows : null, error: null };
  }

  // ── UPDATE ──

  private async _execUpdate(): Promise<BuilderResult<unknown>> {
    const entries = Object.entries(this._updatePayload);
    if (!entries.length) {
      return { data: null, error: { message: "No data to update" } };
    }
    const params: unknown[] = [];
    const setClauses = entries.map(([key, val]) => {
      params.push(this._serializeValue(val));
      return `"${key}" = $${params.length}`;
    });
    const returning = this._returningCols
      ? ` RETURNING ${this._colsToSql(this._returningCols)}`
      : "";
    let sql = `UPDATE "${this._table}" SET ${setClauses.join(", ")}`;
    sql += this._buildWhere(params);
    sql += returning;

    const result = await rlsQuery(sql, params);

    if (this._single) {
      return { data: result.rows[0] || null, error: result.rows[0] ? null : { message: "No rows returned", code: "PGRST116" } };
    }
    if (this._maybeSingle) {
      return { data: result.rows[0] || null, error: null };
    }
    return { data: result.rows.length ? result.rows : null, error: null };
  }

  // ── DELETE ──

  private async _execDelete(): Promise<BuilderResult<unknown>> {
    const params: unknown[] = [];
    const returning = this._returningCols
      ? ` RETURNING ${this._colsToSql(this._returningCols)}`
      : "";
    let sql = `DELETE FROM "${this._table}"`;
    sql += this._buildWhere(params);
    sql += returning;

    const result = await rlsQuery(sql, params);
    return { data: result.rows.length ? result.rows : null, error: null };
  }

  // ── UPSERT ──

  private async _execUpsert(): Promise<BuilderResult<unknown>> {
    if (!this._payload.length) {
      return { data: null, error: { message: "No data to upsert" } };
    }
    const allKeys = Array.from(
      new Set(this._payload.flatMap((r) => Object.keys(r))),
    );
    const params: unknown[] = [];
    const valueGroups: string[] = [];
    for (const row of this._payload) {
      const placeholders: string[] = [];
      for (const key of allKeys) {
        const val = row[key];
        if (val !== undefined) {
          params.push(this._serializeValue(val));
          placeholders.push(`$${params.length}`);
        } else {
          placeholders.push("DEFAULT");
        }
      }
      valueGroups.push(`(${placeholders.join(", ")})`);
    }

    const colList = allKeys.map((k) => `"${k}"`).join(", ");
    const conflictCols = this._onConflict || allKeys[0];
    const updateCols = allKeys
      .filter((k) => k !== this._onConflict)
      .map((k) => `"${k}" = EXCLUDED."${k}"`)
      .join(", ");
    const returning = this._returningCols
      ? ` RETURNING ${this._colsToSql(this._returningCols)}`
      : "";

    const sql = `INSERT INTO "${this._table}" (${colList}) VALUES ${valueGroups.join(", ")}
      ON CONFLICT (${conflictCols.split(",").map((c) => `"${c.trim()}"`).join(",")})
      DO UPDATE SET ${updateCols}${returning}`;

    const result = await rlsQuery(sql, params);

    if (this._single) {
      return { data: result.rows[0] || null, error: null };
    }
    return { data: result.rows.length ? result.rows : null, error: null };
  }

  // ── Helpers ──

  private _serializeValue(val: unknown): unknown {
    if (val === null || val === undefined) return null;
    if (typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      return JSON.stringify(val);
    }
    return val;
  }
}

/**
 * Create a chainable query builder — wraps .select() after mutation
 * to set RETURNING instead of starting a new SELECT.
 */
function createChainableBuilder<T>(table: string): QueryBuilder<T> {
  const builder = new QueryBuilder<T>(table);

  const origInsert = builder.insert.bind(builder);
  const origUpdate = builder.update.bind(builder);
  const origUpsert = builder.upsert.bind(builder);
  const origDelete = builder.delete.bind(builder);

  (builder as any).insert = (rows: any) => {
    origInsert(rows);
    const origSelect = builder.select.bind(builder);
    (builder as any).select = (cols?: string) => {
      (builder as any)._returningCols = cols || "*";
      (builder as any).select = origSelect;
      return builder;
    };
    return builder;
  };

  (builder as any).update = (data: any) => {
    origUpdate(data);
    const origSelect = builder.select.bind(builder);
    (builder as any).select = (cols?: string) => {
      (builder as any)._returningCols = cols || "*";
      (builder as any).select = origSelect;
      return builder;
    };
    return builder;
  };

  (builder as any).upsert = (rows: any, opts?: any) => {
    origUpsert(rows, opts);
    const origSelect = builder.select.bind(builder);
    (builder as any).select = (cols?: string) => {
      (builder as any)._returningCols = cols || "*";
      (builder as any).select = origSelect;
      return builder;
    };
    return builder;
  };

  (builder as any).delete = () => {
    origDelete();
    const origSelect = builder.select.bind(builder);
    (builder as any).select = (cols?: string) => {
      (builder as any)._returningCols = cols || "*";
      (builder as any).select = origSelect;
      return builder;
    };
    return builder;
  };

  return builder as any;
}

// ─── RPC Support ────────────────────────────────────────────────────

class RpcBuilder<T = Record<string, unknown>> {
  private _fn: string;
  private _params: Record<string, unknown>;
  private _single = false;
  private _maybeSingle = false;

  constructor(fn: string, params: Record<string, unknown>) {
    this._fn = fn;
    this._params = params;
  }

  single<U = T>(): Promise<BuilderResult<U>> {
    this._single = true;
    return this._execute() as Promise<BuilderResult<U>>;
  }

  maybeSingle<U = T>(): Promise<BuilderResult<U>> {
    this._maybeSingle = true;
    return this._execute() as Promise<BuilderResult<U>>;
  }

  returns<U = T>(): this {
    return this;
  }

  then<TResult = BuilderResult<T>>(
    resolve: (val: BuilderResult<T>) => TResult | PromiseLike<TResult>,
    reject?: (reason: unknown) => TResult | PromiseLike<TResult>,
  ): Promise<TResult> {
    return this._execute().then(resolve as any, reject as any);
  }

  private async _execute(): Promise<BuilderResult<unknown>> {
    try {
      const keys = Object.keys(this._params);
      // pg driver serialises JS arrays as PostgreSQL array literals ({…}),
      // which is invalid for JSONB parameters.  JSON.stringify any
      // array/object values so pg sends them as text that PG can cast to JSONB.
      const values = Object.values(this._params).map((v) =>
        v !== null && typeof v === "object" && !Buffer.isBuffer(v) && !(v instanceof Date)
          ? JSON.stringify(v)
          : v,
      );
      const argList = keys.map((k, i) => `${k} := $${i + 1}`).join(", ");
      const sql = `SELECT * FROM ${this._fn}(${argList})`;

      const result = await rlsQuery(sql, values);

      // PostgreSQL wraps scalar/JSONB function results as { fn_name: value }.
      // Unwrap to match PostgREST-style behaviour.
      let rows = result.rows;
      if (rows.length === 1) {
        const cols = Object.keys(rows[0]);
        if (cols.length === 1 && cols[0] === this._fn) {
          const unwrapped = rows[0][this._fn];
          if (this._single) {
            return { data: unwrapped, error: unwrapped != null ? null : { message: "No rows", code: "PGRST116" } };
          }
          if (this._maybeSingle) {
            return { data: unwrapped, error: null };
          }
          return { data: unwrapped, error: null };
        }
      }

      if (this._single) {
        return { data: rows[0] || null, error: rows[0] ? null : { message: "No rows", code: "PGRST116" } };
      }
      if (this._maybeSingle) {
        return { data: rows[0] || null, error: null };
      }
      return { data: rows, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }
}

// ─── Auth Admin Shim ────────────────────────────────────────────────
// Direct DB queries for auth admin operations
// against the users table for AWS RDS.

class AuthAdmin {
  async getUserById(id: string): Promise<{ data: { user: any } | null; error: any }> {
    try {
      const { rows } = await rlsQuery(
        `SELECT id, email, phone_number as phone, role, church_id, full_name, created_at FROM users WHERE auth_user_id = $1 OR id::text = $1`,
        [id],
      );
      if (!rows.length) return { data: null, error: { message: "User not found" } };
      const u = rows[0];
      return {
        data: {
          user: {
            id: u.id,
            email: u.email,
            phone: u.phone,
            user_metadata: { full_name: u.full_name, role: u.role, church_id: u.church_id },
            app_metadata: {},
          },
        },
        error: null,
      };
    } catch (err: any) {
      return { data: null, error: { message: err.message } };
    }
  }

  async updateUserById(
    id: string,
    data: { user_metadata?: Record<string, unknown>; email_change_token_new?: string },
  ): Promise<{ data: { user: any }; error: any }> {
    if (data.user_metadata?.role || data.user_metadata?.church_id || data.user_metadata?.full_name) {
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.user_metadata.role !== undefined) { updates.push(`role = $${idx++}`); values.push(data.user_metadata.role); }
      if (data.user_metadata.church_id !== undefined) { updates.push(`church_id = $${idx++}`); values.push(data.user_metadata.church_id); }
      if (data.user_metadata.full_name !== undefined) { updates.push(`full_name = $${idx++}`); values.push(data.user_metadata.full_name); }
      if (updates.length) {
        values.push(id);
        await rlsQuery(
          `UPDATE users SET ${updates.join(", ")} WHERE auth_user_id = $${idx} OR id::text = $${idx}`,
          values,
        );
      }
    }
    return this.getUserById(id) as any;
  }

  async listUsers(opts?: { perPage?: number; page?: number }): Promise<{ data: { users: any[] }; error: any }> {
    const limit = opts?.perPage || 50;
    const offset = ((opts?.page || 1) - 1) * limit;
    const { rows } = await rlsQuery(
      `SELECT id, email, phone_number as phone, role, church_id, full_name, created_at FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return {
      data: {
        users: rows.map((u: any) => ({
          id: u.id,
          email: u.email,
          phone: u.phone,
          user_metadata: { role: u.role, church_id: u.church_id, full_name: u.full_name },
        })),
      },
      error: null,
    };
  }

  async createUser(data: {
    phone?: string;
    email?: string;
    password?: string;
    user_metadata?: Record<string, unknown>;
  }): Promise<{ data: { user: any }; error: any }> {
    const { rows } = await rlsQuery(
      `INSERT INTO users (email, phone_number, full_name, role, church_id, created_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id, email, phone_number as phone, full_name, role, church_id`,
      [
        data.email || '',
        data.phone || null,
        (data.user_metadata?.full_name as string) || null,
        (data.user_metadata?.role as string) || 'member',
        (data.user_metadata?.church_id as string) || null,
      ],
    );
    const u = rows[0];
    return {
      data: {
        user: { id: u.id, email: u.email, phone: u.phone, user_metadata: data.user_metadata || {} },
      },
      error: null,
    };
  }
}

// ─── Main export: Database client ───────────────────────────────────────

export const db = {
  from<T = Record<string, unknown>>(table: string) {
    return createChainableBuilder<T>(table);
  },
  rpc<T = Record<string, unknown>>(fn: string, params: Record<string, unknown> = {}) {
    return new RpcBuilder<T>(fn, params);
  },
  auth: {
    admin: new AuthAdmin(),
    async getUser(_token: string): Promise<{ data: { user: any } | null; error: any }> {
      // JWT-based auth — return null to trigger JWT verification fallback
      return { data: null, error: { message: "Use JWT verification instead" } };
    },
  },
};
