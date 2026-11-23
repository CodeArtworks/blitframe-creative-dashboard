// Pure helpers for the variant cards, tested without a browser.

const FINISHED = ["succeeded", "failed", "cancelled"];

export function isFinished(render) {
  return FINISHED.includes(render?.status);
}

// What a card would render. A card whose last render matches it, and did not fail or stop, is not rendered again.
export function signature(row, columns) {
  return JSON.stringify([row.name.trim(), row.effect ?? null, ...columns.map((c) => row[c.id])]);
}

export function needsRender(row, columns) {
  return !row.render || row.render.status === "failed" || row.render.status === "cancelled" || row.renderedAs !== signature(row, columns);
}

// A render's first playable stream address is kept: replacing it on every status call would restart its player.
export function mergeRender(current, latest) {
  return { ...latest, hlsUrl: current?.hlsUrl ?? latest.hlsUrl, posterUrl: latest.posterUrl ?? current?.posterUrl };
}

export function cardStatus(row, columns) {
  const render = row.render;
  if (!render) return { tone: "draft", text: "Not rendered" };
  if (render.status !== "queued" && render.status !== "rendering" && row.renderedAs !== signature(row, columns)) return { tone: "draft", text: "Changed" };
  if (render.status === "succeeded") return { tone: "ready", text: "Ready" };
  if (render.status === "failed") return { tone: "failed", text: "Failed" };
  if (render.status === "cancelled") return { tone: "draft", text: "Stopped" };
  if (render.status === "rendering") return render.hlsUrl ? { tone: "live", text: "Live" } : { tone: "busy", text: "Rendering" };
  return { tone: "busy", text: "Queued" };
}

// The look a file belongs to: its name in a library folder, or "original" for the template's own art.
export function lookOf(path) {
  return path.includes("/library/") ? path.split("/").at(-1).replace(/\.[^.]+$/, "") : "original";
}

// The look every image column shares, or null when the art is mixed.
export function sharedLook(row, imageColumns) {
  const looks = new Set(imageColumns.map((c) => lookOf(row[c.id])));
  return looks.size === 1 ? [...looks][0] : null;
}

// Splits pretty-printed JSON into coloured tokens (keys, strings, numbers, literals) and the plain text between them.
export function jsonTokens(json) {
  const tokens = [];
  let last = 0;
  for (const match of json.matchAll(/("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?/g)) {
    tokens.push({ kind: null, text: json.slice(last, match.index) });
    const kind = match[2] ? "key" : match[1] ? "string" : /^[tfn]/.test(match[0]) ? "literal" : "number";
    tokens.push({ kind, text: match[1] ?? match[0] }, { kind: null, text: match[2] ?? "" });
    last = match.index + match[0].length;
  }
  tokens.push({ kind: null, text: json.slice(last) });
  return tokens.filter((token) => token.text);
}

export function uniqueName(rows, base) {
  const taken = new Set(rows.map((row) => row.name.toLowerCase()));
  let n = 1;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

// The cards as a CSV the server's import reads back: image cells hold the file name, or "original", and the effect its id.
export function campaignCsv(rows, columns, effects = null) {
  const cell = (value) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  const header = ["Variant", ...columns.map((c) => c.label), ...(effects ? [effects.label] : [])];
  const lines = rows.map((row) => [row.name, ...columns.map((c) => {
    const value = row[c.id] ?? "";
    if (c.kind !== "image") return value;
    return value === c.original ? "original" : value.split("/").at(-1);
  }), ...(effects ? [row.effect ?? effects.items[0].id] : [])]);
  return [header, ...lines].map((line) => line.map(cell).join(",")).join("\n") + "\n";
}
