import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { bounds } from "../engine/geometry.ts";
import { placeItem, walls, type PlacedItem, type RoomReport, type Rules } from "../engine/index.ts";
import type { InventoryItem, Placement, Point, Result, Room } from "../model/types.ts";
import { formatLength, type Units } from "../model/units.ts";
import { snap } from "./snap.ts";

interface Props {
  room: Room;
  items: InventoryItem[];
  placements: Placement[];
  report: RoomReport;
  rules: Rules;
  units: Units;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** `final` is false while dragging and true on release. */
  onMove: (p: Placement, final: boolean) => void;
  onRemove: (id: string) => void;
  /** View only (a shared plan): pieces can be selected but not moved. */
  readOnly?: boolean;
}

const MARGIN = 30;
const WALL = 5;

type Drag =
  | { kind: "move"; id: string; grab: Point; pointerId: number }
  | { kind: "rotate"; id: string; pointerId: number };

const pts = (poly: Point[]) => poly.map((p) => `${p.x},${p.y}`).join(" ");

export function PlanView({ room, items, placements, report, rules, units, selected, onSelect, onMove, onRemove, readOnly = false }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const placed = useMemo(
    () => placements.filter((p) => itemById.has(p.itemId)).map((p) => placeItem(p, itemById.get(p.itemId)!, rules)),
    [placements, itemById, rules],
  );
  const verdict = new Map(report.verdicts.map((v) => [v.placementId, v]));
  const b = bounds(room.outline);
  const view = { x: b.minX - MARGIN, y: b.minY - MARGIN, w: b.maxX - b.minX + MARGIN * 2, h: b.maxY - b.minY + MARGIN * 2 };
  const sel = placed.find((p) => p.placement.id === selected) ?? null;

  const toPlan = (e: { clientX: number; clientY: number }): Point => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: pt.x, y: pt.y };
  };
  /** Inches per screen pixel, so snapping feels the same at any zoom. */
  const inchesPerPx = () => {
    const r = svg.current!.getBoundingClientRect();
    return Math.max(view.w / r.width, view.h / r.height);
  };

  const startMove = (e: ReactPointerEvent, p: PlacedItem) => {
    e.stopPropagation();
    onSelect(p.placement.id);
    if (readOnly) return;
    const at = toPlan(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ kind: "move", id: p.placement.id, grab: { x: at.x - p.placement.x, y: at.y - p.placement.y }, pointerId: e.pointerId });
  };
  const startRotate = (e: ReactPointerEvent, p: PlacedItem) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ kind: "rotate", id: p.placement.id, pointerId: e.pointerId });
  };

  const dragTo = (e: ReactPointerEvent, final: boolean) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const p = placed.find((q) => q.placement.id === drag.id);
    if (!p) return;
    const at = toPlan(e);
    let next: Placement;
    if (drag.kind === "move") {
      next = { ...p.placement, x: at.x - drag.grab.x, y: at.y - drag.grab.y };
      if (!e.altKey) {
        const others = placed.filter((q) => q !== p);
        next = snap(room, p.item, next, others, 8 * inchesPerPx());
      }
    } else {
      // Handle sits behind the item's back; pointing straight up is rotation 0.
      const deg = (Math.atan2(at.x - p.placement.x, -(at.y - p.placement.y)) * 180) / Math.PI;
      const step = e.altKey ? 1 : 15;
      next = { ...p.placement, rotation: (((Math.round(deg / step) * step) % 360) + 360) % 360 };
    }
    onMove(next, final);
    if (final) setDrag(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!sel) return;
    if (readOnly) {
      if (e.key === "Escape") onSelect(null);
      return;
    }
    const step = e.shiftKey ? 6 : 1;
    const p = sel.placement;
    const moves: Record<string, Partial<Placement>> = {
      ArrowLeft: { x: p.x - step },
      ArrowRight: { x: p.x + step },
      ArrowUp: { y: p.y - step },
      ArrowDown: { y: p.y + step },
    };
    if (moves[e.key]) {
      e.preventDefault();
      onMove({ ...p, ...moves[e.key] }, true);
    } else if (e.key === "r" || e.key === "R") {
      onMove({ ...p, rotation: (p.rotation + (e.shiftKey ? 270 : 90)) % 360 }, true);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove(p.id);
    } else if (e.key === "Escape") {
      onSelect(null);
    }
  };

  const fill: Record<Result, string> = { fits: "var(--fits)", tight: "var(--tight)", "doesnt-fit": "var(--nofit)" };
  const failing = report.walkway.results.filter((r) => !r.ok);

  return (
    <svg
      ref={svg}
      className="plan"
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      role="application"
      aria-label={readOnly ? `Plan of ${room.name}.` : `Plan of ${room.name}. Select an item, then use arrow keys to move it, R to rotate, Delete to remove.`}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={() => onSelect(null)}
      onPointerMove={(e) => dragTo(e, false)}
      onPointerUp={(e) => dragTo(e, true)}
      onPointerCancel={(e) => dragTo(e, true)}
    >
      <defs>
        <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" stroke="var(--zone)" strokeWidth="1.2" />
        </pattern>
      </defs>

      <polygon points={pts(room.outline)} className="floor" />
      <polygon points={pts(room.outline)} className="walls" strokeWidth={WALL * 2} />
      <polygon points={pts(room.outline)} className="floor" />

      {walls(room).map((w) => {
        const mid = { x: (w.a.x + w.b.x) / 2 - w.inward.x * (WALL + 10), y: (w.a.y + w.b.y) / 2 - w.inward.y * (WALL + 10) };
        const vertical = Math.abs(w.dir.y) > 0.9;
        return (
          <text
            key={w.index}
            x={mid.x}
            y={mid.y}
            className={`wall-label${room.wallSources[w.index] === "inferred" ? " inferred" : ""}`}
            transform={vertical ? `rotate(-90 ${mid.x} ${mid.y})` : undefined}
          >
            {formatLength(w.length, units)}
            {room.wallSources[w.index] === "inferred" ? " (inferred)" : ""}
          </text>
        );
      })}

      {report.openings.map((o) => {
        const gap = <line key="gap" x1={o.p0.x} y1={o.p0.y} x2={o.p1.x} y2={o.p1.y} className="opening-gap" strokeWidth={WALL * 2 + 1} />;
        const cls = o.opening.confirmed ? "" : " unconfirmed";
        if (o.opening.type === "window") {
          return (
            <g key={o.opening.id} className={`window${cls}`}>
              {gap}
              <line x1={o.p0.x} y1={o.p0.y} x2={o.p1.x} y2={o.p1.y} />
              <line
                x1={o.p0.x - o.inward.x * WALL}
                y1={o.p0.y - o.inward.y * WALL}
                x2={o.p1.x - o.inward.x * WALL}
                y2={o.p1.y - o.inward.y * WALL}
              />
            </g>
          );
        }
        return (
          <g key={o.opening.id} className={`door${cls}`}>
            {gap}
            {o.keepClear.length > 0 && <polygon points={pts(o.keepClear[0])} className="keep-clear" />}
            {o.arc ? (
              <>
                <path
                  d={`M ${o.arc.closedTip.x} ${o.arc.closedTip.y} A ${o.arc.radius} ${o.arc.radius} 0 0 ${arcSweep(o)} ${o.arc.hinge.x + o.inward.x * o.arc.radius} ${o.arc.hinge.y + o.inward.y * o.arc.radius}`}
                  className="swing"
                />
                <line
                  x1={o.arc.hinge.x}
                  y1={o.arc.hinge.y}
                  x2={o.arc.hinge.x + o.inward.x * o.arc.radius}
                  y2={o.arc.hinge.y + o.inward.y * o.arc.radius}
                  className="leaf"
                />
              </>
            ) : o.opening.type !== "passage" ? (
              <line
                x1={o.p0.x + o.inward.x * 2}
                y1={o.p0.y + o.inward.y * 2}
                x2={o.p1.x + o.inward.x * 2}
                y2={o.p1.y + o.inward.y * 2}
                className="leaf"
              />
            ) : null}
            <text
              x={(o.p0.x + o.p1.x) / 2 + o.inward.x * 8}
              y={(o.p0.y + o.p1.y) / 2 + o.inward.y * 8}
              className="opening-label"
              transform={
                Math.abs(o.inward.x) > 0.9
                  ? `rotate(-90 ${(o.p0.x + o.p1.x) / 2 + o.inward.x * 8} ${(o.p0.y + o.p1.y) / 2 + o.inward.y * 8})`
                  : undefined
              }
            >
              {o.label}
            </text>
          </g>
        );
      })}

      {sel &&
        report.zones
          .filter((z) => z.placementId === sel.placement.id)
          .flatMap((z) =>
            z.zone.sides.flatMap((s) =>
              s.polys.map((poly, i) => (
                <polygon key={`${z.zone.rule.label}-${s.side}-${i}`} points={pts(poly)} className={`zone${z.ok ? "" : " blocked"}`} />
              )),
            ),
          )}

      {placed.map((p) => {
        const v = verdict.get(p.placement.id);
        const isSel = p.placement.id === selected;
        const front = [p.toWorld({ x: p.item.width * 0.3, y: p.item.depth - 3 }), p.toWorld({ x: p.item.width * 0.7, y: p.item.depth - 3 })];
        return (
          <g
            key={p.placement.id}
            className={`item${isSel ? " selected" : ""}`}
            onPointerDown={(e) => startMove(e, p)}
            style={{ cursor: readOnly ? "pointer" : drag?.id === p.placement.id ? "grabbing" : "grab" }}
          >
            {p.polys.map((poly, i) => (
              <polygon key={i} points={pts(poly)} fill={v ? fill[v.result] : "var(--muted)"} className="item-shape" />
            ))}
            <line x1={front[0].x} y1={front[0].y} x2={front[1].x} y2={front[1].y} className="front-mark" />
            <text {...labelAt(p)} className="item-label">
              {p.name}
            </text>
          </g>
        );
      })}

      {failing.map((r) => (
        <g key={r.targetId} className="walkway-fail">
          <polyline points={pts(r.path)} />
          {r.pinch && (
            <>
              <circle cx={r.pinch.x} cy={r.pinch.y} r={3} />
              <text x={r.pinch.x} y={r.pinch.y - 6} className="pinch-label">
                {formatLength(r.width, units)}
              </text>
            </>
          )}
        </g>
      ))}

      {sel && !readOnly && (
        <g className="rotate-handle" onPointerDown={(e) => startRotate(e, sel)}>
          {(() => {
            const back = sel.toWorld({ x: sel.item.width / 2, y: 0 });
            const handle = sel.toWorld({ x: sel.item.width / 2, y: -14 });
            return (
              <>
                <line x1={back.x} y1={back.y} x2={handle.x} y2={handle.y} />
                <circle cx={handle.x} cy={handle.y} r={5} aria-label="Rotate" />
              </>
            );
          })()}
        </g>
      )}
    </svg>
  );
}

/** Label position: the middle of the main body (not the L's bounding box). */
function labelAt(p: PlacedItem) {
  const c = p.toWorld({ x: p.item.width / 2, y: p.item.depth / 2 });
  return { x: c.x, y: c.y };
}

/** SVG arc sweep flag so the swing curves from the closed position to the open one. */
function arcSweep(o: { arc: { hinge: Point; closedTip: Point } | null; inward: Point }): 0 | 1 {
  const a = o.arc!;
  const toClosed = { x: a.closedTip.x - a.hinge.x, y: a.closedTip.y - a.hinge.y };
  // Cross product sign: is the inward direction clockwise from the closed leaf?
  return toClosed.x * o.inward.y - toClosed.y * o.inward.x > 0 ? 1 : 0;
}
