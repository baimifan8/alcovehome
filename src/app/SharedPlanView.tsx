import { useMemo, useState } from "react";
import { defaultRules, evaluateRoom, withClearances } from "../engine/index.ts";
import { formatLength, type Units } from "../model/units.ts";
import type { SharedPlan } from "../share/share.ts";
import { PlanView } from "./PlanView.tsx";
import { VerdictPanel } from "./VerdictPanel.tsx";

interface Props {
  plan: SharedPlan;
  units: Units;
  onSave: () => void;
  onClose: () => void;
}

/** Someone else's plan, opened from a share link: look, don't touch, or save a copy. */
export function SharedPlanView({ plan, units, onSave, onClose }: Props) {
  const [roomId, setRoomId] = useState(plan.rooms[0].id);
  const [selected, setSelected] = useState<string | null>(null);
  const room = plan.rooms.find((r) => r.id === roomId) ?? plan.rooms[0];
  // The sender's clearances, so the answers match what they saw.
  const rules = useMemo(() => withClearances(defaultRules, plan.clearances), [plan.clearances]);
  const placements = useMemo(() => plan.placements.filter((p) => p.roomId === room.id), [plan.placements, room.id]);
  const format = useMemo(() => (inches: number) => formatLength(inches, units), [units]);
  const report = useMemo(() => evaluateRoom({ room, items: plan.items, placements }, rules, { format }), [room, plan.items, placements, rules, format]);
  const noop = () => {};

  return (
    <div className="app">
      <header>
        <h1>Alcove Home</h1>
        <span className="shared-title">
          Shared plan: <strong>{plan.name || "Untitled listing"}</strong>
        </span>
        <span className="spacer" />
        <button onClick={onSave}>Save a copy to my listings</button>
        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </header>

      <aside className="left">
        <div className="panel-body">
          <p className="hint">You're looking at a plan someone shared with you. Save a copy to move things around or try your own furniture.</p>
          <div className="room-tabs" role="tablist" aria-label="Rooms">
            {plan.rooms.map((r) => (
              <button
                key={r.id}
                role="tab"
                aria-selected={r.id === room.id}
                className={r.id === room.id ? "tab active" : "tab"}
                onClick={() => {
                  setRoomId(r.id);
                  setSelected(null);
                }}
              >
                {r.name || "Room"}
              </button>
            ))}
          </div>
          {Object.keys(plan.clearances).length > 0 && <p className="note">These answers use the sender's clearance settings. A saved copy uses yours.</p>}
        </div>
      </aside>

      <main>
        <PlanView
          room={room}
          items={plan.items}
          placements={placements}
          report={report}
          rules={rules}
          units={units}
          selected={selected}
          onSelect={setSelected}
          onMove={noop}
          onRemove={noop}
          readOnly
        />
      </main>

      <aside className="right">
        <h2>Fit verdicts</h2>
        <VerdictPanel
          room={room}
          items={plan.items}
          placements={placements}
          report={report}
          rules={rules}
          units={units}
          selected={selected}
          onSelect={setSelected}
          onMove={noop}
          onRemove={noop}
          readOnly
        />
      </aside>
    </div>
  );
}
