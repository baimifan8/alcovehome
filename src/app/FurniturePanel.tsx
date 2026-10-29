import { useState, type Dispatch } from "react";
import library from "../data/library.json";
import type { Rules } from "../engine/index.ts";
import { effectiveSize } from "../model/size.ts";
import type { AddOn, Footprint, InventoryItem, Space } from "../model/types.ts";
import { formatSize, type Units } from "../model/units.ts";
import { LengthInput } from "./LengthInput.tsx";
import { ProductImport, ShapeFields } from "./ProductImport.tsx";
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

  const dims = (i: InventoryItem) => {
    const e = effectiveSize(i);
    return `${formatSize(e.width, units)} W × ${formatSize(e.depth, units)} D × ${formatSize(e.height, units)} H${i.footprint.shape === "l" ? " · L-shaped" : ""}`;
  };
  const origin = (i: InventoryItem) => {
    const notes = [
      i.overrides && Object.keys(i.overrides).length ? "your size" : i.source.type === "product" ? "store size" : i.source.type === "generic" ? "typical size" : "",
    ];
    const on = i.addOns.filter((a) => a.on).length;
    if (on) notes.push(`${on} add-on${on === 1 ? "" : "s"} on`);
    return notes.filter(Boolean).map((n) => ` · ${n}`).join("");
  };
  const placedCount = (id: string) => space?.placements.filter((p) => p.itemId === id).length ?? 0;

  return (
    <div className="panel-body">
      <p className="hint">Your furniture is saved once and reused for every listing.</p>

      <h3>From a store</h3>
      <ProductImport rules={rules} units={units} onAdd={(item) => dispatch({ type: "addItem", item })} />

      <h3>Common items</h3>

      <div className="row end">
        <label className="field grow">
          <span>Pick one (typical sizes)</span>
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
      {inventory.length === 0 && <p className="hint">Nothing yet. Paste a store link, pick a common item, or enter your own sizes.</p>}
      <ul className="inventory">
        {inventory.map((i) => (
          <li key={i.id}>
            <div className="grow">
              <strong>{i.nickname || rules.itemKinds[i.kind]?.label}</strong>
              <small>
                {dims(i)}
                {origin(i)}
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
  const set = (patch: Partial<InventoryItem>) => setDraft((d) => ({ ...d, ...patch }));
  // Store sizes stay locked; changing them is a deliberate, labeled override.
  const fromStore = draft.source.type === "product";
  const [ownSize, setOwnSize] = useState(Boolean(item.overrides && Object.keys(item.overrides).length));
  const o = draft.overrides ?? {};
  const setOverride = (k: "width" | "depth" | "height", v: number) => set({ overrides: { ...o, [k]: v } });
  const setAddOn = (a: AddOn) => set({ addOns: draft.addOns.map((x) => (x.id === a.id ? a : x)) });
  const total = effectiveSize(draft);

  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...draft,
          nickname: draft.nickname.trim() || rules.itemKinds[draft.kind]?.label || "Item",
          overrides: fromStore && ownSize && Object.keys(o).length ? o : undefined,
          addOns: draft.addOns.map((a) => ({ ...a, label: a.label.trim() || "Add-on" })),
        });
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

      {fromStore ? (
        <>
          <p className="hint">
            Store size: {formatSize(draft.width, units)} W × {formatSize(draft.depth, units)} D × {formatSize(draft.height, units)} H{" "}
            {draft.source.type === "product" && (
              <a href={draft.source.url} target="_blank" rel="noopener noreferrer">
                product page ↗
              </a>
            )}
          </p>
          <label className="inline">
            <input
              type="checkbox"
              checked={ownSize}
              onChange={(e) => {
                setOwnSize(e.target.checked);
                if (!e.target.checked) set({ overrides: undefined });
              }}
            />{" "}
            Use my own size instead (for example, it was measured differently)
          </label>
          {ownSize && (
            <div className="row">
              <LengthInput label="Your width" value={o.width ?? draft.width} units={units} bare="in" min={1} onChange={(v) => setOverride("width", v)} />
              <LengthInput label="Your depth" value={o.depth ?? draft.depth} units={units} bare="in" min={1} onChange={(v) => setOverride("depth", v)} />
              <LengthInput label="Your height" value={o.height ?? draft.height} units={units} bare="in" min={1} onChange={(v) => setOverride("height", v)} />
            </div>
          )}
        </>
      ) : (
        <div className="row">
          <LengthInput label="Width" value={draft.width} units={units} bare="in" min={1} onChange={(width) => set({ width })} />
          <LengthInput label="Depth" value={draft.depth} units={units} bare="in" min={1} onChange={(depth) => set({ depth })} />
          <LengthInput label="Height" value={draft.height} units={units} bare="in" min={1} onChange={(height) => set({ height })} />
        </div>
      )}
      <ShapeFields footprint={draft.footprint} width={draft.width} depth={draft.depth} units={units} onChange={(footprint) => set({ footprint })} />

      <h3>Add-ons</h3>
      <p className="hint">Extras that make it bigger, like a monitor arm (+6 in deep), a hutch (+30 in tall) or a table leaf (+18 in wide). Switch them on or off.</p>
      {draft.addOns.map((a) => (
        <fieldset key={a.id} className="addon">
          <legend>
            <label className="inline">
              <input type="checkbox" checked={a.on} onChange={(e) => setAddOn({ ...a, on: e.target.checked })} /> On
            </label>
            <input type="text" aria-label="Add-on name" value={a.label} placeholder="e.g. Monitor arm" onChange={(e) => setAddOn({ ...a, label: e.target.value })} />
            <button type="button" className="link" onClick={() => set({ addOns: draft.addOns.filter((x) => x.id !== a.id) })}>
              Remove
            </button>
          </legend>
          <div className="row">
            <LengthInput label="+ Width" value={a.width} units={units} bare="in" onChange={(width) => setAddOn({ ...a, width })} />
            <LengthInput label="+ Depth" value={a.depth} units={units} bare="in" onChange={(depth) => setAddOn({ ...a, depth })} />
            <LengthInput label="+ Height" value={a.height} units={units} bare="in" onChange={(height) => setAddOn({ ...a, height })} />
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() => set({ addOns: [...draft.addOns, { id: newId(), label: "", width: 0, depth: 0, height: 0, on: true }] })}
      >
        + Add-on
      </button>

      <p className="hint">
        Size used for fitting: {formatSize(total.width, units)} W × {formatSize(total.depth, units)} D × {formatSize(total.height, units)} H
      </p>
      <div className="row">
        <button type="submit">Save</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
