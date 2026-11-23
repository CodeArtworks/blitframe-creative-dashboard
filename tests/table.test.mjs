import assert from "node:assert/strict";
import { test } from "node:test";
import { campaignCsv, cardStatus, jsonTokens, mergeRender, needsRender, sharedLook, signature, uniqueName } from "../src/table.js";

const columns = [
  { id: "intro", label: "Intro text", kind: "text" },
  { id: "headline", label: "Headline", kind: "image", original: "images/headline.png" },
  { id: "offer", label: "Offer", kind: "image", original: "images/offer.png" },
];
const card = { name: "Siege", intro: "presents", headline: "images/library/headline/siege-mode.png", offer: "images/library/offer/siege-mode.png" };

test("only cards that changed since their last good render are rendered again", () => {
  const rendered = { ...card, render: { status: "succeeded" }, renderedAs: signature(card, columns) };

  assert.equal(needsRender(card, columns), true);
  assert.equal(needsRender(rendered, columns), false);
  assert.equal(needsRender({ ...rendered, intro: "presenta" }, columns), true);
  assert.equal(needsRender({ ...rendered, render: { status: "failed" } }, columns), true);
  assert.equal(needsRender({ ...rendered, render: { status: "cancelled" } }, columns), true);
});

test("a render keeps its first stream address, so its player is not restarted by later status calls", () => {
  const merged = mergeRender({ id: "a", status: "rendering", hlsUrl: "https://x/first.m3u8?token=1" },
    { id: "a", status: "succeeded", hlsUrl: "https://x/first.m3u8?token=2", mp4Url: "m", posterUrl: "p" });

  assert.deepEqual(merged, { id: "a", status: "succeeded", hlsUrl: "https://x/first.m3u8?token=1", mp4Url: "m", posterUrl: "p" });
});

test("a card says Live once its stream plays, and Changed once it no longer matches its video", () => {
  const renderedAs = signature(card, columns);

  assert.equal(cardStatus({ ...card, render: { status: "rendering", hlsUrl: "u" }, renderedAs }, columns).text, "Live");
  assert.equal(cardStatus({ ...card, render: { status: "rendering" }, renderedAs }, columns).text, "Rendering");
  assert.equal(cardStatus({ ...card, intro: "x", render: { status: "succeeded" }, renderedAs }, columns).text, "Changed");
});

test("a card's look is the one all its art shares, or none when the art is mixed", () => {
  const images = columns.filter((c) => c.kind === "image");

  assert.equal(sharedLook(card, images), "siege-mode");
  assert.equal(sharedLook({ ...card, headline: "images/headline.png", offer: "images/offer.png" }, images), "original");
  assert.equal(sharedLook({ ...card, headline: "images/headline.png" }, images), null);
});

test("the CSV export names image files the way the import reads them", () => {
  const csv = campaignCsv([{ ...card, name: "Siege, mode" }, { name: "Launch", intro: "", headline: "images/headline.png", offer: "images/offer.png" }], columns);

  assert.equal(csv, 'Variant,Intro text,Headline,Offer\n"Siege, mode",presents,siege-mode.png,siege-mode.png\nLaunch,,original,original\n');
});

test("the request panel colours keys, strings, numbers and literals, and keeps every character", () => {
  const json = JSON.stringify({ name: "Say \"hi\"", quality: "high", n: -1.5, ok: true, gone: null }, null, 2);
  const tokens = jsonTokens(json);

  assert.equal(tokens.map((t) => t.text).join(""), json);
  assert.deepEqual(tokens.filter((t) => t.kind).map((t) => [t.kind, t.text]), [
    ["key", '"name"'], ["string", '"Say \\"hi\\""'], ["key", '"quality"'], ["string", '"high"'], ["key", '"n"'], ["number", "-1.5"],
    ["key", '"ok"'], ["literal", "true"], ["key", '"gone"'], ["literal", "null"],
  ]);
});

test("a new card gets the next free name", () => {
  assert.equal(uniqueName([{ name: "New variant 1" }, { name: "Launch" }], "New variant"), "New variant 2");
});
