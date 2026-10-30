import { useState, type Dispatch } from "react";
import { loadImage, type PlanImage } from "../import/client.ts";
import type { BuiltIn, Opening, Room, Space } from "../model/types.ts";
import type { Units } from "../model/units.ts";
import { LengthInput } from "./LengthInput.tsx";
import { newBuiltIn, newOpening, rectRoom, resizeRoom, roomSize, type Action } from "./store.ts";

const WALLS = ["Top", "Right", "Bottom", "Left"];
const TYPES: { type: Opening["type"]; label: string }[] = [
  { type: "door", label: "Door" },
  { type: "closet_door", label: "Closet door" },
  { type: "window", label: "Window" },
  { type: "passage", label: "Open doorway" },
];

interface Props {
  space: Space;
  room: Room | null;
  units: Units;
  dispatch: Dispatch<Action>;
}

export function RoomPanel({ space, room, units, dispatch }: Props) {
  return (
    <div className="panel-body">
      <label className="field">
        <span>Listing</span>
        <input type="text" value={space.name} onChange={(e) => dispatch({ type: "updateSpace", space: { ...space, name: e.target.value } })} />
      </label>

      <div className="room-tabs" role="tablist" aria-label="Rooms">
        {space.rooms.map((r) => (
          <button
            key={r.id}
            role="tab"
            aria-selected={r.id === room?.id}
            className={r.id === room?.id ? "tab active" : "tab"}
            onClick={() => dispatch({ type: "select", spaceId: space.id, roomId: r.id })}
          >
            {r.name || "Room"}
          </button>
        ))}
        <button className="tab add" onClick={() => dispatch({ type: "addRoom", room: rectRoom(`Room ${space.rooms.length + 1}`, 120, 120) })}>
          + Room
        </button>
      </div>

      {space.sourceImage && <OriginalPlan imageKey={space.sourceImage} />}
      {room && <RoomEditor room={room} units={units} dispatch={dispatch} canDelete={space.rooms.length > 1} />}
    </div>
  );
}

function OriginalPlan({ imageKey }: { imageKey: string }) {
  const [image, setImage] = useState<PlanImage | null | "missing">(null);
  if (image && image !== "missing") {
    return (
      <div className="original-plan">
        <img src={image.dataUrl} alt="The original floor plan" />
        <button className="link" onClick={() => setImage(null)}>
          Hide the floor plan
        </button>
      </div>
    );
  }
  return image === "missing" ? (
    <p className="hint">The floor plan picture isn't saved on this device.</p>
  ) : (
    <button className="link" onClick={async () => setImage((await loadImage(imageKey)) ?? "missing")}>
      Show the original floor plan
    </button>
  );
}

function RoomEditor({ room, units, dispatch, canDelete }: { room: Room; units: Units; dispatch: Dispatch<Action>; canDelete: boolean }) {
  const size = roomSize(room);
  const update = (r: Room) => dispatch({ type: "updateRoom", room: r });
  const setOpening = (o: Opening) => update({ ...room, openings: room.openings.map((x) => (x.id === o.id ? o : x)) });
  const builtIns = room.builtIns ?? [];
  const setBuiltIns = (b: BuiltIn[]) => update({ ...room, builtIns: b });

  return (
    <>
      <label className="field">
        <span>Room name</span>
        <input type="text" value={room.name} onChange={(e) => update({ ...room, name: e.target.value })} />
      </label>
      <div className="row">
        <LengthInput label="Width (left to right)" value={size.width} units={units} bare="ft" min={24} onChange={(w) => update(resizeRoom(room, w, size.length))} />
        <LengthInput label="Length (top to bottom)" value={size.length} units={units} bare="ft" min={24} onChange={(l) => update(resizeRoom(room, size.width, l))} />
      </div>

      {room.approximate && (
        <p className="note">This room's size came from listing text, so its shape and doors are guesses. Add the doors you know about.</p>
      )}
      {room.wallSources.includes("inferred") && (
        <p className="note">Some walls were measured from the drawing rather than read from a printed size. Answers that depend on them are marked approximate. Retype a size to confirm it.</p>
      )}

      <h3>Doors and windows</h3>
      {room.openings.length === 0 && <p className="hint">Add the entry door so walkways can be checked.</p>}
      {room.openings.map((o, i) => (
        <OpeningEditor
          key={o.id}
          index={i}
          room={room}
          opening={o}
          units={units}
          onChange={setOpening}
          onDelete={() => update({ ...room, openings: room.openings.filter((x) => x.id !== o.id) })}
          onMakeEntry={() => update({ ...room, openings: room.openings.map((x) => ({ ...x, entry: x.id === o.id })) })}
        />
      ))}
      <div className="row wrap">
        {TYPES.map((t) => (
          <button key={t.type} className="secondary" onClick={() => update({ ...room, openings: [...room.openings, newOpening(t.type, room)] })}>
            + {t.label}
          </button>
        ))}
      </div>

      <h3>Built-ins</h3>
      <p className="hint">Things that can't be moved, like a kitchen island, counter, radiator or fireplace. Nothing can be placed on them.</p>
      {builtIns.map((b) => (
        <BuiltInEditor
          key={b.id}
          room={room}
          builtIn={b}
          units={units}
          onChange={(nb) => setBuiltIns(builtIns.map((x) => (x.id === nb.id ? nb : x)))}
          onDelete={() => setBuiltIns(builtIns.filter((x) => x.id !== b.id))}
        />
      ))}
      <div className="row wrap">
        <button className="secondary" onClick={() => setBuiltIns([...builtIns, newBuiltIn(room)])}>
          + Built-in
        </button>
      </div>

      {canDelete && (
        <button className="danger" onClick={() => confirm(`Delete ${room.name}?`) && dispatch({ type: "deleteRoom", id: room.id })}>
          Delete room
        </button>
      )}
    </>
  );
}

export interface OpeningProps {
  index: number;
  room: Room;
  opening: Opening;
  units: Units;
  onChange: (o: Opening) => void;
  onDelete: () => void;
  onMakeEntry: () => void;
  /** Highlight for review (the floor plan reader wasn't sure). */
  doubtful?: boolean;
}

/**
 * Shown in plan terms (distance from the plan's left or top corner; hinge left/right
 * or top/bottom on the plan) and stored in model terms (offset from the wall's start
 * vertex; hinge as seen from inside the room).
 */
export function OpeningEditor({ room, opening: o, units, onChange, onDelete, onMakeEntry, doubtful }: OpeningProps) {
  const size = roomSize(room);
  const horizontal = o.wall % 2 === 0;
  const wallLen = horizontal ? size.width : size.length;
  const startsAtPlanCorner = o.wall === 0 || o.wall === 1;
  const fromCorner = startsAtPlanCorner ? o.offset : wallLen - o.offset - o.width;
  const toOffset = (d: number, width: number) => {
    const clamped = Math.max(0, Math.min(d, wallLen - width));
    return startsAtPlanCorner ? clamped : wallLen - clamped - width;
  };
  const planHinge = (o.hinge === "left") === startsAtPlanCorner ? "first" : "second";
  const isDoor = o.type === "door" || o.type === "closet_door";
  const canBeEntry = o.type === "door" || o.type === "passage";
  const entryId = room.openings.find((x) => x.entry && (x.type === "door" || x.type === "passage"))?.id ?? room.openings.find((x) => x.type === "door" || x.type === "passage")?.id;

  return (
    <fieldset className={doubtful ? "opening doubtful" : "opening"}>
      <legend>
        <select value={o.type} aria-label="Type" onChange={(e) => onChange({ ...o, type: e.target.value as Opening["type"] })}>
          {TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        {canBeEntry && (
          <label className="inline">
            <input type="radio" name={`entry-${room.id}`} checked={entryId === o.id} onChange={onMakeEntry} /> Entry
          </label>
        )}
        <button className="link" onClick={onDelete} aria-label="Remove">
          Remove
        </button>
      </legend>
      <div className="row">
        <label className="field">
          <span>Wall</span>
          <select
            value={o.wall}
            onChange={(e) => {
              const wall = Number(e.target.value);
              const len = wall % 2 === 0 ? size.width : size.length;
              const width = Math.min(o.width, len);
              onChange({ ...o, wall, width, offset: Math.max(0, Math.min(o.offset, len - width)) });
            }}
          >
            {WALLS.map((w, i) => (
              <option key={w} value={i}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <LengthInput
          label={`From ${horizontal ? "left" : "top"} corner`}
          value={fromCorner}
          units={units}
          bare="in"
          onChange={(d) => onChange({ ...o, offset: toOffset(d, o.width) })}
        />
        <LengthInput
          label="Width"
          value={o.width}
          units={units}
          bare="in"
          min={1}
          onChange={(w) => {
            const width = Math.min(w, wallLen);
            onChange({ ...o, width, offset: toOffset(fromCorner, width) });
          }}
        />
      </div>
      {isDoor && (
        <div className="row">
          <label className="field">
            <span>Opens by</span>
            <select value={o.operation} onChange={(e) => onChange({ ...o, operation: e.target.value as Opening["operation"] })}>
              <option value="swing">Swinging</option>
              <option value="sliding">Sliding</option>
              <option value="bifold">Bifold</option>
            </select>
          </label>
          {o.operation === "swing" && (
            <>
              <label className="field">
                <span>Swings</span>
                <select value={o.swing} onChange={(e) => onChange({ ...o, swing: e.target.value as Opening["swing"] })}>
                  <option value="in">Into room</option>
                  <option value="out">Out of room</option>
                </select>
              </label>
              <label className="field">
                <span>Hinge</span>
                <select
                  value={planHinge}
                  onChange={(e) => {
                    const first = e.target.value === "first";
                    onChange({ ...o, hinge: first === startsAtPlanCorner ? "left" : "right" });
                  }}
                >
                  <option value="first">{horizontal ? "Left" : "Top"}</option>
                  <option value="second">{horizontal ? "Right" : "Bottom"}</option>
                </select>
              </label>
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}

export interface BuiltInProps {
  room: Room;
  builtIn: BuiltIn;
  units: Units;
  onChange: (b: BuiltIn) => void;
  onDelete: () => void;
  /** Highlight for review (the floor plan reader wasn't sure). */
  doubtful?: boolean;
}

/** A built-in's name, position from the plan's top-left corner and size, kept inside the room. */
export function BuiltInEditor({ room, builtIn: b, units, onChange, onDelete, doubtful }: BuiltInProps) {
  const size = roomSize(room);
  const set = (patch: Partial<BuiltIn>) => {
    const next = { ...b, ...patch };
    const width = Math.min(next.width, size.width);
    const length = Math.min(next.length, size.length);
    onChange({
      ...next,
      width,
      length,
      x: Math.max(0, Math.min(next.x, size.width - width)),
      y: Math.max(0, Math.min(next.y, size.length - length)),
    });
  };
  return (
    <fieldset className={doubtful ? "opening doubtful" : "opening"}>
      <legend>
        <input type="text" aria-label="Built-in name" value={b.label} placeholder="e.g. Kitchen island" onChange={(e) => onChange({ ...b, label: e.target.value })} />
        <button className="link" onClick={onDelete} aria-label="Remove">
          Remove
        </button>
      </legend>
      <div className="row">
        <LengthInput label="From left wall" value={b.x} units={units} bare="in" onChange={(x) => set({ x })} />
        <LengthInput label="From top wall" value={b.y} units={units} bare="in" onChange={(y) => set({ y })} />
      </div>
      <div className="row">
        <LengthInput label="Width (left to right)" value={b.width} units={units} bare="in" min={1} onChange={(width) => set({ width })} />
        <LengthInput label="Length (top to bottom)" value={b.length} units={units} bare="in" min={1} onChange={(length) => set({ length })} />
      </div>
    </fieldset>
  );
}
