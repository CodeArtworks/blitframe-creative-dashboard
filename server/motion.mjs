// Motion effects restyle how layers enter. Each chosen layer is hung from a new null, placed between the layer and its own parent, that
// plays the entrance around the layer's centre, so the template's own animation still plays inside it. Nulls are only appended to a
// composition, never inserted, so the layer ids replacements use stay the same in every effect's version.

const EASE = { o: 0.2, oy: 0.8, i: 0.3 };

// Each preset is keyframes in frames at 24 fps from the layer's entrance: scale in percent, rotation in degrees, and x or y as a share of
// the composition's width or height away from where the layer rests.
export const PRESETS = {
  slam: { s: [[0, 280], [7, 92], [11, 100]], r: [[0, -10], [7, 2], [11, 0]] },
  pop: { s: [[0, 0], [8, 118], [12, 94], [16, 100]] },
  spin: { s: [[0, 10], [14, 100]], r: [[0, -300], [14, 8], [18, 0]] },
  drop: { y: [[0, -0.9], [10, 0.025], [14, -0.008], [18, 0]] },
  rise: { y: [[0, 0.8], [12, -0.015], [16, 0]] },
  "slide-left": { x: [[0, -1], [11, 0.015], [15, 0]] },
  "slide-right": { x: [[0, 1], [11, -0.015], [15, 0]] },
  swing: { r: [[0, 35], [8, -14], [14, 6], [20, 0]] },
};

// A copy of data.json with the motion applied, given as { "layer name": "preset" }. Every layer of that name moves, in whichever
// composition holds it.
export function withMotion(data, motion) {
  const result = structuredClone(data);
  const comps = [{ layers: result.layers, size: [result.w, result.h] }, ...result.assets.filter((a) => Array.isArray(a.layers))];
  const compSizes = new Map(comps.flatMap((c) => c.layers).filter((l) => l.ty === 0).map((l) => [l.refId, [l.w, l.h]]));
  const imageSizes = new Map(result.assets.filter((a) => a.w && !a.layers).map((a) => [a.id, [a.w, a.h]]));
  for (const [name, preset] of Object.entries(motion)) {
    if (!PRESETS[preset]) throw new Error(`Unknown motion "${preset}" for "${name}".`);
    for (const comp of comps) {
      const size = comp.size ?? compSizes.get(comp.id) ?? [result.w, result.h];
      for (const layer of comp.layers.filter((l) => l.nm === name)) {
        hang(comp, layer, PRESETS[preset], result.fr / 24, size, layer.ty === 2 ? imageSizes.get(layer.refId) : layer.ty === 0 ? [layer.w, layer.h] : null);
      }
    }
  }
  return result;
}

function hang(comp, layer, preset, speed, [w, h], ownSize) {
  const start = entrance(layer);
  const pivot = centre(layer, start + 20 * speed, ownSize);
  const frames = (keys, value) => animated(keys.map(([t, v]) => [start + t * speed, value(v)]));
  const ks = {
    a: { a: 0, k: pivot },
    p: preset.x ? frames(preset.x, (v) => [pivot[0] + v * w, pivot[1], pivot[2]])
      : preset.y ? frames(preset.y, (v) => [pivot[0], pivot[1] + v * h, pivot[2]])
        : { a: 0, k: pivot },
    s: preset.s ? frames(preset.s, (v) => [v, v, 100]) : { a: 0, k: [100, 100, 100] },
    o: { a: 0, k: 100 },
  };
  const rotation = preset.r ? frames(preset.r, (v) => [v]) : { a: 0, k: 0 };
  if (layer.ddd === 1) Object.assign(ks, { rx: { a: 0, k: 0 }, ry: { a: 0, k: 0 }, rz: rotation, or: { a: 0, k: [0, 0, 0] } });
  else ks.r = rotation;
  const ind = Math.max(...comp.layers.map((l) => l.ind)) + 1;
  comp.layers.push({
    ddd: layer.ddd ?? 0, ind, ty: 3, nm: `Motion: ${layer.nm}`, sr: 1, ks, ao: 0,
    ip: Math.min(layer.ip, start), op: layer.op, st: 0, bm: 0, ...(layer.parent === undefined ? {} : { parent: layer.parent }),
  });
  layer.parent = ind;
  layer.ip = start;
  settle(layer.ks.s);
  settle(layer.ks.o);
}

// When the layer first shows: its in point, or later when its own scale or opacity starts from nothing.
function entrance(layer) {
  let start = layer.ip;
  for (const property of [layer.ks.s, layer.ks.o]) if (hidden(property)) start = Math.max(start, property.k[0].t);
  return start;
}

// A layer that grows or fades in by itself starts already grown or faded in, so the motion is all of its entrance and not lost inside
// it. It still appears only when its entrance starts, and later keyframes, such as an exit, still play.
function settle(property) {
  if (!hidden(property)) return;
  const shown = property.k.findIndex((k) => !hidden({ a: 1, k: [k] }));
  if (shown < 0) return;
  for (const k of property.k.slice(0, shown)) k.s = structuredClone(property.k[shown].s);
}

function hidden(property) {
  return property?.a === 1 && Math.max(...[property.k[0].s].flat().slice(0, 2)) <= 1;
}

// Where the middle of an image or precomp sits in its parent's space once it has settled; a text layer turns around its anchor.
function centre(layer, time, ownSize) {
  const p = valueAt(layer.ks.p, time);
  if (!ownSize) return p;
  const a = layer.ks.a ? valueAt(layer.ks.a, time) : [0, 0, 0];
  const s = layer.ks.s ? valueAt(layer.ks.s, time) : [100, 100, 100];
  return [p[0] + (ownSize[0] / 2 - a[0]) * s[0] / 100, p[1] + (ownSize[1] / 2 - a[1]) * s[1] / 100, p[2]];
}

function valueAt(property, time) {
  if (property.s === true) return [valueAt(property.x, time)[0], valueAt(property.y, time)[0], 0];
  const value = property.a === 1 ? (property.k.findLast((k) => k.t <= time) ?? property.k[0]).s : property.k;
  const list = [value].flat();
  return [list[0], list[1] ?? 0, list[2] ?? 0];
}

function animated(keys) {
  const dims = keys[0][1].length;
  return {
    a: 1,
    k: keys.map(([t, s], i) => (i === keys.length - 1 ? { t, s } : {
      t, s,
      o: { x: Array(dims).fill(EASE.o), y: Array(dims).fill(EASE.oy) },
      i: { x: Array(dims).fill(EASE.i), y: Array(dims).fill(1) },
    })),
  };
}
