// Checks a query the agent wrote before it reaches Zetaris: one read-only statement over the
// registered Pluvia views, with a row cap.

export const ALLOWED_VIEWS = /^(ghcn_prcp|stations|policies|claims|power_[a-z0-9_]+|eval_gauge_[a-z0-9_]+)$/;
const FORBIDDEN =
  /\b(create|insert|update|delete|drop|alter|call|merge|truncate|grant|revoke|refresh|cache|uncache|set|use|load|msck|add|replace|exec|execute|copy|optimize|vacuum)\b/i;
export const ROW_CAP = 2000;

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

// Removes comments and quoted text so keywords and semicolons inside them cannot hide a statement.
function skeleton(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`[^`]*`/g, '``');
}

export function guardSql(input: string): GuardResult {
  const sql = String(input ?? '').trim().replace(/;\s*$/, '');
  if (!sql) return { ok: false, reason: 'The query is empty.' };
  if (sql.length > 4000) return { ok: false, reason: 'The query is longer than 4,000 characters.' };
  const bare = skeleton(sql);
  if (/\/\*|--/.test(sql) && /;/.test(bare)) return { ok: false, reason: 'Only one statement is allowed.' };
  if (bare.includes(';')) return { ok: false, reason: 'Only one statement is allowed.' };
  if (!/^\s*(select|with)\b/i.test(bare)) return { ok: false, reason: 'Only SELECT or WITH queries are allowed.' };
  const word = bare.match(FORBIDDEN);
  if (word) return { ok: false, reason: `${word[1]!.toUpperCase()} is not allowed in a read-only query.` };

  const ctes = new Set([...bare.matchAll(/(?:\bwith|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map(m => m[1]!.toLowerCase()));
  // FROM inside EXTRACT, SUBSTRING, TRIM and OVERLAY is part of the function, not a table.
  const tables = bare.replace(/\b(extract|substring|trim|overlay)\s*\([^()]*\)/gi, '0');
  const refs = [...tables.matchAll(/\b(?:from|join)\s+([a-z_][\w.]*)/gi)].map(m => m[1]!.toLowerCase());
  for (const ref of refs) {
    if (ctes.has(ref)) continue;
    const [schema, view, extra] = ref.split('.');
    if (extra !== undefined || schema !== 'pluvia' || !view || !ALLOWED_VIEWS.test(view)) {
      return { ok: false, reason: `${ref} is not an allowed table. Query pluvia views only; list_tables shows them.` };
    }
  }
  if (!refs.length) return { ok: false, reason: 'Query a pluvia view; list_tables shows them.' };
  const capped = /\blimit\s+\d+\s*$/i.test(bare) ? sql : `${sql}\nLIMIT ${ROW_CAP}`;
  return { ok: true, sql: capped };
}
