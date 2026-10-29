import { useEffect, useMemo, useReducer, useState } from "react";
import { evaluateRoom } from "../engine/index.ts";
import { saveImage, type PlanImage } from "../import/client.ts";
import { draftToRoom, type DraftPlan, type DraftRoom } from "../import/draft.ts";
import type { InventoryItem, Placement } from "../model/types.ts";
import { formatLength } from "../model/units.ts";
import { FurniturePanel } from "./FurniturePanel.tsx";
import { ConfirmPlan } from "./ConfirmPlan.tsx";
import { NewListing } from "./NewListing.tsx";
import { PlanView } from "./PlanView.tsx";
import { RoomPanel } from "./RoomPanel.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { findSpot, load, newId, rectRoom, reducer, rulesFor, save } from "./store.ts";
import { VerdictPanel } from "./VerdictPanel.tsx";

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  const [tab, setTab] = useState<"room" | "furniture">("room");
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  /** A floor plan or listing text that has been read and is waiting to be checked. */
  const [pending, setPending] = useState<{ name: string; draft: DraftPlan; image: PlanImage | null } | null>(null);

  useEffect(() => {
    if (dragging) return;
    const t = setTimeout(() => save(state), 200);
    return () => clearTimeout(t);
  }, [state, dragging]);

  const rules = useMemo(() => rulesFor(state.settings), [state.settings]);
  const space = state.spaces.find((s) => s.id === state.current.spaceId) ?? null;
  const room = space?.rooms.find((r) => r.id === state.current.roomId) ?? space?.rooms[0] ?? null;
  const placements = useMemo(() => space?.placements.filter((p) => p.roomId === room?.id) ?? [], [space, room]);
  const units = state.settings.units;
  const format = useMemo(() => (inches: number) => formatLength(inches, units), [units]);
  const report = useMemo(
    () => (room ? evaluateRoom({ room, items: state.inventory, placements }, rules, { skipWalkway: dragging, format }) : null),
    [room, state.inventory, placements, rules, dragging, format],
  );

  const move = (p: Placement, final = true) => {
    setDragging(!final);
    dispatch({ type: "movePlacement", placement: p });
  };
  const remove = (id: string) => {
    dispatch({ type: "removePlacement", id });
    setSelected(null);
  };
  const place = (item: InventoryItem) => {
    if (!room) return;
    const p = findSpot(state, room, item);
    dispatch({ type: "place", placement: p });
    setSelected(p.id);
    // On phones the plan sits above the panels; bring it back into view.
    document.querySelector(".plan")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const startPlan = () => {
    setCreating(false);
    setPending(null);
    setSelected(null);
    setTab("room");
  };

  const confirmDraft = async (rooms: DraftRoom[]) => {
    if (!pending) return;
    const id = newId();
    const saved = pending.image ? await saveImage(id, pending.image) : false;
    dispatch({
      type: "createSpace",
      id,
      name: pending.name,
      rooms: rooms.map((r) => draftToRoom(r, newId())),
      ...(saved ? { sourceImage: id } : {}),
    });
    startPlan();
  };

  if (pending) {
    return (
      <ConfirmPlan
        name={pending.name}
        draft={pending.draft}
        image={pending.image}
        units={units}
        onBack={() => setPending(null)}
        onConfirm={(rooms) => void confirmDraft(rooms)}
      />
    );
  }

  if (!space || creating) {
    return (
      <NewListing
        units={units}
        hasSpaces={state.spaces.length > 0}
        onCancel={() => setCreating(false)}
        onTyped={(name, roomName, w, l) => {
          dispatch({ type: "createSpace", name, rooms: [rectRoom(roomName, w, l)] });
          startPlan();
        }}
        onDraft={(name, draft, image) => setPending({ name, draft, image })}
      />
    );
  }

  return (
    <div className="app">
      <header>
        <h1>Alcove Home</h1>
        <select
          aria-label="Listing"
          value={space.id}
          onChange={(e) => {
            dispatch({ type: "select", spaceId: e.target.value });
            setSelected(null);
          }}
        >
          {state.spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name || "Untitled listing"}
            </option>
          ))}
        </select>
        <button className="secondary" onClick={() => setCreating(true)}>
          New listing
        </button>
        <span className="spacer" />
        <button className="secondary" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </header>

      <aside className="left">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "room"} className={tab === "room" ? "tab active" : "tab"} onClick={() => setTab("room")}>
            Room
          </button>
          <button role="tab" aria-selected={tab === "furniture"} className={tab === "furniture" ? "tab active" : "tab"} onClick={() => setTab("furniture")}>
            Furniture
          </button>
        </div>
        {tab === "room" ? (
          <>
            <RoomPanel space={space} room={room} units={units} dispatch={dispatch} />
            <div className="panel-body">
              <button
                className="link danger"
                onClick={() => confirm(`Delete the plan for ${space.name}? Your furniture stays.`) && dispatch({ type: "deleteSpace", id: space.id })}
              >
                Delete this listing's plan
              </button>
            </div>
          </>
        ) : (
          <FurniturePanel inventory={state.inventory} space={space} roomId={room?.id ?? null} rules={rules} units={units} dispatch={dispatch} onPlace={place} />
        )}
      </aside>

      <main>
        {room && report ? (
          <>
            <PlanView
              room={room}
              items={state.inventory}
              placements={placements}
              report={report}
              rules={rules}
              units={units}
              selected={selected}
              onSelect={setSelected}
              onMove={move}
              onRemove={remove}
            />
            <p className="plan-help">Drag to move · drag the dot to rotate · Alt turns off snapping · arrows nudge, R rotates</p>
          </>
        ) : (
          <p className="hint">Add a room to start.</p>
        )}
      </main>

      <aside className="right">
        <h2>Fit verdicts</h2>
        {room && report && (
          <VerdictPanel
            room={room}
            items={state.inventory}
            placements={placements}
            report={report}
            rules={rules}
            units={units}
            selected={selected}
            onSelect={setSelected}
            onMove={(p) => move(p, true)}
            onRemove={remove}
          />
        )}
      </aside>

      <SettingsDialog
        open={settingsOpen}
        settings={state.settings}
        onChange={(settings) => dispatch({ type: "settings", settings })}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
