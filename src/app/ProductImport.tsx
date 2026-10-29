// Furniture from a store link, with a screenshot fallback, and a confirm step that
// shows what was read next to a link back to the store (SPEC.md, "Furniture import").

import { useEffect, useRef, useState } from "react";
import { prepareImage } from "../import/client.ts";
import { normalizeProductUrl, type ProductDraft } from "../import/product.ts";
import { readProductLink, readProductScreenshot, shareConfirmedProduct } from "../import/productClient.ts";
import type { Rules } from "../engine/index.ts";
import type { Footprint, InventoryItem } from "../model/types.ts";
import { formatSize, type Units } from "../model/units.ts";
import { LengthInput } from "./LengthInput.tsx";
import { newId } from "./store.ts";

interface Props {
  rules: Rules;
  units: Units;
  onAdd: (item: InventoryItem) => void;
}

type Step =
  | { kind: "link" }
  | { kind: "screenshot"; url: string | null; message: string | null }
  | { kind: "confirm"; draft: ProductDraft };

export function ProductImport({ rules, units, onAdd }: Props) {
  const [step, setStep] = useState<Step>({ kind: "link" });
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    setBusy(true);
    setError(null);
    abort.current = new AbortController();
    try {
      await work(abort.current.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const readLink = () =>
    run(async (signal) => {
      if (!normalizeProductUrl(link)) throw new Error("Paste the full link to the product page (it starts with https://).");
      const r = await readProductLink(link, signal);
      if (r.ok) setStep({ kind: "confirm", draft: r.draft });
      else if (r.needScreenshot) setStep({ kind: "screenshot", url: r.url, message: r.error });
      else setError(r.error);
    });

  const readShot = (file: Blob, url: string | null) =>
    run(async (signal) => {
      const image = await prepareImage(file);
      setStep({ kind: "confirm", draft: await readProductScreenshot(image, url, signal) });
    });

  const reset = () => {
    abort.current?.abort();
    setStep({ kind: "link" });
    setLink("");
    setError(null);
  };

  return (
    <div className="product-import">
      {step.kind === "link" && (
        <>
          <div className="row end">
            <label className="field grow">
              <span>Link to a product page</span>
              <input
                type="url"
                inputMode="url"
                value={link}
                placeholder="https://…"
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && link.trim() && !busy && void readLink()}
              />
            </label>
            <button disabled={!link.trim() || busy} onClick={() => void readLink()}>
              {busy ? "Reading…" : "Get size"}
            </button>
          </div>
          <button className="link" onClick={() => setStep({ kind: "screenshot", url: null, message: null })}>
            No link? Use a screenshot of the size details
          </button>
        </>
      )}

      {step.kind === "screenshot" && (
        <ScreenshotStep message={step.message} busy={busy} onImage={(f) => void readShot(f, step.url)} onCancel={reset} />
      )}

      {step.kind === "confirm" && (
        <ConfirmProduct
          draft={step.draft}
          rules={rules}
          units={units}
          onCancel={reset}
          onConfirm={(item, shared) => {
            onAdd(item);
            if (shared) void shareConfirmedProduct(shared);
            reset();
          }}
          onUseScreenshot={() => setStep({ kind: "screenshot", url: step.draft.url, message: null })}
        />
      )}

      {busy && (
        <p className="hint">
          Reading… this can take up to a minute.{" "}
          <button className="link" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function ScreenshotStep({ message, busy, onImage, onCancel }: { message: string | null; busy: boolean; onImage: (f: Blob) => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
      if (file && !busy) {
        e.preventDefault();
        onImage(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [busy, onImage]);

  return (
    <div>
      {message && <p className="note">{message}</p>}
      <div
        className="dropzone small"
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files[0]) onImage(e.dataTransfer.files[0]);
        }}
      >
        <span>Paste a screenshot of the product's size details, drop it here, or tap to choose one.</span>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        aria-label="Size details screenshot"
        onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])}
      />
      <button className="link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function ConfirmProduct({
  draft,
  rules,
  units,
  onConfirm,
  onCancel,
  onUseScreenshot,
}: {
  draft: ProductDraft;
  rules: Rules;
  units: Units;
  onConfirm: (item: InventoryItem, shared: Parameters<typeof shareConfirmedProduct>[0] | null) => void;
  onCancel: () => void;
  onUseScreenshot: () => void;
}) {
  const [d, setD] = useState(draft);
  const set = (patch: Partial<ProductDraft>) => setD((x) => ({ ...x, ...patch }));
  const complete = d.width !== null && d.depth !== null && d.height !== null;
  const fp = d.footprint;

  const from =
    d.source === "saved"
      ? `${d.pageVerified ? "Matches the store's page" : "Agreed by other people"}${d.confirmations ? ` · checked by ${d.confirmations} ${d.confirmations === 1 ? "person" : "people"}` : ""}. Check it still matches the page.`
      : d.source === "screenshot"
        ? "Read from your screenshot."
        : `Read from the ${d.retailer ?? "store"} page.`;

  return (
    <div className="editor confirm-product">
      <h3>Is this right?</h3>
      <p className="hint">
        {from}{" "}
        {d.url && (
          <a href={d.url} target="_blank" rel="noopener noreferrer">
            Open the product page ↗
          </a>
        )}
      </p>
      {d.issues.map((i) => (
        <p key={i} className="issue">
          {i}
        </p>
      ))}
      {d.variantNote && <p className="hint">Size shown is for: {d.variantNote}</p>}
      {d.evidence && <blockquote className="evidence">{d.evidence}</blockquote>}

      <label className="field">
        <span>Name</span>
        <input type="text" value={d.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="field">
        <span>Type (sets the clearance it needs)</span>
        <select value={d.kind} onChange={(e) => set({ kind: e.target.value })}>
          {Object.entries(rules.itemKinds).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <LengthInput label="Width" value={d.width} units={units} bare="in" min={1} onChange={(width) => set({ width })} />
        <LengthInput label="Depth" value={d.depth} units={units} bare="in" min={1} onChange={(depth) => set({ depth })} />
        <LengthInput label="Height" value={d.height} units={units} bare="in" min={1} onChange={(height) => set({ height })} />
      </div>
      <ShapeFields footprint={fp} width={d.width ?? 60} depth={d.depth ?? 30} units={units} onChange={(footprint) => set({ footprint })} />
      {d.subDimensions.length > 0 && (
        <p className="hint">Also listed: {d.subDimensions.map((s) => `${s.label} ${formatSize(s.inches, units)}`).join(" · ")}</p>
      )}

      <div className="row wrap">
        <button
          disabled={!complete}
          onClick={() => {
            const item: InventoryItem = {
              id: newId(),
              nickname: d.name.trim() || "Product",
              kind: d.kind,
              source: d.url ? { type: "product", url: d.url } : { type: "manual" },
              width: d.width!,
              depth: d.depth!,
              height: d.height!,
              footprint: d.footprint,
              addOns: [],
            };
            const shared = d.url
              ? { url: d.url, retailer: d.retailer, name: item.nickname, kind: d.kind, width: item.width, depth: item.depth, height: item.height, footprint: d.footprint, subDimensions: d.subDimensions }
              : null;
            onConfirm(item, shared);
          }}
        >
          Add to my furniture
        </button>
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
        {d.source === "page" && (
          <button className="link" onClick={onUseScreenshot}>
            Wrong? Use a screenshot instead
          </button>
        )}
      </div>
      {!complete && <p className="hint">Fill in width, depth and height to continue.</p>}
    </div>
  );
}

/** Rectangle or L-shape, with the L's chaise/return. Shared with the item editor. */
export function ShapeFields({
  footprint: fp,
  width,
  depth,
  units,
  onChange,
}: {
  footprint: Footprint;
  width: number;
  depth: number;
  units: Units;
  onChange: (f: Footprint) => void;
}) {
  return (
    <>
      <label className="field">
        <span>Shape</span>
        <select
          value={fp.shape}
          onChange={(e) =>
            onChange(
              e.target.value === "l"
                ? { shape: "l", side: "left", returnWidth: Math.round(width / 3), returnDepth: Math.round(depth * 1.8) }
                : { shape: "rect" },
            )
          }
        >
          <option value="rect">Rectangle</option>
          <option value="l">L-shaped (sectional, corner desk)</option>
        </select>
      </label>
      {fp.shape === "l" && (
        <div className="row">
          <label className="field">
            <span>Chaise on (facing it)</span>
            <select value={fp.side} onChange={(e) => onChange({ ...fp, side: e.target.value as "left" | "right" })}>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <LengthInput label="Return width" value={fp.returnWidth} units={units} bare="in" min={1} onChange={(returnWidth) => onChange({ ...fp, returnWidth })} />
          <LengthInput label="Depth at the return" value={fp.returnDepth} units={units} bare="in" min={1} onChange={(returnDepth) => onChange({ ...fp, returnDepth })} />
        </div>
      )}
    </>
  );
}
