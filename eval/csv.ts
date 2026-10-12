/** Minimal CSV read/write, enough for sheets edited in Numbers, Excel or Google Sheets. */

export type Row = Record<string, string>;

function cell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(columns: string[], rows: Row[]): string {
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c] ?? "")).join(","));
  return lines.join("\n") + "\n";
}

export function parseCsv(text: string): Row[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, ""); // Excel adds a byte-order mark
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { record.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      record.push(field); records.push(record); field = ""; record = [];
    } else field += ch;
  }
  if (field !== "" || record.length > 0) { record.push(field); records.push(record); }

  const [header, ...body] = records.filter((r) => r.some((v) => v.trim() !== ""));
  if (!header) return [];
  const cols = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? "").trim()])));
}
