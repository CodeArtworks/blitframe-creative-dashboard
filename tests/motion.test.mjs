import assert from "node:assert/strict";
import { test } from "node:test";
import { withMotion } from "../server/motion.mjs";

const data = {
  w: 1280, h: 720, fr: 24, ip: 0, op: 120,
  assets: [{ id: "image_0", w: 400, h: 200, u: "images/", p: "card.png" }],
  layers: [
    { ind: 1, ty: 5, nm: "Title", ip: 0, op: 120, parent: 3, ks: { p: { a: 0, k: [10, 20, 0] } } },
    { ind: 2, ty: 2, nm: "Card", refId: "image_0", ip: 12, op: 120, ks: { a: { a: 0, k: [0, 0, 0] }, p: { a: 0, k: [600, 300, 0] }, s: { a: 0, k: [50, 50, 100] } } },
    { ind: 3, ty: 3, nm: "Rig", ip: 0, op: 120, ks: { p: { a: 0, k: [640, 360, 0] } } },
  ],
};

test("a motion hangs each named layer from a new null under its old parent, and leaves every other layer where it was", () => {
  const moved = withMotion(data, { Title: "slide-left", Card: "slam" });

  assert.deepEqual(moved.layers.slice(0, 3).map((l) => [l.ind, l.nm]), [[1, "Title"], [2, "Card"], [3, "Rig"]]);
  const [title, card, rig, titleNull, cardNull] = moved.layers;
  assert.equal(title.parent, titleNull.ind);
  assert.equal(titleNull.parent, 3);
  assert.equal(card.parent, cardNull.ind);
  assert.equal(cardNull.parent, undefined);
  assert.deepEqual(rig, data.layers[2]);
  assert.equal(data.layers[0].parent, 3);
});

test("the null turns around the middle of the image, starts when the layer shows, and comes to rest as no change at all", () => {
  const cardNull = withMotion(data, { Card: "slam" }).layers.at(-1);

  assert.deepEqual(cardNull.ks.a.k, [700, 350, 0]);
  assert.deepEqual(cardNull.ks.p.k, [700, 350, 0]);
  assert.equal(cardNull.ks.s.k[0].t, 12);
  assert.deepEqual(cardNull.ks.s.k.at(-1).s, [100, 100, 100]);
  assert.deepEqual(cardNull.ks.r.k.at(-1).s, [0]);
});

test("a slide starts a composition's width away and ends where the layer rests", () => {
  const titleNull = withMotion(data, { Title: "slide-left" }).layers.at(-1);

  assert.deepEqual(titleNull.ks.p.k[0].s, [10 - 1280, 20, 0]);
  assert.deepEqual(titleNull.ks.p.k.at(-1).s, [10, 20, 0]);
});

test("a layer that pops in by itself starts grown, so the motion is its whole entrance, and its later keyframes still play", () => {
  const pop = { a: 1, k: [{ t: 12, s: [0, 0, 100] }, { t: 20, s: [65, 65, 100] }, { t: 26, s: [55, 55, 100] }, { t: 100, s: [0, 0, 100] }] };
  const layer = { ...data.layers[1], ks: { ...data.layers[1].ks, s: pop } };
  const moved = withMotion({ ...data, layers: [layer] }, { Card: "drop" }).layers[0];

  assert.deepEqual(moved.ks.s.k.map((k) => [k.t, k.s[0]]), [[12, 65], [20, 65], [26, 55], [100, 0]]);
  assert.equal(withMotion({ ...data, layers: [{ ...layer, ip: 0 }] }, { Card: "drop" }).layers[0].ip, 12);
  assert.equal(withMotion({ ...data, layers: [layer] }, { Card: "drop" }).layers[1].ks.p.k[0].t, 12);
});

test("an unknown motion is refused", () => {
  assert.throws(() => withMotion(data, { Card: "teleport" }), /Unknown motion "teleport"/);
});
