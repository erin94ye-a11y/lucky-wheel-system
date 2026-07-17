# Prize Wheel Single-Template Redesign

## Goal

Delete the current inner-wheel and outer-wheel visual implementations and rebuild the prize wheel from one shared sector template. The rebuilt wheel must keep the existing draw behavior, prize data, probability behavior, result display, and H5 layout while eliminating every duplicated visual layer that can drift out of alignment.

## Approved Direction

The user selected option B: remove the current wheel visuals completely and rebuild them from scratch.

The new wheel will preserve the functional prize labels and central spin control because they are required to understand and operate the draw, but neither will reuse the old positioning or decorative implementation.

## Visual Structure

1. A single rotating wheel surface owns all prize colors.
2. Every prize sector extends from the center control clearance to the outer edge.
3. One boundary is generated for each sector edge using the same angle that generates the sector.
4. The outer rim is a neutral event-wheel frame, not a second colored wheel.
5. Prize labels are rebuilt and centered on the radial centerline of their sector.
6. The pointer and central control remain fixed above the rotating surface.
7. The result panel and all content outside the wheel remain unchanged.

## Rendering Architecture

`renderWheel(prizes)` will create one rotor layer from the active prize array. The rotor will contain:

- one dynamic sector surface;
- one set of sector boundary lines;
- one set of prize labels and optional prize images.

Sector fill, boundary angle, label angle, and winning rotation will all derive from the same values:

- `slice = 360 / prizeCount`;
- `startAngle = index * slice - 90`;
- `centerAngle = startAngle + slice / 2`;
- `endAngle = startAngle + slice`.

The old `.wheel-backplate`, `.wheel-board-boundary`, and `.wheel-sector-boundary` layers will be removed. The old inner background will also be removed instead of hidden under the new surface.

## Rotation And Draw Accuracy

The full rotor, including sectors, boundaries, labels, and images, will rotate as one unit. The fixed pointer will continue to indicate the selected prize. The existing server-selected prize and `getSpinRotation()` result remain authoritative; this redesign does not change prize probability or winner selection.

## Responsive Behavior

- Target viewport: 390 x 844 H5.
- The wheel must remain fully visible without horizontal scrolling.
- Labels must remain inside their prize sectors and use dynamic size and wrapping for nine prizes.
- The central control must not overlap prize labels.
- The desktop layout must retain the same visual proportions without enlarging the H5-first wheel beyond its current maximum width.

## Accessibility And Interaction

- Keep the existing button semantics and disabled states.
- Preserve the fixed pointer as decorative content.
- Keep prize names as visible text rather than baking them into a bitmap.
- Preserve keyboard and touch operation of the central spin control.

## Verification

1. Add an automated regression check that the old wheel layers are no longer generated and that the new unified rotor is present.
2. Run the complete Node test suite.
3. Verify the public page in the in-app browser at 390 x 844 and a desktop viewport.
4. Confirm one code-entry and spin interaction still updates the wheel and result state.
5. Confirm no console errors, framework overlay, clipping, overlap, or horizontal overflow.
6. Compare the rebuilt wheel against the supplied screenshot and record the Product Design QA result in `design-qa.md`.

## Out Of Scope

- No backend, probability, prize-pool, code-generation, authentication, logging, or admin changes.
- No changes to the header, entry form, result panel, or vision content.
- No GitHub upload or deployment in this iteration.
