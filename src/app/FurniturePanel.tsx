import { useState, type Dispatch } from "react";
import library from "../data/library.json";
import type { Rules } from "../engine/index.ts";
import type { Footprint, InventoryItem, Space } from "../model/types.ts";
import { formatSize, type Units } from "../model/units.ts";
import { LengthInput } from "./LengthInput.tsx";
import { newId, type Action } from "./store.ts";

interface LibraryItem {
  id: string;
  name: string;
  kind: string;
  width: number;
  depth: number;
  height: number;
  footprint?: Footprint;
}

const groups = library.groups as { label: string; items: LibraryItem[] }[];

interface Props {
  inventory: InventoryItem[];
  space: Space | null;
  roomId: string | null;
  rules: Rules;
  units: Units;
  dispatch: Dispatch<Action>;
  onPlace: (item: InventoryItem) => void;
}

export function FurniturePanel({ inventory, space, roomId, rules, units, dispatch, onPlace }: Props) {
  const [libraryId, setLibraryId] = useState(groups[0].items[0].id);
  const [editing, setEditing] = useState<InventoryItem | null>(null);

  const addFromLibrary = () => {
    const l = groups.flatMap((g) => g.items).find((i) => i.id === libraryId)!;
    dispatch({
      type: "addItem",
      item: {
        id: newId(),
        nickname: l.name,
        kind: l.kind,
        source: { type: "generic", libraryId: l.id },
        width: l.width,
        depth: l.depth,
        height: l.height,
        footprint: l.footprint ?? { shape: "rect" },
        addOns: [],
      },
    });
  };

  const blank = (): InventoryItem => ({
    id: newId(),
    nickname: "",
    kind: "generic",
    source: { type: "manual" },
    width: 36,
    depth: 18,
    height: 30,
    footprint: { shape: "rect" },
    addOns: [],
  });

  const dims = (i: InventoryItem) =>
    `${formatSize(i.width, units)} W × ${formatSize(i.depth, units)} D × ${formatSize(i.height, units)} H${i.footprint.shape === "l" ? " · L-shaped" : ""}`;
  const placedCount = (id: string) => space?.placements.filter((p) => p.itemId === id).length ?? 0;

  return (
    <div className="panel-body">
      <p className="hint">Your furniture is saved once and reused for every listing.</p>

      <div className="row end">
        <label className="field grow">
          <span>Common items (typical sizes)</span>
          <select value={libraryId} onChange={(e) => setLibraryId(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({formatSize(i.width, units)} × {formatSize(i.depth, units)})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button onClick={addFromLibrary}>Add</button>
      </div>
      <button className="secondary" onClick={() => setEditing(blank())}>
        + Enter my own sizes
      </button>

      {editing && (
        <ItemEditor
          item={editing}
          rules={rules}
          units={units}
          isNew={!inventory.some((i) => i.id === editing.id)}
          onSave={(item) => {
            dispatch({ type: inventory.some((i) => i.id === item.id) ? "updateItem" : "addItem", item });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <h3>My furniture</h3>
      {inventory.length === 0 && <p className="hint">Nothing yet. Add a common item above or enter your own sizes.</p>}
      <ul className="inventory">
        {inventory.map((i) => (
          <li key={i.id}>
            <div className="grow">
              <strong>{i.nickname || rules.itemKinds[i.kind]?.label}</strong>
              <small>
                {dims(i)}
                {i.source.type === "generic" ? " · typical size" : ""}
              </small>
            </div>
            <div className="actions">
              <button disabled={!roomId} onClick={() => onPlace(i)} title={roomId ? "Place in this room" : "Create a room first"}>
                Place{placedCount(i.id) ? ` (${placedCount(i.id)})` : ""}
              </button>
              <button className="link" onClick={() => setEditing(i)}>
                Edit
              </button>
              <button
                className="link danger"
                onClick={() => confirm(`Delete ${i.nickname} from your furniture? It will be removed from every plan.`) && dispatch({ type: "deleteItem", id: i.id })}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemEditor({
  item,
  rules,
  units,
  isNew,
  onSave,
  onCancel,
}: {
  item: InventoryItem;
  rules: Rules;
  units: Units;
  isNew: boolean;
  onSave: (i: InventoryItem) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(item);
  const set = (patch: Partial<InventoryItem>) => setDraft({ ...draft, ...patch });
  const fp = draft.footprint;

  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...draft, nickname: draft.nickname.trim() || rules.itemKinds[draft.kind]?.label || "Item" });
      }}
    >
      <h3>{isNew ? "New item" : `Edit ${item.nickname}`}</h3>
      <label className="field">
        <span>Name</span>
        <input type="text" value={draft.nickname} placeholder="e.g. My desk" onChange={(e) => set({ nickname: e.target.value })} />
      </label>
      <label className="field">
        <span>Type (sets the clearance it needs)</span>
        <select value={draft.kind} onChange={(e) => set({ kind: e.target.value })}>
          {Object.entries(rules.itemKinds).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <LengthInput label="Width" value={draft.width} units={units} bare="in" min={1} onChange={(width) => set({ width })} />
        <LengthInput label="Depth" value={draft.depth} units={units} bare="in" min={1} onChange={(depth) => set({ depth })} />
        <LengthInput label="Height" value={draft.height} units={units} bare="in" min={1} onChange={(height) => set({ height })} />
      </div>
      <label className="field">
        <span>Shape</span>
        <select
          value={fp.shape}
          onChange={(e) =>
            set({
              footprint:
                e.target.value === "l"
                  ? { shape: "l", side: "left", returnWidth: Math.round(draft.width / 3), returnDepth: Math.round(draft.depth * 1.8) }
                  : { shape: "rect" },
            })
          }
        >
          <option value="rect">Rectangle</option>
          <option value="l">L-shaped (sectional, corner desk)</option>
        </select>
      </label>
      {fp.shape === "l" && (
        <div className="row">
          <label className="field">
            <span>Chaise / return on the</span>
            <select value={fp.side} onChange={(e) => set({ footprint: { ...fp, side: e.target.value as "left" | "right" } })}>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <LengthInput label="Return width" value={fp.returnWidth} units={units} bare="in" min={1} onChange={(returnWidth) => set({ footprint: { ...fp, returnWidth } })} />
          <LengthInput label="Depth at the return" value={fp.returnDepth} units={units} bare="in" min={1} onChange={(returnDepth) => set({ footprint: { ...fp, returnDepth } })} />
        </div>
      )}
      <div className="row">
        <button type="submit">Save</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
