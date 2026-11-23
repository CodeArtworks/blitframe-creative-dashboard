// The dashboard's server side, run by Vite. It keeps the API key out of the browser: the page calls these /api routes, and this calls Blitframe.

import { randomUUID } from "node:crypto";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Blitframe, BlitframeError, DEFAULT_API } from "./blitframe.mjs";
import { checkRows, choicesFor, rowsFromCsv, startingRows, toRenderItem } from "./campaign.mjs";
import { withMotion } from "./motion.mjs";

const CAMPAIGNS = resolve("campaigns");
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".csv": "text/csv; charset=utf-8" };

class InvalidInput extends Error {}

export function dashboardApi(apiKey, apiAddress) {
  return {
    name: "blitframe-dashboard-api",
    configureServer(server) {
      let key = apiKey ?? "";
      let blitframe = new Blitframe(key, apiAddress || DEFAULT_API);
      const loaded = new Map();
      // Each campaign's template is pushed on its first request and reused after that; a failed push is tried again on the next one.
      // campaign.json and the examples are read on every request, so edits to them show without a restart.
      const ready = (id) => {
        if (!loaded.has(id)) loaded.set(id, pushTemplate(blitframe, id).catch((error) => {
          loaded.delete(id);
          throw error;
        }));
        return loaded.get(id);
      };
      const campaignOf = async (id) => {
        if (!(await campaignIds()).includes(id)) throw new InvalidInput("Unknown campaign.");
        const [config, examples] = await Promise.all([readCampaign(id), readExamples(id)]);
        return { id, config, examples, ...(await ready(id)) };
      };

      const routes = {
        // Whether this server has a key Blitframe accepts. Only the key's last characters ever reach the page.
        "GET /api/connection": async () => {
          if (!key) return { connected: false };
          try {
            return { connected: true, keyHint: hint(key), plan: plan(await blitframe.usage()) };
          } catch (error) {
            if (error instanceof BlitframeError && error.status === 401) return { connected: false, error: "Blitframe refused the saved key. Paste another one." };
            throw error;
          }
        },

        // A key from the page: checked against Blitframe, then kept by this server and saved to .env for the next start.
        "POST /api/connection": async (body) => {
          const candidate = String(body?.apiKey ?? "").trim();
          if (!/^[\w-]{16,200}$/.test(candidate)) throw new InvalidInput("Paste the whole API key, as the console shows it.");
          const client = new Blitframe(candidate, apiAddress || DEFAULT_API);
          let usage;
          try {
            usage = await client.usage();
          } catch (error) {
            if (error instanceof BlitframeError && error.status === 401) throw new InvalidInput("Blitframe refused this key. Check it in the console and paste it again.");
            throw error;
          }
          key = candidate;
          blitframe = client;
          loaded.clear();
          await saveKey(candidate);
          return { connected: true, keyHint: hint(candidate), plan: plan(usage) };
        },

        "GET /api/campaigns": async () => {
          const list = await Promise.all((await campaignIds()).map(async (id) => ({ id, ...(await readCampaign(id)) })));
          return { campaigns: list.sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map(({ id, name, tagline }) => ({ id, name, tagline })) };
        },

        "GET /api/dashboard": async (_body, url) => {
          const c = await campaignOf(url.searchParams.get("campaign"));
          const usage = await blitframe.usage();
          return {
            campaign: { id: c.id, name: c.config.name, description: c.config.description, project: c.config.project },
            versionId: c.version.id,
            template: c.size,
            plan: plan(usage),
            columns: c.config.columns.map((column) => ({
              ...column,
              files: column.kind === "image" ? choicesFor(column, c.version.files) : undefined,
            })),
            looks: c.config.looks ?? null,
            effects: c.config.effects ?? null,
            preview: c.config.preview ?? [],
            examples: c.examples,
            rows: startingRows(c.config, c.version.files),
          };
        },

        // The rows as live HLS renders, each playable while it renders: one batch for each motion, because each motion is a version of
        // its own. The page shows the requests it sent, and gets the renders back in the order of its rows.
        "POST /api/renders": async (body) => {
          const c = await campaignOf(body.campaign);
          const batches = batchRequests(c, checked(c, body.rows));
          const renders = [];
          for (const batch of batches) {
            const queued = await blitframe.renderBatch(batch.version, batch.request.body.renders, randomUUID());
            batch.rows.forEach((row, i) => { renders[row] = summary(queued[i]); });
          }
          return { renders, requests: batches.map((b) => b.request) };
        },

        // The same requests, built but not sent, so the page can show what Render would send.
        "POST /api/request": async (body) => {
          const c = await campaignOf(body.campaign);
          return { requests: batchRequests(c, checked(c, body.rows)).map((b) => b.request) };
        },

        // A CSV the person chose, or one of the campaign's examples by file name.
        "POST /api/csv": async (body) => {
          const c = await campaignOf(body.campaign);
          let csv = String(body.csv ?? "");
          if (body.example) {
            if (!c.examples.includes(body.example)) throw new InvalidInput("Unknown example.");
            csv = await readFile(resolve(CAMPAIGNS, c.id, "examples", body.example), "utf8");
          }
          try {
            return { rows: rowsFromCsv(c.config.columns, csv, c.version.files, c.config.effects) };
          } catch (error) {
            throw new InvalidInput(error.message);
          }
        },

        "GET /api/usage": async () => plan(await blitframe.usage()),
        "POST /api/statuses": async (body) => ({ renders: (await blitframe.statuses(ids(body))).map(summary) }),
        "POST /api/cancel": async (body) => ({ renders: (await blitframe.cancel(ids(body))).map(summary) }),
        "POST /api/archive": async (body) => ({ id: (await blitframe.createArchive(ids(body), String(body.name ?? "Campaign").slice(0, 80))).id }),
        "POST /api/archive/status": async (body) => {
          const archive = await blitframe.getArchive(ids({ ids: [body.id] })[0]);
          return { status: archive.status, url: archive.url, error: archive.error?.message ?? null };
        },
      };

      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (request.method === "GET" && url.pathname.startsWith("/campaigns/")) return serveCampaignFile(url.pathname, response, next);
        const route = routes[`${request.method} ${url.pathname}`];
        if (!route) return next();
        if (!key && url.pathname !== "/api/connection") return send(response, 401, { error: "Connect your Blitframe API key first.", code: "no_key" });
        try {
          const body = request.method === "POST" ? JSON.parse((await readBody(request)) || "{}") : undefined;
          send(response, 200, await route(body, url));
        } catch (error) {
          if (error instanceof InvalidInput) return send(response, 400, { error: error.message });
          if (error instanceof BlitframeError && error.status < 500) return send(response, error.status, { error: error.message, code: error.code });
          server.config.logger.error(String(error?.stack ?? error));
          send(response, 502, { error: "Blitframe could not be reached. Try again." });
        }
      });
    },
  };
}

async function campaignIds() {
  const folders = (await readdir(CAMPAIGNS, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  const ready = await Promise.all(folders.map((id) => access(resolve(CAMPAIGNS, id, "campaign.json")).then(() => true, () => false)));
  return folders.filter((_, i) => ready[i]);
}

async function readCampaign(id) {
  return JSON.parse(await readFile(resolve(CAMPAIGNS, id, "campaign.json"), "utf8"));
}

async function readExamples(id) {
  return (await readdir(resolve(CAMPAIGNS, id, "examples")).catch(() => [])).filter((f) => f.endsWith(".csv")).sort();
}

// The template, then a variation for each motion effect: the same files, with data.json changed only by the motion's nulls.
async function pushTemplate(blitframe, id) {
  const { project, effects } = await readCampaign(id);
  const folder = resolve(CAMPAIGNS, id, "template");
  const version = await blitframe.pushTemplate(project, folder);
  const { textLayers, imageLayers, videoLayers = [] } = await blitframe.layers(version.id);
  const data = JSON.parse(await readFile(resolve(folder, "data.json"), "utf8"));
  const { w, h, fr, ip, op } = data;
  const versions = new Map();
  for (const effect of effects?.items.filter((e) => e.motion) ?? []) {
    const content = JSON.stringify(withMotion(data, effect.motion));
    versions.set(effect.id, await blitframe.pushVariation(version, `motion-${effect.id}`, [{ path: "data.json", content }]));
  }
  return {
    version,
    versions,
    size: { width: w, height: h, seconds: Math.round((op - ip) / fr) },
    layerIds: new Map([...textLayers, ...imageLayers, ...videoLayers].map((l) => [l.name, l.layer])),
    texts: new Map(textLayers.map((l) => [l.name, l.text])),
  };
}

function hint(apiKey) {
  return `…${apiKey.slice(-4)}`;
}

// The key goes to .env, which git ignores, so the next start connects on its own.
async function saveKey(apiKey) {
  const lines = (await readFile(".env", "utf8").catch(() => "")).split(/\r?\n/).filter((line) => line && !line.startsWith("BLITFRAME_API_KEY="));
  await writeFile(".env", [...lines, `BLITFRAME_API_KEY=${apiKey}`].join("\n") + "\n");
}

function checked(c, rows) {
  try {
    checkRows(c.config.columns, rows, c.version.files, c.config.effects);
  } catch (error) {
    throw new InvalidInput(error.message);
  }
  return rows;
}

function batchRequests(c, rows) {
  const batches = new Map();
  rows.forEach((row, i) => {
    const version = c.versions.get(row.effect) ?? c.version;
    if (!batches.has(version.id)) batches.set(version.id, { version, rows: [], renders: [] });
    batches.get(version.id).rows.push(i);
    batches.get(version.id).renders.push(toRenderItem(c.config.columns, row, c.layerIds, c.texts));
  });
  return [...batches.values()].map(({ version, rows: indexes, renders }) => ({
    version,
    rows: indexes,
    request: { path: `/v1/projects/${version.projectId}/renders/batch`, body: { versionId: version.id, renders } },
  }));
}

function plan(usage) {
  return { name: usage.plan, renderSecondsRemaining: usage.renderSecondsRemaining, unlimited: usage.unlimited === true };
}

function summary(render) {
  return {
    id: render.id,
    name: render.name,
    status: render.status,
    playback: render.playback,
    hlsUrl: render.output?.hlsUrl ?? null,
    mp4Url: render.output?.mp4Url ?? null,
    posterUrl: render.output?.posterUrl ?? null,
    error: render.error?.message ?? null,
  };
}

function ids(body) {
  const list = body?.ids;
  if (!Array.isArray(list) || list.length === 0 || list.length > 1000 || !list.every((id) => /^[0-9a-f-]{36}$/i.test(String(id)))) {
    throw new InvalidInput("Unknown renders.");
  }
  return list;
}

// The campaigns' images and example CSVs, for the cards' previews and the example downloads. Nothing outside campaigns/ is served.
async function serveCampaignFile(pathname, response, next) {
  const file = resolve(CAMPAIGNS, `.${decodeURIComponent(pathname.slice("/campaigns".length))}`);
  if (!file.startsWith(CAMPAIGNS + sep) || !TYPES[extname(file)]) return next();
  try {
    const bytes = await readFile(file);
    response.writeHead(200, { "Content-Type": TYPES[extname(file)], "Cache-Control": "max-age=3600" });
    response.end(bytes);
  } catch {
    next();
  }
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 2_000_000) throw new InvalidInput("The request is too large.");
  }
  return body;
}
