import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowSquareOut, CaretDown, CircleNotch, Code, Copy, DownloadSimple, FileArrowDown, FileArrowUp, FileCsv, Key, Lightning, Play, Plus,
  Stop, Trash, WarningCircle, X,
} from "@phosphor-icons/react";
import { PlaybackVideo } from "./PlaybackVideo.jsx";
import { campaignCsv, cardStatus, isFinished, jsonTokens, lookOf, mergeRender, needsRender, sharedLook, signature, uniqueName } from "./table.js";

const DOCS = "https://codeartworks.com/docs/blitframe";

// Each campaign's cards, renders and timings, kept while another campaign is open.
const saved = new Map();

// Every campaign's template and cards, fetched once after connecting so switching campaigns never waits.
const dashboards = new Map();

function loadDashboard(id) {
  if (!dashboards.has(id)) {
    const entry = {};
    entry.promise = api(`/api/dashboard?campaign=${encodeURIComponent(id)}`).then((d) => (entry.data = d)).catch((e) => {
      dashboards.delete(id);
      throw e;
    });
    dashboards.set(id, entry);
  }
  return dashboards.get(id).promise;
}

export function App() {
  const [connection, setConnection] = useState(null);
  const [changingKey, setChangingKey] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [current, setCurrent] = useState(() => decodeURIComponent(location.hash.slice(1)));
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/connection")
      .then(setConnection)
      .catch((e) => {
        setConnection({ connected: false });
        setError(e.message);
      });
  }, []);

  useEffect(() => {
    if (!connection?.connected) return;
    setPlan(connection.plan);
    setError("");
    api("/api/campaigns")
      .then(({ campaigns: list }) => {
        setCampaigns(list);
        list.forEach((c) => loadDashboard(c.id).catch(() => {}));
        setCurrent((id) => (list.some((c) => c.id === id) ? id : list[0]?.id ?? ""));
      })
      .catch((e) => setError(e.message));
  }, [connection]);

  useEffect(() => {
    const askForKey = (e) => setConnection((c) => (c?.connected === false ? c : { connected: false, error: e.detail || undefined }));
    window.addEventListener("keyneeded", askForKey);
    return () => window.removeEventListener("keyneeded", askForKey);
  }, []);

  useEffect(() => {
    const closeMenus = (e) => document.querySelectorAll("details.menu[open]").forEach((menu) => menu.contains(e.target) || menu.removeAttribute("open"));
    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
  }, []);

  function open(id) {
    if (busy || id === current) return;
    history.replaceState(null, "", `#${id}`);
    setCurrent(id);
  }

  function connected(result) {
    saved.clear();
    dashboards.clear();
    setChangingKey(false);
    setConnection(result);
  }

  const showConnect = connection && (!connection.connected || changingKey);

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <a className="brand" href="https://codeartworks.com/blitframe" target="_blank" rel="noreferrer">
            <img src="/codeartworks-mark.png" width="26" height="26" alt="" />
            Blitframe
          </a>
          <span className="crumb">Examples<span aria-hidden="true">/</span>Creative dashboard</span>
          <div className="top-right">
            {!connection ? <span className="badge rendering">Connecting</span>
              : connection.connected && !error ? <span className="badge ok">Production API</span>
                : <span className="badge failed">Not connected</span>}
            {plan && connection?.connected ? <span className="plan">{planCopy(plan)}</span> : null}
            {connection?.connected ? (
              <button type="button" className="secondary small" onClick={() => setChangingKey(true)} disabled={busy}>
                <Key />Key {connection.keyHint}
              </button>
            ) : null}
            <a className="button secondary small" href={DOCS} target="_blank" rel="noreferrer">Docs<ArrowSquareOut /></a>
          </div>
        </div>
      </header>

      <main className="page">
        {showConnect ? (
          <Connect reason={connection.error} onConnected={connected} onCancel={connection.connected ? () => setChangingKey(false) : null} />
        ) : connection?.connected ? (
          <>
            {campaigns.length > 1 ? (
              <nav className="campaigns" aria-label="Campaigns">
                {campaigns.map((c) => (
                  <button key={c.id} type="button" className="campaign-tab" aria-current={c.id === current ? "page" : undefined}
                    onClick={() => open(c.id)} disabled={busy && c.id !== current} title={busy && c.id !== current ? "Finish or stop the batch first" : undefined}>
                    <strong>{c.name}</strong>
                    <span>{c.tagline}</span>
                  </button>
                ))}
              </nav>
            ) : null}
            {error ? <NotConnected message={error} /> : null}
            {current ? <Campaign key={`${current}:${connection.keyHint}`} id={current} onBusy={setBusy} onPlan={setPlan} /> : null}
          </>
        ) : null}
      </main>

      <footer className="foot">
        <span>An example of the <a href={DOCS} target="_blank" rel="noreferrer">Blitframe API</a> by Code Artworks.</span>
        <span>The API key stays on this app's server. The page never sees it.</span>
      </footer>
    </>
  );
}

// Where someone who cloned the example connects their own account. The key goes to this app's server, which checks it with Blitframe.
function Connect({ reason, onConnected, onCancel }) {
  const [value, setValue] = useState("");
  const [state, setState] = useState({ busy: false, error: reason ?? "" });

  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, error: "" });
    try {
      onConnected(await api("/api/connection", post({ apiKey: value })));
    } catch (err) {
      setState({ busy: false, error: err.message });
    }
  }

  return (
    <section className="connect">
      <p className="eyebrow">Blitframe example · Creative dashboard</p>
      <h1>Connect your Blitframe account</h1>
      <p className="lede">
        The dashboard renders on the Blitframe API with your own key. Paste one here, and the four campaigns are pushed to your
        workspace the first time you open them. The free trial is enough.
      </p>
      <form className="connect-card" onSubmit={submit}>
        <label className="field">
          <span className="field-label">API key</span>
          <input type="password" autoComplete="off" spellCheck={false} placeholder="blitframe_…" value={value} autoFocus
            onChange={(e) => setValue(e.target.value)} />
        </label>
        {state.error ? <p className="card-error"><WarningCircle weight="fill" />{state.error}</p> : null}
        <div className="connect-actions">
          <button type="submit" className="accent" disabled={state.busy || !value.trim()}>
            {state.busy ? <CircleNotch className="spin" /> : <Key />}
            {state.busy ? "Checking the key" : "Connect"}
          </button>
          {onCancel ? <button type="button" className="secondary" onClick={onCancel}>Cancel</button> : null}
          <a href="https://app.codeartworks.com/blitframe/api-keys" target="_blank" rel="noreferrer">Create a key in the console<ArrowSquareOut /></a>
        </div>
        <p className="hint">
          This app's own server checks the key with Blitframe and saves it to <code>.env</code> on this computer, so the next start
          connects by itself. The page never stores it.
        </p>
      </form>
    </section>
  );
}

function Campaign({ id, onBusy, onPlan }) {
  const restored = saved.get(id);
  const cached = dashboards.get(id)?.data;
  const [data, setData] = useState(cached ?? null);
  const [rows, setRows] = useState(() => restored?.rows ?? cached?.rows.map(withKey) ?? []);
  const [phase, setPhase] = useState(cached ? "ready" : "connecting");
  const [batch, setBatch] = useState([]);
  const [toast, setToast] = useState(null);
  const [request, setRequest] = useState(restored?.request ?? null);
  const [draft, setDraft] = useState(null);
  const [clock, setClock] = useState(restored?.clock ?? null);
  const [now, setNow] = useState(0);
  const [zipping, setZipping] = useState(false);
  const [watching, setWatching] = useState(null);
  const run = useRef(0);
  const csvInput = useRef(null);

  useEffect(() => {
    if (cached) {
      onPlan(cached.plan);
      return () => { run.current += 1; };
    }
    loadDashboard(id)
      .then((d) => {
        setData(d);
        onPlan(d.plan);
        if (!restored) setRows(d.rows.map(withKey));
        setPhase("ready");
      })
      .catch((e) => {
        setToast({ text: e.message, error: true });
        setPhase("error");
      });
    return () => { run.current += 1; };
  }, [id]);

  useEffect(() => {
    if (data) saved.set(id, { rows, request, clock });
  }, [data, rows, request, clock]);

  const columns = data?.columns ?? [];
  const busy = phase === "queuing" || phase === "rendering";
  const changed = rows.filter((row) => needsRender(row, columns));
  const finished = rows.filter((row) => row.render?.status === "succeeded");
  const batchDone = rows.filter((row) => batch.includes(row.key) && isFinished(row.render)).length;
  const seconds = data?.template.seconds ?? 0;
  const draftKey = JSON.stringify(changed.map(strip));

  useEffect(() => onBusy(busy), [busy]);

  // The request Render would send, rebuilt by the server as the cards change, so the panel below always shows the real call.
  useEffect(() => {
    if (phase !== "ready" || !changed.length) {
      setDraft(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      api("/api/request", post({ campaign: id, rows: changed.map(strip) }))
        .then((built) => setDraft({ requests: built.requests }))
        .catch((e) => setDraft({ error: e.message }));
    }, 250);
    return () => clearTimeout(timer);
  }, [phase, draftKey]);

  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [busy]);

  function flash(text, error = false) {
    setToast({ text, error });
    if (!error) setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 5000);
  }

  function update(key, patch) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function setRenders(byKey) {
    setRows((current) => current.map((row) => (byKey.has(row.key) ? { ...row, render: byKey.get(row.key) } : row)));
  }

  function duplicate(row) {
    setRows((current) => {
      const at = current.findIndex((r) => r.key === row.key);
      const copy = withKey({ ...strip(row), name: uniqueName(current, `${row.name} copy`) });
      return [...current.slice(0, at + 1), copy, ...current.slice(at + 1)];
    });
  }

  function addVariant() {
    setRows((current) => [...current, withKey({ ...strip(current.at(-1) ?? data.rows[0]), name: uniqueName(current, "New variant") })]);
  }

  async function renderChanged() {
    const mine = ++run.current;
    const queued = changed;
    const before = new Map(queued.map((row) => [row.key, { render: row.render, renderedAs: row.renderedAs }]));
    setToast(null);
    setPhase("queuing");
    setBatch(queued.map((row) => row.key));
    const started = performance.now();
    setClock({ start: started, count: queued.length });
    setRows((current) => current.map((row) => (before.has(row.key) ? { ...row, render: { status: "queued" }, renderedAs: signature(row, columns) } : row)));
    try {
      const sent = await api("/api/renders", post({ campaign: id, rows: queued.map(strip) }));
      setRequest(sent.requests);
      let byKey = new Map(queued.map((row, i) => [row.key, sent.renders[i]]));
      setRenders(byKey);
      setPhase("rendering");
      // One status call for the whole batch. A card plays its video as soon as the render's first seconds exist.
      while (mine === run.current && [...byKey.values()].some((r) => !isFinished(r))) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const open = [...byKey.values()].filter((r) => !isFinished(r)).map((r) => r.id);
        const latest = new Map((await api("/api/statuses", post({ ids: open }))).renders.map((r) => [r.id, r]));
        byKey = new Map([...byKey].map(([key, r]) => [key, latest.has(r.id) ? mergeRender(r, latest.get(r.id)) : r]));
        if (mine !== run.current) break;
        setRenders(byKey);
        if ([...byKey.values()].some((r) => r.hlsUrl)) setClock((c) => (c.firstLive ? c : { ...c, firstLive: performance.now() }));
      }
      if (mine === run.current) {
        const ok = [...byKey.values()].filter((r) => r.status === "succeeded").length;
        const end = performance.now();
        setClock((c) => ({ ...c, end }));
        flash(`${ok} of ${queued.length} ${queued.length === 1 ? "video" : "videos"} rendered in ${secondsSince(started, end)}.`);
        api("/api/usage").then(onPlan).catch(() => {});
      }
    } catch (e) {
      if (mine !== run.current) return;
      setRows((current) => current.map((row) => (before.has(row.key) && !row.render?.id ? { ...row, ...before.get(row.key) } : row)));
      flash(e.message, true);
    } finally {
      if (mine === run.current) setPhase("ready");
    }
  }

  async function stop() {
    run.current += 1;
    const ids = rows.filter((row) => row.render?.id && !isFinished(row.render)).map((row) => row.render.id);
    setPhase("ready");
    if (!ids.length) return;
    try {
      const stopped = new Map((await api("/api/cancel", post({ ids }))).renders.map((r) => [r.id, r]));
      setRows((current) => current.map((row) => (stopped.has(row.render?.id) ? { ...row, render: mergeRender(row.render, stopped.get(row.render.id)) } : row)));
      flash("Stopped the renders that had not finished.");
    } catch (e) {
      flash(e.message, true);
    }
  }

  async function downloadAll() {
    setZipping(true);
    try {
      const { id: archiveId } = await api("/api/archive", post({ ids: finished.map((row) => row.render.id), name: data.campaign.name }));
      let archive;
      do {
        archive = await api("/api/archive/status", post({ id: archiveId }));
      } while (archive.status === "queued" || archive.status === "building");
      if (archive.status !== "ready") throw new Error(archive.error ?? "The ZIP could not be made.");
      window.location.href = archive.url;
    } catch (e) {
      flash(e.message, true);
    } finally {
      setZipping(false);
    }
  }

  async function importCsv(source, label) {
    try {
      const { rows: imported } = await api("/api/csv", post({ campaign: id, ...source }));
      setRows(imported.map(withKey));
      flash(`Loaded ${imported.length} ${imported.length === 1 ? "variant" : "variants"} from ${label}.`);
    } catch (e) {
      flash(e.message, true);
    }
  }

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([campaignCsv(rows, columns, data.effects)], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `${id}-campaign.csv` }).click();
    URL.revokeObjectURL(url);
  }

  const file = (path) => `/campaigns/${id}/${path}`;
  const asset = (path) => `${file(`template/${path}`)}?v=${data?.versionId}`;

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Blitframe example · Batch renders</p>
          <h1>{data?.campaign.name ?? "…"}</h1>
          <p className="lede">
            {data?.campaign.description} Each video starts playing in its card while it is still rendering.
          </p>
        </div>
        <dl className="facts">
          <div><dt>Project</dt><dd>{data?.campaign.project ?? "…"}</dd></div>
          <div><dt>Template</dt><dd>{data ? `${data.template.seconds} s · ${data.template.width}×${data.template.height}` : "…"}</dd></div>
          <div><dt>Editable layers</dt><dd>{data ? columns.length : "…"}</dd></div>
          <div><dt>Output</dt><dd>Live HLS, then MP4</dd></div>
        </dl>
      </section>

      <div className="toolbar">
        <div className="toolbar-status">
          {busy ? (
            <>
              <span className="toolbar-count"><strong>{batchDone}</strong> of {batch.length} rendered</span>
              <span className="meter" aria-hidden="true"><span style={{ width: `${batch.length ? (batchDone / batch.length) * 100 : 0}%` }} /></span>
              <span className="timer">{clock ? secondsSince(clock.start, Math.max(now, clock.start)) : ""}</span>
            </>
          ) : clock?.end ? (
            <span className="result">
              <Lightning weight="fill" />
              <span>
                <strong>{clock.count} {clock.count === 1 ? "video" : "videos"}</strong> ({clock.count * seconds} s of video) in{" "}
                <strong>{secondsSince(clock.start, clock.end)}</strong>
                {clock.firstLive ? <>, the first streaming after <strong>{secondsSince(clock.start, clock.firstLive)}</strong></> : null}
              </span>
            </span>
          ) : (
            <span className="toolbar-count">
              <strong>{rows.length}</strong> {rows.length === 1 ? "variant" : "variants"}
              {data ? <> · {changed.length ? `${changed.length} to render, ${changed.length * seconds} render seconds` : "all rendered"}</> : null}
            </span>
          )}
        </div>
        <div className="toolbar-actions">
          <details className="menu">
            <summary className={`button secondary ${phase !== "ready" ? "is-disabled" : ""}`}><FileArrowUp />Import CSV<CaretDown /></summary>
            <div className="menu-list">
              {data?.examples.map((example) => (
                <div key={example} className="menu-item">
                  <button type="button" onClick={(e) => { e.currentTarget.closest("details").open = false; importCsv({ example }, example); }}>
                    <FileCsv />{example}
                  </button>
                  <a href={file(`examples/${example}`)} download title={`Download ${example}`} aria-label={`Download ${example}`}><DownloadSimple /></a>
                </div>
              ))}
              <button type="button" className="menu-choose" onClick={(e) => { e.currentTarget.closest("details").open = false; csvInput.current?.click(); }}>
                Choose a CSV file…
              </button>
            </div>
          </details>
          <button type="button" className="secondary" onClick={exportCsv} disabled={!rows.length}><FileArrowDown />Export CSV</button>
          <button type="button" className="secondary" onClick={downloadAll} disabled={!finished.length || zipping || busy}>
            {zipping ? <CircleNotch className="spin" /> : <DownloadSimple />}
            {zipping ? "Packing the ZIP" : `Download all${finished.length ? ` (${finished.length})` : ""}`}
          </button>
          {busy ? (
            <button type="button" className="danger" onClick={stop} disabled={phase === "queuing"}><Stop weight="fill" />Stop</button>
          ) : (
            <button type="button" className="accent" onClick={renderChanged} disabled={phase !== "ready" || !changed.length}>
              <Play weight="fill" />
              {!data ? "Render" : changed.length ? `Render ${changed.length} ${changed.length === 1 ? "video" : "videos"}` : "Everything is rendered"}
            </button>
          )}
          <input ref={csvInput} type="file" accept=".csv,text/csv" hidden
            onChange={async (e) => { const chosen = e.target.files?.[0]; e.target.value = ""; if (chosen) importCsv({ csv: await chosen.text() }, chosen.name); }} />
        </div>
      </div>

      {phase === "connecting" ? <Loading /> : null}

      {data ? (
        <ul className="grid">
          {rows.map((row, index) => (
            <VariantCard
              key={row.key}
              row={row}
              index={index}
              columns={columns}
              looks={data.looks}
              effects={data.effects}
              preview={data.preview}
              asset={asset}
              file={file}
              locked={busy}
              autoPlay={rows.length <= 12}
              canRemove={rows.length > 1}
              onChange={(patch) => update(row.key, patch)}
              onDuplicate={() => duplicate(row)}
              onRemove={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              onWatch={() => setWatching(row)}
            />
          ))}
          <li>
            <button type="button" className="add-card" onClick={addVariant} disabled={busy}>
              <Plus weight="bold" />
              <span>Add a variant</span>
              <small>Starts as a copy of the last card</small>
            </button>
          </li>
        </ul>
      ) : null}

      <ApiRequest draft={draft} sent={request} />

      {toast ? (
        <div className={`toast ${toast.error ? "toast-error" : ""}`} role={toast.error ? "alert" : "status"}>
          {toast.error ? <WarningCircle weight="fill" /> : null}
          <span>{toast.text}</span>
          <button type="button" className="icon" onClick={() => setToast(null)} aria-label="Dismiss"><X /></button>
        </div>
      ) : null}

      <Player row={watching} onClose={() => setWatching(null)} />
    </>
  );
}

function VariantCard({ row, index, columns, looks, effects, preview, asset, file, locked, autoPlay, canRemove, onChange, onDuplicate, onRemove, onWatch }) {
  const imageColumns = columns.filter((c) => c.kind === "image");
  const textColumns = columns.filter((c) => c.kind === "text");
  const lookItems = looks?.items ?? [];
  const lookById = new Map(lookItems.map((look) => [look.id, look]));
  const status = cardStatus(row, columns);
  const video = row.render?.hlsUrl && row.renderedAs === signature(row, columns) ? row.render : null;
  const shared = sharedLook(row, imageColumns);
  const label = (path) => lookById.get(lookOf(path))?.label ?? path.split("/").at(-1);
  const order = (path) => { const at = lookItems.findIndex((look) => look.id === lookOf(path)); return at < 0 ? lookItems.length : at; };
  const [playing, setPlaying] = useState(false);
  useEffect(() => setPlaying(false), [video?.hlsUrl]);

  function applyLook(lookId) {
    onChange(Object.fromEntries(imageColumns.map((c) => [c.id, c.files.find((path) => lookOf(path) === lookId) ?? row[c.id]])));
  }

  return (
    <li className={`card tone-${status.tone}`}>
      <div className="stage">
        <Preview items={preview} columns={columns} row={row} asset={asset} file={file} effect={effects?.items.find((e) => e.id === row.effect)} />
        {video ? (
          <button type="button" className={`stage-watch ${playing ? "is-playing" : ""}`} onClick={onWatch} aria-label={`Watch ${row.name}`}>
            <PlaybackVideo src={video.hlsUrl} format="hls" isComplete={video.status === "succeeded"} muted loop playsInline autoPlay={autoPlay}
              aria-hidden="true" onPlaying={() => setPlaying(true)} />
          </button>
        ) : null}
        <span className={`chip chip-${status.tone}`}>{status.text}</span>
        {status.tone === "busy" ? <span className="stage-wait"><CircleNotch className="spin" /></span> : null}
      </div>

      <div className="card-body">
        <div className="card-title">
          <span className="card-index">{String(index + 1).padStart(2, "0")}</span>
          <input className="name" aria-label="Variant name" value={row.name} maxLength={80} disabled={locked}
            onChange={(e) => onChange({ name: e.target.value })} />
          <button type="button" className="icon" title="Duplicate" aria-label={`Duplicate ${row.name}`} onClick={onDuplicate} disabled={locked}><Copy /></button>
          <button type="button" className="icon" title="Delete" aria-label={`Delete ${row.name}`} onClick={onRemove} disabled={locked || !canRemove}><Trash /></button>
        </div>

        {lookItems.length ? (
          <label className="looks">
            <span className="field-label">{looks.label}</span>
            <select value={shared ?? ""} disabled={locked} onChange={(e) => applyLook(e.target.value)}>
              {shared ? null : <option value="" disabled>Mixed</option>}
              {lookItems.map((look) => <option key={look.id} value={look.id}>{look.label}</option>)}
            </select>
          </label>
        ) : null}

        {effects ? (
          <label className="looks">
            <span className="field-label">{effects.label}</span>
            <select value={row.effect ?? effects.items[0].id} disabled={locked} onChange={(e) => onChange({ effect: e.target.value })}>
              {effects.items.map((effect) => <option key={effect.id} value={effect.id}>{effect.label}</option>)}
            </select>
          </label>
        ) : null}

        <div className="text-fields">
          {textColumns.map((c) => (
            <label key={c.id} className={`field ${c.multiline ? "field-wide" : ""}`}>
              <span className="field-label">{c.label}</span>
              {c.multiline ? (
                <textarea value={row[c.id]} maxLength={c.maxLength} rows={Math.min(6, Math.max(2, row[c.id].split("\n").length))} disabled={locked}
                  onChange={(e) => onChange({ [c.id]: e.target.value })} />
              ) : (
                <input value={row[c.id]} maxLength={c.maxLength} disabled={locked} onChange={(e) => onChange({ [c.id]: e.target.value })} />
              )}
            </label>
          ))}
        </div>

        <details className="mix">
          <summary>{lookItems.length ? "Mix the art" : "Choose the art"}<CaretDown /></summary>
          {imageColumns.map((c) => (
            <div key={c.id} className="slot">
              <span className="field-label">{c.label}<span>{label(row[c.id])}</span></span>
              <div className="swatches" role="radiogroup" aria-label={c.label}>
                {c.files.toSorted((a, b) => order(a) - order(b)).map((path) => (
                  <button key={path} type="button" role="radio" className="swatch" aria-checked={row[c.id] === path} title={label(path)}
                    aria-label={label(path)} onClick={() => onChange({ [c.id]: path })} disabled={locked}>
                    <img src={asset(path)} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </details>

        {row.render?.status === "failed" ? <p className="card-error"><WarningCircle weight="fill" />{row.render.error ?? "The render failed."}</p> : null}
        {video?.status === "succeeded" && video.mp4Url ? (
          <a className="card-download" href={video.mp4Url}><DownloadSimple />Download MP4</a>
        ) : null}
      </div>
    </li>
  );
}

// A quick mock of the ad from campaign.json: each item is an image (a field's current file, or a campaign file) or a field's text, placed in
// a box given in percent of the frame. The fields' items play the card's motion each time it changes.
function Preview({ items, columns, row, asset, file, effect }) {
  const motion = effect?.motion ?? {};
  let moving = 0;
  const move = (item) => {
    const preset = motion[columns.find((c) => c.id === (item.column ?? item.text))?.layer] ?? Object.values(motion)[0];
    return preset && (item.column || item.text) ? { className: `move-${preset}`, delay: `${moving++ * 90}ms` } : {};
  };
  return (
    <div className="preview" aria-hidden="true" key={effect?.id}>
      {items.map((item, i) => {
        const tall = columns.find((c) => c.id === item.column)?.tall;
        const box = tall && row[item.column].startsWith(tall.library) ? tall.preview : item.box;
        const [left, top, width, height] = (item.rotate ? turned(box) : box).map((n) => `${n}%`);
        const place = { left, top, width, height, rotate: item.rotate ? `${item.rotate}deg` : undefined };
        const { className = "", delay } = move(item);
        if (item.fill) return <span key={i} style={{ ...place, background: item.fill }} />;
        if (item.text) {
          return (
            <span key={i} className={`preview-text ${className}`} style={{ ...place, animationDelay: delay, fontSize: `${item.size ?? 4}cqw`,
              color: item.color, fontFamily: item.font, fontWeight: item.weight ?? 700, fontStyle: item.italic ? "italic" : undefined,
              justifyContent: item.align ?? "flex-start", textAlign: item.align === "center" ? "center" : undefined,
              textTransform: item.upper ? "uppercase" : undefined, background: item.background, borderRadius: item.radius }}>
              {row[item.text]}
            </span>
          );
        }
        return <img key={i} className={`${item.dim ? "is-dim" : ""} ${className}`} src={item.column ? asset(row[item.column]) : file(item.src)} alt=""
          style={{ ...place, animationDelay: delay, objectFit: item.fit ?? "contain" }} />;
      })}
    </div>
  );
}

// A quarter-turned item keeps the box it covers on screen: before turning it is that box's height wide and its width tall, about the same
// centre, converted between the 16:9 frame's width and height percentages.
function turned([x, y, w, h]) {
  const width = h * 9 / 16;
  const height = w * 16 / 9;
  return [x + w / 2 - width / 2, y + h / 2 - height / 2, width, height];
}

function Player({ row, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    if (row) dialog.current?.showModal();
    else dialog.current?.close();
  }, [row]);
  const render = row?.render;
  return (
    <dialog ref={dialog} className="player" onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()}>
      {render ? (
        <>
          <div className="player-head">
            <strong>{row.name}</strong>
            {render.mp4Url ? <a className="button accent small" href={render.mp4Url}><DownloadSimple />MP4</a> : null}
            <button type="button" className="icon" onClick={onClose} aria-label="Close"><X /></button>
          </div>
          <PlaybackVideo src={render.hlsUrl} format="hls" isComplete={render.status === "succeeded"} poster={render.posterUrl || undefined}
            controls autoPlay playsInline />
        </>
      ) : null}
    </dialog>
  );
}

function ApiRequest({ draft, sent }) {
  const shown = draft?.requests ?? sent;
  const label = draft?.requests ? "What Render sends now" : draft?.error ? "Render would be refused" : sent ? "Sent with the last Render" : "Nothing to send";
  return (
    <section className="request">
      <div className="request-copy">
        <p className="eyebrow"><Code />The API call</p>
        <h2>One request renders a whole batch</h2>
        <p>
          Every card becomes one render. Its replacements change only what differs from the template: text by layer, and art by a
          path to another file in the same version. Each motion is a variation of the project with its own keyframes, so the cards go
          out as one batch per motion, each queued all at once or not at all.
        </p>
        <a href={`${DOCS}/editing#many-videos-from-a-data-sheet`} target="_blank" rel="noreferrer">Read about batch renders<ArrowSquareOut /></a>
      </div>
      <div className="request-box">
        <p className={`request-label ${draft?.error ? "is-error" : ""}`}>{label}</p>
        <pre className="request-code">
          <code>
            {draft?.error ?? (shown
              ? shown.map((r, i) => (
                <Fragment key={r.body.versionId}>
                  {i ? "\n\n" : null}<span className="tok-method">POST</span> {r.path}{"\n\n"}{highlight(JSON.stringify(r.body, null, 2))}
                </Fragment>
              ))
              : "Change a card, and the request Render would send\nto Blitframe appears here.")}
          </code>
        </pre>
      </div>
    </section>
  );
}

function Loading() {
  return (
    <div className="state" role="status">
      <CircleNotch className="spin" />
      <div>
        <strong>Connecting to Blitframe</strong>
        <p>Pushing the template to your workspace and reading its layers.</p>
      </div>
    </div>
  );
}

function NotConnected({ message }) {
  return (
    <div className="state state-error" role="alert">
      <WarningCircle weight="fill" />
      <div>
        <strong>Blitframe did not answer</strong>
        <p>{message} The terminal shows the reason.</p>
      </div>
    </div>
  );
}

function planCopy(plan) {
  if (plan.unlimited || plan.renderSecondsRemaining == null) return `${plan.name} · unlimited renders`;
  return `${plan.name} · ${Math.floor(plan.renderSecondsRemaining / 60).toLocaleString()} render minutes left`;
}

function highlight(json) {
  return jsonTokens(json).map((token, i) => (token.kind ? <span key={i} className={`tok-${token.kind}`}>{token.text}</span> : token.text));
}

function secondsSince(start, end) {
  return `${((end - start) / 1000).toFixed(1)} s`;
}

function withKey(row) {
  return { ...row, key: crypto.randomUUID() };
}

function strip({ key, render, renderedAs, ...row }) {
  return row;
}

function post(body) {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) window.dispatchEvent(new CustomEvent("keyneeded", { detail: body.code === "no_key" ? "" : body.error }));
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${response.status}`);
  return body;
}
