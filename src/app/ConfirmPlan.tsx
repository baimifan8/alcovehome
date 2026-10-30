// The confirm screen (SPEC.md, "Confirm screen (required)"): the reading drawn over
// the original picture, every size a typed field, doubtful items highlighted, doors
// and windows editable, built-ins editable, and every wall's source shown.

import { useState } from "react";
import { draftRoomOutline, type DraftPlan, type DraftRoom } from "../import/draft.ts";
import { walls } from "../engine/index.ts";
import { clampShape, reshapeRoom, type RoomShape } from "../model/shape.ts";
import type { PlanImage } from "../import/client.ts";
import type { Opening, Room, WallSource } from "../model/types.ts";
import type { Units } from "../model/units.ts";
import { LengthInput } from "./LengthInput.tsx";
import { BuiltInEditor, OpeningEditor, ShapeFields } from "./RoomPanel.tsx";
import { newBuiltIn, newOpening } from "./store.ts";

interface Props {
  name: string;
  draft: DraftPlan;
  image: PlanImage | null;
  units: Units;
  onConfirm: (rooms: DraftRoom[]) => void;
  onBack: () => void;
}

const SOURCE: Record<WallSource, string> = {
  labeled: "from the plan's label",
  inferred: "measured from the drawing",
  "user-edited": "checked by you",
};
const ADD: { type: Opening["type"]; label: string }[] = [
  { type: "door", label: "Door" },
  { type: "closet_door", label: "Closet door" },
  { type: "window", label: "Window" },
  { type: "passage", label: "Open doorway" },
];

/** A stand-in Room so the door and built-in editors can work out walls and their lengths. */
const asRoom = (d: DraftRoom): Room => {
  const { outline } = draftRoomOutline(d);
  return { id: d.key, name: d.name, outline, wallSources: outline.map(() => "user-edited"), openings: d.openings, builtIns: d.builtIns };
};

export function ConfirmPlan({ name, draft, image, units, onConfirm, onBack }: Props) {
  const [rooms, setRooms] = useState(draft.rooms);
  const [selected, setSelected] = useState<string | null>(draft.rooms[0]?.key ?? null);
  const set = (key: string, patch: Partial<DraftRoom>) => setRooms((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const included = rooms.filter((r) => r.include);
  const missing = included.filter((r) => r.width === null || r.length === null);
  const toCheck = included.reduce((n, r) => n + (r.issues.length ? 1 : 0) + r.doubtfulOpenings.length + r.doubtfulBuiltIns.length, 0);

  const select = (key: string) => {
    setSelected(key);
    document.getElementById(`draft-${key}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div className="confirm">
      <header>
        <button className="secondary" onClick={onBack}>
          Back
        </button>
        <h1>Check the rooms for {name}</h1>
      </header>

      <div className="confirm-body">
        {image && (
          <div className="overlay-wrap">
            <Overlay image={image} rooms={rooms} pxPerInch={draft.pxPerInch} selected={selected} onSelect={select} />
            <p className="hint">The colored outlines show how the plan was read. If an outline doesn't sit on the walls, a size is off.</p>
          </div>
        )}

        <div className="draft-rooms">
          {draft.notes.map((n) => (
            <p key={n} className="note">
              {n}
            </p>
          ))}
          <p className="hint">
            Check every number against the plan before continuing; one wrong size makes every answer wrong. Highlighted items need a closer look.
          </p>

          {rooms.map((r) => (
            <DraftRoomCard
              key={r.key}
              room={r}
              units={units}
              selected={r.key === selected}
              onSelect={() => setSelected(r.key)}
              onChange={(patch) => set(r.key, patch)}
            />
          ))}
        </div>
      </div>

      <footer>
        <span className="hint">
          {missing.length
            ? `Type a size for ${missing.map((r) => r.name).join(", ")} to continue.`
            : toCheck
              ? `${toCheck} highlighted item${toCheck === 1 ? "" : "s"} to check.`
              : "Everything has been checked."}
        </span>
        <button disabled={!included.length || missing.length > 0} onClick={() => onConfirm(included)}>
          Use {included.length} room{included.length === 1 ? "" : "s"}
        </button>
      </footer>
    </div>
  );
}

function DraftRoomCard({
  room: r,
  units,
  selected,
  onSelect,
  onChange,
}: {
  room: DraftRoom;
  units: Units;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<DraftRoom>) => void;
}) {
  const asR = asRoom(r);
  const hasSize = r.width !== null && r.length !== null;
  const setOpening = (o: Opening) =>
    onChange({ openings: r.openings.map((x) => (x.id === o.id ? o : x)), doubtfulOpenings: r.doubtfulOpenings.filter((id) => id !== o.id) });

  return (
    <section
      id={`draft-${r.key}`}
      className={`draft-room${selected ? " selected" : ""}${r.include ? "" : " excluded"}${r.issues.length ? " doubtful" : ""}`}
      onFocusCapture={onSelect}
      onClick={onSelect}
    >
      <div className="row end">
        <label className="field grow">
          <span>Room</span>
          <input type="text" value={r.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={r.include} onChange={(e) => onChange({ include: e.target.checked })} /> Include
        </label>
      </div>

      {r.include && (
        <>
          {r.labelText && <p className="hint">Printed on the plan: {r.labelText}</p>}
          {r.issues.map((i) => (
            <p key={i} className="issue">
              {i}
            </p>
          ))}
          <div className="row">
            <div className="grow">
              <LengthInput
                label="Width (left to right)"
                value={r.width}
                units={units}
                bare="ft"
                min={12}
                onChange={(width) => onChange({ widthSource: "user-edited", ...keepInPlace(r, { width, length: r.length, notch: r.notch }) })}
              />
              <SourceTag source={r.widthSource} onCheck={() => onChange({ widthSource: "user-edited" })} />
            </div>
            <div className="grow">
              <LengthInput
                label="Length (top to bottom)"
                value={r.length}
                units={units}
                bare="ft"
                min={12}
                onChange={(length) => onChange({ lengthSource: "user-edited", ...keepInPlace(r, { width: r.width, length, notch: r.notch }) })}
              />
              <SourceTag source={r.lengthSource} onCheck={() => onChange({ lengthSource: "user-edited" })} />
            </div>
          </div>

          {hasSize && (
            <>
              <ShapeFields
                shape={{ width: r.width!, length: r.length!, notch: r.notch }}
                units={units}
                onChange={(shape) => onChange({ notchSource: "user-edited", ...keepInPlace(r, shape) })}
              />
              <h3>Doors and windows</h3>
              {r.openings.length === 0 && <p className="hint">None found. Add the door into this room so walkways can be checked.</p>}
              {r.openings.map((o, i) => (
                <OpeningEditor
                  key={o.id}
                  index={i}
                  room={asR}
                  opening={o}
                  units={units}
                  doubtful={r.doubtfulOpenings.includes(o.id)}
                  onChange={setOpening}
                  onDelete={() => onChange({ openings: r.openings.filter((x) => x.id !== o.id), doubtfulOpenings: r.doubtfulOpenings.filter((id) => id !== o.id) })}
                  onMakeEntry={() => onChange({ openings: r.openings.map((x) => ({ ...x, entry: x.id === o.id })) })}
                />
              ))}
              <div className="row wrap">
                {ADD.map((t) => (
                  <button key={t.type} className="secondary" onClick={() => onChange({ openings: [...r.openings, newOpening(t.type, asR)] })}>
                    + {t.label}
                  </button>
                ))}
              </div>
              {r.doubtfulOpenings.length > 0 && (
                <button className="link" onClick={() => onChange({ doubtfulOpenings: [] })}>
                  The highlighted doors look right
                </button>
              )}

              <h3>Built-ins</h3>
              <p className="hint">Things furniture can't go on, like a kitchen island, counter, radiator or fireplace.</p>
              {r.builtIns.map((b) => (
                <BuiltInEditor
                  key={b.id}
                  room={asR}
                  builtIn={b}
                  units={units}
                  doubtful={r.doubtfulBuiltIns.includes(b.id)}
                  onChange={(nb) =>
                    onChange({ builtIns: r.builtIns.map((x) => (x.id === nb.id ? nb : x)), doubtfulBuiltIns: r.doubtfulBuiltIns.filter((id) => id !== nb.id) })
                  }
                  onDelete={() => onChange({ builtIns: r.builtIns.filter((x) => x.id !== b.id), doubtfulBuiltIns: r.doubtfulBuiltIns.filter((id) => id !== b.id) })}
                />
              ))}
              <div className="row wrap">
                <button className="secondary" onClick={() => onChange({ builtIns: [...r.builtIns, { ...newBuiltIn(asR), confirmed: false }] })}>
                  + Built-in
                </button>
              </div>
              {r.doubtfulBuiltIns.length > 0 && (
                <button className="link" onClick={() => onChange({ doubtfulBuiltIns: [] })}>
                  The highlighted built-ins look right
                </button>
              )}
            </>
          )}
          {r.issues.length > 0 && (
            <button className="link" onClick={() => onChange({ issues: [] })}>
              I've checked this room
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** A new size or shape, with openings and built-ins kept the same distance from the plan's left/top edges. */
function keepInPlace(
  r: DraftRoom,
  next: { width: number | null; length: number | null; notch: RoomShape["notch"] },
): Pick<DraftRoom, "width" | "length" | "notch" | "openings" | "builtIns"> {
  if (r.width === null || r.length === null || next.width === null || next.length === null) return { ...next, openings: r.openings, builtIns: r.builtIns };
  // The same clamping reshapeRoom applies, so the cut-out matches the new outline.
  const shape = clampShape({ width: next.width, length: next.length, notch: next.notch });
  const resized = reshapeRoom(asRoom(r), shape);
  return { ...shape, openings: resized.openings, builtIns: resized.builtIns ?? [] };
}

function SourceTag({ source, onCheck }: { source: WallSource; onCheck: () => void }) {
  return (
    <small className={`source ${source}`}>
      Size {SOURCE[source]}
      {source === "inferred" && (
        <>
          {" · "}
          <button className="link" onClick={onCheck}>
            Looks right
          </button>
        </>
      )}
    </small>
  );
}

function Overlay({
  image,
  rooms,
  pxPerInch,
  selected,
  onSelect,
}: {
  image: PlanImage;
  rooms: DraftRoom[];
  pxPerInch: number | null;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="overlay">
      <img src={image.dataUrl} alt="The floor plan you added" width={image.width} height={image.height} />
      <svg viewBox={`0 0 ${image.width} ${image.height}`} aria-hidden="true">
        {rooms.map((r) => {
          if (!r.bboxPx) return null;
          // Drawn at the plan's scale from the sizes as currently typed, so a wrong
          // number shows up as an outline that misses the walls.
          const w = pxPerInch && r.width !== null ? r.width * pxPerInch : r.bboxPx.w;
          const h = pxPerInch && r.length !== null ? r.length * pxPerInch : r.bboxPx.h;
          const cls = [
            "draft-shape",
            r.key === selected ? "selected" : "",
            !r.include ? "excluded" : "",
            r.issues.length || r.width === null || r.length === null ? "doubtful" : "",
          ].join(" ");
          return (
            <g key={r.key} className={cls} onClick={() => onSelect(r.key)}>
              {pxPerInch && r.width !== null && r.length !== null ? (
                <polygon points={asRoom(r).outline.map((p) => `${r.bboxPx!.x + p.x * pxPerInch},${r.bboxPx!.y + p.y * pxPerInch}`).join(" ")} />
              ) : (
                <rect x={r.bboxPx.x} y={r.bboxPx.y} width={w} height={h} />
              )}
              {r.include &&
                pxPerInch &&
                r.width !== null &&
                r.length !== null &&
                r.openings.map((o) => {
                  const seg = openingPx(r, o, pxPerInch);
                  return (
                    <line
                      key={o.id}
                      {...seg}
                      className={`draft-opening ${o.type}${r.doubtfulOpenings.includes(o.id) ? " doubtful" : ""}`}
                    />
                  );
                })}
              {r.include &&
                pxPerInch &&
                r.builtIns.map((b) => (
                  <rect
                    key={b.id}
                    x={r.bboxPx!.x + b.x * pxPerInch}
                    y={r.bboxPx!.y + b.y * pxPerInch}
                    width={b.width * pxPerInch}
                    height={b.length * pxPerInch}
                    className={`draft-built-in${r.doubtfulBuiltIns.includes(b.id) ? " doubtful" : ""}`}
                  />
                ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Where an opening sits on the picture, for the overlay. */
function openingPx(r: DraftRoom, o: Opening, ppi: number) {
  const box = r.bboxPx!;
  const w = walls(asRoom(r))[o.wall];
  const at = (d: number) => ({ x: box.x + (w.a.x + w.dir.x * d) * ppi, y: box.y + (w.a.y + w.dir.y * d) * ppi });
  const [a, b] = [at(o.offset), at(o.offset + o.width)];
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}
