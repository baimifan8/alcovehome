// Start a listing three ways (SPEC.md, "Inputs, in order of reliability"):
// a floor plan picture, the listing's text, or typed room sizes.

import { useEffect, useRef, useState } from "react";
import { isPdf, openPdf, prepareImage, readFloorPlan, type PdfPlan, type PlanImage } from "../import/client.ts";
import { draftFromReading, draftFromText, type DraftPlan } from "../import/draft.ts";
import { parseListingText } from "../import/labels.ts";
import type { Units } from "../model/units.ts";
import { clampShape, type Notch, type RoomShape } from "../model/shape.ts";
import { LengthInput } from "./LengthInput.tsx";
import { mark } from "./timing.ts";
import { ShapeFields } from "./RoomPanel.tsx";

type Mode = "picture" | "text" | "type";

interface Props {
  units: Units;
  hasSpaces: boolean;
  onCancel: () => void;
  /** Typed sizes: no review needed. */
  onTyped: (name: string, roomName: string, shape: RoomShape) => void;
  /** A picture or text was read: review it on the confirm screen. */
  onDraft: (name: string, draft: DraftPlan, image: PlanImage | null) => void;
}

export function NewListing({ units, hasSpaces, onCancel, onTyped, onDraft }: Props) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("picture");
  const listing = name.trim() || "My listing";

  return (
    <div className="welcome">
      <div className="card">
        <h1>Alcove Home</h1>
        <p>Will the furniture you already own fit? Add a home from a listing, add your furniture, and get an answer for every piece.</p>
        <label className="field">
          <span>Listing</span>
          <input type="text" value={name} placeholder="e.g. 12 Elm St, Unit 3B" onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="tabs choice" role="tablist" aria-label="How to add the rooms">
          {(
            [
              ["picture", "Floor plan picture"],
              ["text", "Listing text"],
              ["type", "Type sizes"],
            ] as const
          ).map(([m, label]) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "tab active" : "tab"} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>

        {mode === "picture" && <PictureInput onRead={(draft, image) => onDraft(listing, draft, image)} />}
        {mode === "text" && <TextInput onRead={(draft) => onDraft(listing, draft, null)} />}
        {mode === "type" && <TypedInput units={units} onCreate={(roomName, shape) => onTyped(listing, roomName, shape)} />}

        {hasSpaces && (
          <button className="link" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function PictureInput({ onRead }: { onRead: (draft: DraftPlan, image: PlanImage) => void }) {
  const [image, setImage] = useState<PlanImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /** A PDF with more than one page: which page is the floor plan. */
  const [pdf, setPdf] = useState<{ plan: PdfPlan; page: number } | null>(null);
  const [opening, setOpening] = useState(false);

  const take = async (file: Blob | null | undefined) => {
    if (!file) return;
    setError(null);
    setPdf(null);
    try {
      if (isPdf(file)) {
        setOpening(true);
        const plan = await openPdf(file);
        // Floor plans are often not on the first page of a brochure: let people pick.
        if (plan.pages > 1) setPdf({ plan, page: 1 });
        setImage(await plan.render(1));
      } else {
        setImage(await prepareImage(file));
      }
      mark("plan-added");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOpening(false);
    }
  };
  const showPage = async (page: number) => {
    if (!pdf) return;
    setError(null);
    setPdf({ ...pdf, page });
    setOpening(true);
    try {
      setImage(await pdf.plan.render(page));
    } catch {
      setError("Couldn't draw that page. Try another one.");
    } finally {
      setOpening(false);
    }
  };

  // Paste a screenshot straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
      if (file) {
        e.preventDefault();
        void take(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
  useEffect(() => () => abort.current?.abort(), []);

  const read = async () => {
    if (!image) return;
    setBusy(true);
    setError(null);
    abort.current = new AbortController();
    try {
      const reading = await readFloorPlan(image, abort.current.signal);
      onRead(draftFromReading(reading), image);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div
        className="dropzone"
        role="button"
        tabIndex={0}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void take(e.dataTransfer.files[0]);
        }}
      >
        {image ? (
          <img src={image.dataUrl} alt="Floor plan to read" />
        ) : (
          <span>Paste a screenshot of the floor plan, drop a picture or PDF here, or tap to choose one.</span>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf"
        hidden
        aria-label="Floor plan picture or PDF"
        onChange={(e) => void take(e.target.files?.[0])}
      />
      {pdf && (
        <div className="row pdf-pages">
          <button className="secondary" disabled={busy || opening || pdf.page <= 1} onClick={() => void showPage(pdf.page - 1)} aria-label="Previous page">
            ‹
          </button>
          <span>
            Page {pdf.page} of {pdf.plan.pages}
          </span>
          <button className="secondary" disabled={busy || opening || pdf.page >= pdf.plan.pages} onClick={() => void showPage(pdf.page + 1)} aria-label="Next page">
            ›
          </button>
          <span className="hint">Pick the page with the floor plan.</span>
        </div>
      )}
      <p className="hint">Works best with a plan that has room sizes printed on it. You'll check everything before it's used.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button disabled={!image || busy || opening} onClick={read}>
          {busy ? "Reading the plan…" : "Read floor plan"}
        </button>
        {busy && (
          <button className="secondary" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        )}
        {image && !busy && (
          <button
            className="link"
            onClick={() => {
              setImage(null);
              setPdf(null);
            }}
          >
            Use a different picture
          </button>
        )}
      </div>
      {opening && <p className="hint">Opening the PDF…</p>}
      {busy && <p className="hint">This can take up to a minute.</p>}
    </div>
  );
}

function TextInput({ onRead }: { onRead: (draft: DraftPlan) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label className="field">
        <span>Paste the part of the listing that gives room sizes</span>
        <textarea
          rows={6}
          value={text}
          placeholder={"Living room: 15'6\" x 12'\nBedroom 2: 11' x 12'\nKitchen 10 x 9"}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button
        disabled={!text.trim()}
        onClick={() => {
          const rooms = parseListingText(text);
          if (!rooms.length) setError("No room sizes found. Sizes look like 11' x 12' or 3.4 x 3.6 m.");
          else onRead(draftFromText(rooms));
        }}
      >
        Find rooms
      </button>
    </div>
  );
}

function TypedInput({ units, onCreate }: { units: Units; onCreate: (roomName: string, shape: RoomShape) => void }) {
  const [roomName, setRoomName] = useState("Bedroom");
  const [width, setWidth] = useState(144);
  const [length, setLength] = useState(132);
  const [notch, setNotch] = useState<Notch | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(roomName.trim() || "Room", clampShape({ width, length, notch }));
      }}
    >
      <label className="field">
        <span>First room</span>
        <input type="text" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
      </label>
      <div className="row">
        <LengthInput label="Width (left to right)" value={width} units={units} bare="ft" min={24} onChange={setWidth} />
        <LengthInput label="Length (top to bottom)" value={length} units={units} bare="ft" min={24} onChange={setLength} />
      </div>
      <ShapeFields shape={{ width, length, notch }} units={units} onChange={(s) => setNotch(s.notch)} />
      <button type="submit">Start plan</button>
    </form>
  );
}
