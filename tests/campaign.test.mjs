import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { test } from "node:test";
import { checkRows, rowsFromCsv, startingRows, toRenderItem } from "../server/campaign.mjs";

const columns = [
  { id: "intro", label: "Intro text", kind: "text", layer: "Intro text", maxLength: 24 },
  { id: "details", label: "Details", kind: "text", layer: "Details", maxLength: 80 },
  { id: "headline", label: "Headline", kind: "image", layer: "Headline", original: "images/headline.png", library: "images/library/headline/" },
  { id: "photo", label: "Photo", kind: "image", layer: "Photo", original: "images/photo.jpg", library: "images/library/photo/", fit: "cover" },
];
const files = ["images/library/headline/night.png", "images/library/headline/siege.png", "images/library/photo/night.jpg"];
const layers = new Map([["Intro text", "/assets/9/layers/4"], ["Details", "/assets/9/layers/5"], ["Headline", "/assets/9/layers/1"], ["Photo", "/assets/2/layers/0"]]);
const texts = new Map([["Intro text", "presents"], ["Details", "3 rooms\r2 baths"]]);
const original = { name: "Launch", intro: "presents", details: "3 rooms\n2 baths", headline: "images/headline.png", photo: "images/photo.jpg" };

test("a variant becomes a live HLS render with a replacement only for what differs from the template", () => {
  const row = { ...original, name: " Night ", intro: "presenta", details: "4 rooms\n3 baths", photo: "images/library/photo/night.jpg" };

  assert.deepEqual(toRenderItem(columns, row, layers, texts), {
    name: "Night",
    format: "hls",
    quality: "high",
    replacements: [
      { layer: "/assets/9/layers/4", text: "presenta" },
      { layer: "/assets/9/layers/5", text: "4 rooms\r3 baths" },
      { layer: "/assets/2/layers/0", path: "images/library/photo/night.jpg", fit: "cover" },
    ],
  });
  assert.deepEqual(toRenderItem(columns, original, layers, texts).replacements, []);
});

test("variants are refused before anything is queued: a missing or repeated name, long text, or a file the template does not carry", () => {
  assert.throws(() => checkRows(columns, [{ ...original, name: "" }], files), /Variant 1: give the variant a name/);
  assert.throws(() => checkRows(columns, [original, { ...original }], files), /"Launch": the name is used twice/);
  assert.throws(() => checkRows(columns, [{ ...original, intro: "x".repeat(25) }], files), /Intro text must be text of at most 24/);
  assert.throws(() => checkRows(columns, [{ ...original, photo: "../secrets.jpg" }], files), /Photo must be one of the template's photo files/);
  assert.doesNotThrow(() => checkRows(columns, [original, { ...original, name: "Night", headline: "images/library/headline/night.png" }], files));
});

test("a starting row takes its look's file in every image field, unless it sets the field itself", () => {
  const rows = startingRows({ columns, rows: [{ name: "Night", look: "night", intro: "presents" }, { name: "Mix", look: "night", headline: "images/library/headline/siege.png" }] }, files);

  assert.deepEqual(rows[0], { name: "Night", intro: "presents", details: "", headline: "images/library/headline/night.png", photo: "images/library/photo/night.jpg" });
  assert.equal(rows[1].headline, "images/library/headline/siege.png");
  assert.equal(rows[1].photo, "images/library/photo/night.jpg");
});

test("a CSV names files by file name, keeps line breaks in quoted cells, and an empty cell or 'original' keeps the template's file", () => {
  const rows = rowsFromCsv(columns, 'Variant,Intro text,Details,Headline,Photo\nNight,presents,"4 rooms\n3 baths",night.png,original\n', files);

  assert.deepEqual(rows, [{ name: "Night", intro: "presents", details: "4 rooms\n3 baths", headline: "images/library/headline/night.png", photo: "images/photo.jpg" }]);
  assert.throws(() => rowsFromCsv(columns, "Variant,Intro text,Details,Headline,Photo\nA,x,,missing.png,\n", files), /Row 2: Headline "missing.png"/);
});

test("every campaign's starting rows and example CSVs only use files its template carries, and its motion names real layers", () => {
  for (const id of readdirSync("campaigns")) {
    const folder = join("campaigns", id);
    const campaign = JSON.parse(readFileSync(join(folder, "campaign.json"), "utf8"));
    const templateFiles = readdirSync(join(folder, "template"), { recursive: true }).map((path) => path.split(sep).join("/"));
    assert.doesNotThrow(() => checkRows(campaign.columns, startingRows(campaign, templateFiles), templateFiles, campaign.effects), id);
    for (const csv of readdirSync(join(folder, "examples")).filter((f) => f.endsWith(".csv"))) {
      assert.doesNotThrow(() => rowsFromCsv(campaign.columns, readFileSync(join(folder, "examples", csv), "utf8"), templateFiles, campaign.effects), `${id}/${csv}`);
    }
    const data = JSON.parse(readFileSync(join(folder, "template", "data.json"), "utf8"));
    const names = new Set([data, ...data.assets].flatMap((c) => c.layers ?? []).map((l) => l.nm));
    for (const effect of campaign.effects?.items ?? []) {
      for (const layer of Object.keys(effect.motion ?? {})) assert.ok(names.has(layer), `${id}: ${effect.id} moves "${layer}"`);
    }
  }
});

const effects = {
  label: "Motion",
  items: [
    { id: "original", label: "As designed" },
    { id: "drop", label: "Drop in", motion: { Headline: "drop" } },
  ],
};

test("a motion the campaign does not have is refused, and a CSV names motions by id or label", () => {
  assert.throws(() => checkRows(columns, [{ ...original, effect: "sepia" }], files, effects), /"Launch": Motion must be one of As designed, Drop in/);
  const rows = rowsFromCsv(columns, "Variant,Intro text,Details,Headline,Photo,Motion\nA,presents,,,,drop in\nB,presents,,,,\n", files, effects);

  assert.deepEqual(rows.map((r) => r.effect), ["drop", "original"]);
  assert.deepEqual(toRenderItem(columns, rows[0], layers, texts).replacements, []);
});
