# Stair Design

RCC stair design (IS 456), drawn on a DXF/PDF underlay with stories, elevation and 3D views. The drawing canvas is taken from ETABS Model Creator, without its ETABS link. The old single-file app is in `legacy/index.html`.

## Run

```bash
npm --prefix web install
npm --prefix web run dev      # http://localhost:5174
```

## Workflow

1. **File → Load underlay…**: a DXF or PDF, as in ETABS Model Creator. Use **Define story region** for each plan.
2. **Draw → Stories…**: the bottom story and the top story. **Reference planes…**: one per landing level.
3. Draw grids and columns in the **Plan** view.
4. Switch to **Elev + 3D**. Pick a grid and use the tools in the elevation bar:
   - **Flight**: click the bottom of the flight, then its top. The risers are fitted to the rise and the treads to the going. **Side** and **Offset** set where the flight sits in plan, relative to the grid.
   - **Landing**: click its two ends at its level, such as on a reference plane.
   - **Beam**: click points along the grid. Each click adds a piece, level or sloped, so a cranked beam is drawn as one chain. Right-click ends the chain.
   Points snap to levels, reference planes, grids, column faces, flight and landing corners, and beam ends.
5. Spans follow the flights automatically. You can also draw them by hand in the plan (**Span**), or use **Stair → Auto spans**.
6. **Stair → Results (IS 456)…** shows the slab design and the line loads on the beams. From there you can download the CSV or print the report.

You can also draw flights, landings and spans in the plan (**Flight**, **Landing** and **Span** in the toolbar). **Stair → Template** adds a ready-made stair.
