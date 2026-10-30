import { useEffect, useState } from "react";
import { suggest, type RoomReport, type Rules, type Suggestion } from "../engine/index.ts";
import type { InventoryItem, Placement, Result, Room } from "../model/types.ts";
import { effectiveSize } from "../model/size.ts";
import { formatLength, formatSize, type Units } from "../model/units.ts";

const LABEL: Record<Result, string> = { fits: "Fits", tight: "Tight", "doesnt-fit": "Doesn't fit" };

interface Props {
  room: Room;
  items: InventoryItem[];
  placements: Placement[];
  report: RoomReport;
  rules: Rules;
  units: Units;
  selected: string | null;
  onSelect: (id: string) => void;
  onMove: (p: Placement) => void;
  onRemove: (id: string) => void;
  /** View only (a shared plan): no turning, removing or suggestions. */
  readOnly?: boolean;
}

export function VerdictPanel({ room, items, placements, report, rules, units, selected, onSelect, onMove, onRemove, readOnly = false }: Props) {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const placementById = new Map(placements.map((p) => [p.id, p]));
  const counts = { fits: 0, tight: 0, "doesnt-fit": 0 };
  for (const v of report.verdicts) counts[v.result]++;

  return (
    <div className="panel-body">
      {report.verdicts.length === 0 ? (
        <p className="hint">{readOnly ? "No furniture has been placed in this room." : "Place furniture from the Furniture tab to get a verdict for each piece."}</p>
      ) : (
        <p className="summary" aria-live="polite">
          <span className="badge fits">{counts.fits} fit</span>
          <span className="badge tight">{counts.tight} tight</span>
          <span className="badge doesnt-fit">{counts["doesnt-fit"]} don't fit</span>
        </p>
      )}
      {report.walkway.notes.map((n) => (
        <p key={n} className="note">
          {n}
        </p>
      ))}

      <ul className="verdicts">
        {report.verdicts.map((v) => {
          const p = placementById.get(v.placementId)!;
          const item = itemById.get(p.itemId)!;
          const isSel = v.placementId === selected;
          return (
            <li key={v.placementId} className={isSel ? "selected" : ""}>
              <button className="verdict-head" onClick={() => onSelect(v.placementId)} aria-expanded={isSel}>
                <span className={`badge ${v.result}`}>{LABEL[v.result]}</span>
                <strong>{item.nickname}</strong>
                {v.approximate && <span className="badge approx">approximate</span>}
              </button>
              {v.reasons.length > 0 && (
                <ul className="reasons">
                  {v.reasons.map((r, i) => (
                    <li key={i}>
                      {item.nickname} {r.message}
                    </li>
                  ))}
                </ul>
              )}
              {v.approximate && (
                <ul className="reasons approx">
                  {v.approximateReasons.map((r, i) => (
                    <li key={i}>Approximate: {r}</li>
                  ))}
                </ul>
              )}
              {isSel && !readOnly && <Selected room={room} items={items} placements={placements} rules={rules} units={units} item={item} placement={p} result={v.result} onMove={onMove} onRemove={onRemove} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Selected({
  room,
  items,
  placements,
  rules,
  units,
  item,
  placement,
  result,
  onMove,
  onRemove,
}: {
  room: Room;
  items: InventoryItem[];
  placements: Placement[];
  rules: Rules;
  units: Units;
  item: InventoryItem;
  placement: Placement;
  result: Result;
  onMove: (p: Placement) => void;
  onRemove: (id: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  useEffect(() => setSuggestions(null), [placement, result]);
  const rotate = (by: number) => onMove({ ...placement, rotation: (((placement.rotation + by) % 360) + 360) % 360 });

  return (
    <div className="selected-tools">
      <small>
        {formatSize(effectiveSize(item).width, units)} × {formatSize(effectiveSize(item).depth, units)} · rotated {Math.round(placement.rotation)}°
      </small>
      <div className="row wrap">
        <button className="secondary" onClick={() => rotate(-90)} aria-label="Rotate 90 degrees counterclockwise">
          ⟲ 90°
        </button>
        <button className="secondary" onClick={() => rotate(-15)} aria-label="Rotate 15 degrees counterclockwise">
          ⟲ 15°
        </button>
        <button className="secondary" onClick={() => rotate(15)} aria-label="Rotate 15 degrees clockwise">
          ⟳ 15°
        </button>
        <button className="secondary" onClick={() => rotate(90)} aria-label="Rotate 90 degrees clockwise">
          ⟳ 90°
        </button>
        <button className="link danger" onClick={() => onRemove(placement.id)}>
          Remove from room
        </button>
      </div>
      {result !== "fits" && (
        <div className="suggest">
          {suggestions === null ? (
            <button className="secondary" onClick={() => setSuggestions(suggest({ room, items, placements }, rules, placement.id, item.nickname, { format: (v) => formatLength(v, units) }))}>
              Suggest a fix
            </button>
          ) : suggestions.length === 0 ? (
            <p className="hint">No single move or turn fixes this. Try another spot or a smaller piece.</p>
          ) : (
            <ul>
              {suggestions.map((s) => (
                <li key={s.message}>
                  {s.message} <span className={`badge ${s.result}`}>{LABEL[s.result]}</span>{" "}
                  <button className="link" onClick={() => onMove(s.placement)}>
                    Apply
                  </button>
                </li>
              ))}
            </ul>
          )}
          <small className="hint">Suggestions never change a verdict; they show what would.</small>
        </div>
      )}
    </div>
  );
}
