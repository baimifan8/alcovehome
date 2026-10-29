# Golden test cases

Known layouts with known correct verdicts. They were written by hand, before the fit engine, and are the Phase 1 gate: **all golden cases pass**. If a case and the engine disagree, the engine is wrong unless the case is shown to be wrong. A case is only changed in a commit that explains why.

Each file in `cases/` is one layout. `golden.test.ts` builds the room and items and checks that every item gets exactly the expected result and reason codes.

## Conventions

- Inches throughout. Plan origin is the room's top-left corner, x to the right, y downward.
- `room.width` × `room.length` makes a rectangle whose walls are, in order, `top`, `right`, `bottom`, `left`. `room.outline` gives any other polygon, clockwise on screen.
- Openings use the model's own terms: `offset` is measured from the wall's **start** vertex, walking clockwise. Top runs left→right, right runs top→bottom, bottom runs **right→left**, left runs **bottom→top**. `hinge` is seen from inside the room facing the wall; left = the start side.
  - The shared entry door (`wall: bottom, offset: 106, width: 32, hinge: right`) spans x = 6…38 on the bottom wall, hinged at x = 6, swinging into the room.
- Items: `x`, `y` = center of the bounding box. `rotation` is in degrees, clockwise on screen. At 0 the item's back faces the top of the plan and its front faces down.
- L footprints: `width` × `depth` is the main body. The return (`returnWidth` wide) extends the depth to `returnDepth` on the given side.
- Defaults: `confirmed: true`, `operation: swing`, `swing: in`, `hinge: left`; every wall is `labeled` unless `wallSources` says otherwise.
- `expect.codes` must match the item's reason codes exactly. `fits` means no reasons. `approximate` is checked only when given.

## Reason codes

| Code | Tier | Meaning |
| --- | --- | --- |
| `outside-room` | 0 | Footprint entirely outside the room |
| `wall` | 0 | Footprint crosses a wall |
| `item-overlap` | 0 | Footprint overlaps another item |
| `door` | 0 | Inside a door's swing arc or the strip in front of a doorway |
| `closet-door` | 0 | Same, for a closet door |
| `use-zone` | 1 | A use zone (chair pull-out, drawers, bed side access…) is cut by an item or wall |
| `walkway` | 2 | Item narrows the walkway from the entry below the minimum |
