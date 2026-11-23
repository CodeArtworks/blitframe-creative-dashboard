// A small Blitframe API client: just the calls this example makes, with one error type.
// API reference: https://codeartworks.com/reference/blitframe

import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const DEFAULT_API = "https://blitframe.codeartworks.com/v1";

export class BlitframeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class Blitframe {
  #api;
  #key;

  constructor(apiKey, api = DEFAULT_API) {
    this.#key = apiKey;
    this.#api = api.replace(/\/$/, "");
  }

  async request(method, path, body, headers = {}) {
    const response = await fetch(this.#api + path, {
      method,
      headers: { Authorization: `Bearer ${this.#key}`, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) throw new BlitframeError(response.status, json.error?.code ?? "unknown", json.error?.message ?? text);
    return json;
  }

  // Finds the project by name, or creates it, then makes its head match the folder. Sending the same files again makes no new
  // version, so restarting the app reuses the template it pushed the first time.
  async pushTemplate(projectName, folder) {
    const { items } = await this.request("GET", `/projects?q=${encodeURIComponent(projectName)}`);
    const project = items.find((p) => p.name === projectName) ?? await this.request("POST", "/projects", { name: projectName });

    const files = [];
    for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const fullPath = join(entry.parentPath, entry.name);
      const path = relative(folder, fullPath).split(sep).join("/");
      const bytes = await readFile(fullPath);
      files.push(path.endsWith(".json") ? { path, content: bytes.toString("utf8") } : { path, contentBase64: bytes.toString("base64") });
    }

    const version = await this.request("POST", `/projects/${project.id}/versions`, { files, message: "Template" });
    if (!version.renderable) throw new Error(`The template cannot be rendered:\n- ${version.problems.join("\n- ")}`);
    return { ...version, projectName, files: files.map((f) => f.path) };
  }

  // Makes a variation start at the version, or brings an existing one back to it, with some files changed. Sending the same files again
  // makes no new version.
  async pushVariation(version, name, files) {
    try {
      await this.request("POST", `/projects/${version.projectId}/variations`, { name, fromVersionId: version.id });
    } catch (error) {
      if (error.code !== "variation_exists") throw error;
    }
    const head = await this.request("POST", `/projects/${version.projectId}/versions`,
      { variation: name, restoreFromVersionId: version.id, files, message: name });
    if (!head.renderable) throw new Error(`The ${name} variation cannot be rendered:\n- ${head.problems.join("\n- ")}`);
    return { ...head, files: version.files };
  }

  layers(versionId) {
    return this.request("GET", `/versions/${versionId}/layers`);
  }

  usage() {
    return this.request("GET", "/usage");
  }

  // All rows are queued, or none, and charged together. The key makes a retry of this exact call safe.
  async renderBatch(version, renders, idempotencyKey) {
    const batch = await this.request("POST", `/projects/${version.projectId}/renders/batch`, { versionId: version.id, renders },
      { "Idempotency-Key": idempotencyKey });
    return batch.renders;
  }

  async statuses(renderIds) {
    return (await this.request("POST", "/renders/statuses", { renderIds })).renders;
  }

  async cancel(renderIds) {
    return (await this.request("POST", "/renders/cancel", { renderIds })).renders;
  }

  createArchive(renderIds, name) {
    return this.request("POST", "/renders/download-archive", { renderIds, name });
  }

  getArchive(archiveId) {
    return this.request("GET", `/renders/download-archive/${archiveId}`, undefined, { Prefer: "wait=20" });
  }
}
