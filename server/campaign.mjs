// A campaign's rules: its fields, its looks, the variants it starts with, the checks every variant passes, and how a variant becomes a
// render. Pure functions over the campaign's campaign.json, so they are tested without calling the API.

import { parse } from "csv-parse/sync";

export const MAX_ROWS = 100;

// The files an image field may use: its original and everything in its library folders.
export function choicesFor(column, templateFiles) {
  const folders = [column.library, column.tall?.library].filter(Boolean);
  return [column.original, ...templateFiles.filter((path) => folders.some((folder) => path.startsWith(folder))).sort()];
}

export function isTall(column, path) {
  return Boolean(column.tall && path.startsWith(column.tall.library));
}

// A look is one set of art: the files that share a name, such as night.png and night.jpg, across the image fields' library folders.
export function fileForLook(column, look, templateFiles) {
  if (look === "original") return column.original;
  return choicesFor(column, templateFiles).find((path) => baseName(path) === look);
}

// The starting variants. A row names its look and any field it sets itself; every other image field takes the look's file.
export function startingRows(campaign, templateFiles) {
  return campaign.rows.map(({ look = "original", ...row }) => {
    const filled = { ...row };
    if (campaign.effects && filled.effect === undefined) filled.effect = campaign.effects.items[0].id;
    for (const column of campaign.columns) {
      if (filled[column.id] !== undefined) continue;
      filled[column.id] = column.kind === "image" ? fileForLook(column, look, templateFiles) ?? column.original : column.default ?? "";
    }
    return filled;
  });
}

// Every row is checked before anything is queued or charged. Only files the template carries can be chosen, so a row can never point a
// render at a path the browser made up.
export function checkRows(columns, rows, templateFiles, effects = null) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Choose at least one variant to render.");
  if (rows.length > MAX_ROWS) throw new Error(`This example renders up to ${MAX_ROWS} variants at once.`);
  const names = new Set();
  rows.forEach((row, i) => {
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    const at = name ? `"${name}"` : `Variant ${i + 1}`;
    if (!name || name.length > 80 || /[\\/\p{Cc}]/u.test(name)) throw new Error(`${at}: give the variant a name of 1 to 80 characters, without slashes.`);
    if (names.has(name.toLowerCase())) throw new Error(`${at}: the name is used twice.`);
    names.add(name.toLowerCase());
    for (const column of columns) {
      const value = row[column.id];
      if (column.kind === "text") {
        if (typeof value !== "string" || value.length > column.maxLength) throw new Error(`${at}: ${column.label} must be text of at most ${column.maxLength} characters.`);
      } else if (!choicesFor(column, templateFiles).includes(value)) {
        throw new Error(`${at}: ${column.label} must be one of the template's ${column.label.toLowerCase()} files.`);
      }
    }
    if (effects && row.effect !== undefined && !effects.items.some((e) => e.id === row.effect)) {
      throw new Error(`${at}: ${effects.label} must be one of ${effects.items.map((e) => e.label).join(", ")}.`);
    }
  });
}

// A replacement only for what differs from the template. Line breaks are sent as the carriage returns text layers use; a file from the
// version is fitted into the layer's space. The card's motion is not a replacement: it picks which version the render uses.
export function toRenderItem(columns, row, layerIds, templateTexts) {
  const replacements = [];
  for (const column of columns) {
    const layer = layerIds.get(column.layer);
    if (!layer) throw new Error(`The template has no layer named "${column.layer}".`);
    if (column.kind === "text") {
      const text = row[column.id].trim().replace(/\r?\n/g, "\r");
      if (text && text !== (templateTexts.get(column.layer) ?? "").replace(/\r?\n/g, "\r")) replacements.push({ layer, text });
    } else if (row[column.id] !== column.original) {
      const path = row[column.id];
      replacements.push({ layer, path, fit: column.fit ?? "contain" });
      // A tall card also fills the field's own layer, small and hidden under the tall copy, because a replacement cannot empty a layer.
      if (isTall(column, path)) {
        const tall = layerIds.get(column.tall.layer);
        if (!tall) throw new Error(`The template has no layer named "${column.tall.layer}".`);
        replacements.push({ layer: tall, path, fit: "contain" });
      }
    }
  }
  return { name: row.name.trim(), format: "hls", quality: "high", replacements };
}

// A CSV with a "Variant" column, a column per field label, and one named after the effects' label, such as "Motion", when the campaign
// has effects. Image cells name a file, such as night.png, or say "original".
export function rowsFromCsv(columns, csv, templateFiles, effects = null) {
  const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  const rows = records.map((record, i) => {
    const row = { name: record.Variant ?? record.name ?? "" };
    for (const column of columns) {
      const cell = record[column.label] ?? "";
      if (column.kind === "text") {
        row[column.id] = cell;
        continue;
      }
      const match = !cell || cell.toLowerCase() === "original"
        ? column.original
        : choicesFor(column, templateFiles).find((path) => path.toLowerCase().endsWith(`/${cell.toLowerCase()}`));
      if (!match) throw new Error(`Row ${i + 2}: ${column.label} "${cell}" is not one of the template's files.`);
      row[column.id] = match;
    }
    if (effects) {
      const cell = (record[effects.label] ?? "").toLowerCase();
      const effect = cell ? effects.items.find((e) => e.id === cell || e.label.toLowerCase() === cell) : effects.items[0];
      if (!effect) throw new Error(`Row ${i + 2}: ${effects.label} "${record[effects.label]}" must be one of ${effects.items.map((e) => e.label).join(", ")}.`);
      row.effect = effect.id;
    }
    return row;
  });
  checkRows(columns, rows, templateFiles, effects);
  return rows;
}

function baseName(path) {
  return path.split("/").at(-1).replace(/\.[^.]+$/, "");
}
