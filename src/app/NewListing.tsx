// Start a listing three ways (SPEC.md, "Inputs, in order of reliability"):
// a floor plan picture, the listing's text, or typed room sizes.

import { useEffect, useRef, useState } from "react";
import { prepareImage, readFloorPlan, type PlanImage } from "../import/client.ts";
import { draftFromReading, draftFromText, type DraftPlan } from "../import/draft.ts";
import { parseListingText } from "../import/labels.ts";
import type { Units } from "../model/units.ts";
import { LengthInput } from "./LengthInput.tsx";

type Mode = "picture" | "text" | "type";

interface Props {
  units: Units;
  hasSpaces: boolean;
  onCancel: () => void;
  /** Typed sizes: no review needed. */
  onTyped: (name: string, roomName: string, width: number, length: number) => void;
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
        {mode === "type" && <TypedInput units={units} onCreate={(roomName, w, l) => onTyped(listing, roomName, w, l)} />}

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

  const take = async (file: Blob | null | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setImage(await prepareImage(file));
    } catch (err) {
      setError((err as Error).message);
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
          <span>Paste a screenshot of the floor plan, drop a picture here, or tap to choose one.</span>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        aria-label="Floor plan picture"
        onChange={(e) => void take(e.target.files?.[0])}
      />
      <p className="hint">Works best with a plan that has room sizes printed on it. You'll check everything before it's used.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button disabled={!image || busy} onClick={read}>
          {busy ? "Reading the plan…" : "Read floor plan"}
        </button>
        {busy && (
          <button className="secondary" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        )}
        {image && !busy && (
          <button className="link" onClick={() => setImage(null)}>
            Use a different picture
          </button>
        )}
      </div>
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

function TypedInput({ units, onCreate }: { units: Units; onCreate: (roomName: string, width: number, length: number) => void }) {
  const [roomName, setRoomName] = useState("Bedroom");
  const [width, setWidth] = useState(144);
  const [length, setLength] = useState(132);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(roomName.trim() || "Room", width, length);
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
      <button type="submit">Start plan</button>
    </form>
  );
}
