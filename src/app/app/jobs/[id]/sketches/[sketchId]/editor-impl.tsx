"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Stage,
  Layer,
  Line,
  Circle,
  Text,
  Group,
} from "react-konva";
import type Konva from "konva";
import { saveScene, renameSketch } from "../actions";
import {
  DEFAULT_DOOR_WIDTH_IN,
  DEFAULT_GRID_INCHES,
  DEFAULT_WINDOW_HEIGHT_IN,
  DEFAULT_WINDOW_SILL_IN,
  DEFAULT_WINDOW_WIDTH_IN,
  SNAP_PIXELS,
  type Door,
  type Floor,
  type Label as LabelEntity,
  type SketchScene,
  type Wall,
  type Window as WindowEntity,
} from "@/lib/business/sketch/types";
import {
  polygonForWalls,
  snapToEndpoint,
  snapToGrid,
  wallAngleRadians,
  wallLengthPx,
} from "@/lib/business/sketch/geometry";
import { newScene, normaliseAndRecompute, randomId } from "@/lib/business/sketch/scene";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Tool =
  | "select"
  | "wall"
  | "door"
  | "window"
  | "label"
  | "dimension"
  | "eraser";

const TOOLS: Array<{ id: Tool; label: string; hint: string }> = [
  { id: "select", label: "Select", hint: "Pan, click items" },
  { id: "wall", label: "Wall", hint: "Click to place vertices · double-click to close into a room" },
  { id: "door", label: "Door", hint: "Click on a wall to add a door" },
  { id: "window", label: "Window", hint: "Click on a wall to add a window" },
  { id: "label", label: "Label", hint: "Click to place a text label" },
  { id: "dimension", label: "Dim", hint: "Click two points to draw a dimension" },
  { id: "eraser", label: "Erase", hint: "Click an item to delete it" },
];

const STAGE_W = 1200;
const STAGE_H = 720;
const AUTOSAVE_MS = 5000;

interface Props {
  sketchId: string;
  initialScene: SketchScene;
  canEdit: boolean;
}

export default function SketchEditorImpl({
  sketchId,
  initialScene,
  canEdit,
}: Props) {
  const [scene, setScene] = useState<SketchScene>(initialScene);
  const [tool, setTool] = useState<Tool>("select");
  const [name, setName] = useState<string>("");
  const [draftWall, setDraftWall] = useState<number[]>([]);
  const [pendingDimFrom, setPendingDimFrom] = useState<{ x: number; y: number } | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pending, setPending] = useState(false);
  const [tooNarrow, setTooNarrow] = useState(false);

  const [dirty, setDirty] = useState(false);

  // Phone read-only detection (PRD §8.3 v1: drawing on phone is too painful).
  useEffect(() => {
    const check = () => setTooNarrow(window.innerWidth < 720);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const activeFloor = useMemo<Floor>(
    () =>
      scene.floors.find((f) => f.id === scene.activeFloorId) ?? scene.floors[0],
    [scene],
  );
  const pxPerFt = scene.scale.pixelsPerFoot;
  const gridPx = (DEFAULT_GRID_INCHES / 12) * pxPerFt;

  const updateFloor = useCallback(
    (mut: (f: Floor) => Floor) => {
      setScene((prev) => {
        const next = {
          ...prev,
          floors: prev.floors.map((f) =>
            f.id === prev.activeFloorId ? mut(f) : f,
          ),
        };
        return normaliseAndRecompute(next);
      });
      setDirty(true);
    },
    [],
  );

  // ---------- autosave ------------------------------------------------------
  const saveNow = useCallback(async () => {
    if (!canEdit) return;
    if (!dirty) return;
    setPending(true);
    setError(null);
    try {
      const r = await saveScene({ sketchId, scene });
      setDirty(false);
      setSavedAt(new Date());
      setScene((s) => ({ ...s })); // trigger re-render so version label updates next save cycle
      void r;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }, [canEdit, scene, sketchId, dirty]);

  // 5-second debounced autosave
  useEffect(() => {
    if (!canEdit) return;
    const t = setTimeout(() => {
      void saveNow();
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [scene, canEdit, saveNow]);

  // Save on tab close / refresh
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Save on ⌘S / Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void saveNow();
      }
      if (e.key === "Escape") {
        setDraftWall([]);
        setPendingDimFrom(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveNow]);

  // ---------- helpers -------------------------------------------------------
  const getStagePoint = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return null;
    return pos;
  };

  const snapPoint = useCallback(
    (raw: { x: number; y: number }) => {
      const ep = snapToEndpoint(raw, activeFloor.walls, SNAP_PIXELS);
      if (ep) return ep;
      return snapToGrid(raw, gridPx);
    },
    [activeFloor.walls, gridPx],
  );

  // ---------- pointer events -----------------------------------------------
  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!canEdit) return;
    const raw = getStagePoint(e);
    if (!raw) return;
    const p = snapPoint(raw);

    if (tool === "wall") {
      setDraftWall((prev) => {
        const next = [...prev, p.x, p.y];
        // Commit each new segment as a Wall as soon as we have 2 endpoints
        if (next.length === 4) {
          updateFloor((f) => ({
            ...f,
            walls: [
              ...f.walls,
              {
                id: randomId(),
                points: [next[0], next[1], next[2], next[3]],
                thickness: 4,
              },
            ],
          }));
          // Continue from the just-placed endpoint
          return [next[2], next[3]];
        }
        return next;
      });
    } else if (tool === "label") {
      const text = window.prompt("Label text:");
      if (!text) return;
      updateFloor((f) => ({
        ...f,
        labels: [
          ...f.labels,
          { id: randomId(), x: p.x, y: p.y, text, fontSize: 12 },
        ],
      }));
    } else if (tool === "dimension") {
      if (!pendingDimFrom) {
        setPendingDimFrom(p);
      } else {
        updateFloor((f) => ({
          ...f,
          dimensions: [
            ...f.dimensions,
            {
              id: randomId(),
              from: [pendingDimFrom.x, pendingDimFrom.y],
              to: [p.x, p.y],
              offset: 24,
            },
          ],
        }));
        setPendingDimFrom(null);
      }
    }
  };

  const handleStageDoubleClick = () => {
    if (tool !== "wall") return;
    if (draftWall.length < 4) {
      setDraftWall([]);
      return;
    }
    // Close the polyline into a Room — collect every wall whose endpoints
    // touch the polyline path.
    const targetX = draftWall[0];
    const targetY = draftWall[1];
    const lastX = draftWall[draftWall.length - 2];
    const lastY = draftWall[draftWall.length - 1];

    let closingWall: Wall | null = null;
    if (Math.hypot(lastX - targetX, lastY - targetY) > 1) {
      // Drop a closing wall back to the start
      closingWall = {
        id: randomId(),
        points: [lastX, lastY, targetX, targetY],
        thickness: 4,
      };
    }

    updateFloor((f) => {
      const walls = closingWall ? [...f.walls, closingWall] : f.walls;
      const polyClosingId = closingWall?.id;
      // Collect the most recent run of walls that participate in this polyline.
      // Heuristic: walk backwards from the end and collect contiguous walls
      // whose endpoints chain back to (targetX, targetY).
      const pathIds: string[] = [];
      let curX = lastX;
      let curY = lastY;
      const remaining = [...walls].reverse();
      // Keep grabbing the most recent wall that ends/starts at (curX, curY).
      while (remaining.length > 0) {
        const next = remaining.shift()!;
        const [x1, y1, x2, y2] = next.points;
        if (Math.abs(x2 - curX) < 1 && Math.abs(y2 - curY) < 1) {
          pathIds.unshift(next.id);
          curX = x1;
          curY = y1;
        } else if (Math.abs(x1 - curX) < 1 && Math.abs(y1 - curY) < 1) {
          pathIds.unshift(next.id);
          curX = x2;
          curY = y2;
        } else if (
          polyClosingId &&
          next.id === polyClosingId &&
          (Math.abs(x1 - curX) < 1 || Math.abs(x2 - curX) < 1)
        ) {
          pathIds.unshift(next.id);
        } else {
          // Stop walking — chain broken
          break;
        }
        if (Math.abs(curX - targetX) < 1 && Math.abs(curY - targetY) < 1) break;
      }
      const room = {
        id: randomId(),
        name: window.prompt("Room name:", "Room") || "Room",
        wallIds: pathIds,
        ceilingHeightFt: 8,
      };
      return { ...f, walls, rooms: [...f.rooms, room] };
    });
    setDraftWall([]);
  };

  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!canEdit) return;
    if (tool !== "wall" && tool !== "dimension") {
      setHoverPoint(null);
      return;
    }
    const raw = getStagePoint(e);
    if (!raw) return;
    setHoverPoint(snapPoint(raw));
  };

  const handleWallClick = (w: Wall, e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!canEdit) return;
    e.cancelBubble = true;
    if (tool === "door") {
      const raw = getStagePoint(e);
      if (!raw) return;
      const t = projectOntoWall(w, raw);
      const door: Door = {
        id: randomId(),
        wallId: w.id,
        positionAlongWall: t,
        widthIn: DEFAULT_DOOR_WIDTH_IN,
        swing: "left",
      };
      updateFloor((f) => ({ ...f, doors: [...f.doors, door] }));
    } else if (tool === "window") {
      const raw = getStagePoint(e);
      if (!raw) return;
      const t = projectOntoWall(w, raw);
      const win: WindowEntity = {
        id: randomId(),
        wallId: w.id,
        positionAlongWall: t,
        widthIn: DEFAULT_WINDOW_WIDTH_IN,
        heightIn: DEFAULT_WINDOW_HEIGHT_IN,
        sillHeightIn: DEFAULT_WINDOW_SILL_IN,
      };
      updateFloor((f) => ({ ...f, windows: [...f.windows, win] }));
    } else if (tool === "eraser") {
      updateFloor((f) => ({
        ...f,
        walls: f.walls.filter((x) => x.id !== w.id),
        rooms: f.rooms
          .map((r) => ({ ...r, wallIds: r.wallIds.filter((id) => id !== w.id) }))
          .filter((r) => r.wallIds.length > 0),
        doors: f.doors.filter((d) => d.wallId !== w.id),
        windows: f.windows.filter((win) => win.wallId !== w.id),
      }));
    }
  };

  const handleEntityClick = (
    kind: "door" | "window" | "label",
    id: string,
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => {
    if (!canEdit) return;
    e.cancelBubble = true;
    if (tool === "eraser") {
      updateFloor((f) => ({
        ...f,
        doors: kind === "door" ? f.doors.filter((d) => d.id !== id) : f.doors,
        windows:
          kind === "window" ? f.windows.filter((d) => d.id !== id) : f.windows,
        labels:
          kind === "label" ? f.labels.filter((l) => l.id !== id) : f.labels,
      }));
    }
  };

  // ---------- multi-floor controls -----------------------------------------
  const addFloor = () => {
    const id = randomId();
    setScene((s) => ({
      ...s,
      activeFloorId: id,
      floors: [
        ...s.floors,
        {
          id,
          name: `Floor ${s.floors.length + 1}`,
          walls: [],
          rooms: [],
          doors: [],
          windows: [],
          labels: [],
          dimensions: [],
        },
      ],
    }));
    setDirty(true);
  };

  const renameFloor = (floorId: string) => {
    const next = window.prompt(
      "Floor name:",
      scene.floors.find((f) => f.id === floorId)?.name ?? "",
    );
    if (!next) return;
    setScene((s) => ({
      ...s,
      floors: s.floors.map((f) => (f.id === floorId ? { ...f, name: next } : f)),
    }));
    setDirty(true);
  };

  const removeFloor = (floorId: string) => {
    if (scene.floors.length === 1) return;
    if (!window.confirm("Delete this floor and everything on it?")) return;
    setScene((s) => {
      const next = s.floors.filter((f) => f.id !== floorId);
      return {
        ...s,
        floors: next,
        activeFloorId:
          s.activeFloorId === floorId ? next[0]?.id : s.activeFloorId,
      };
    });
    setDirty(true);
  };

  const resetScene = () => {
    if (!window.confirm("Discard everything and start over?")) return;
    setScene(newScene());
    setDirty(true);
  };

  // ---------- rename --------------------------------------------------------
  const submitRename = async () => {
    if (!name.trim() || !canEdit) return;
    try {
      await renameSketch({ sketchId, name: name.trim() });
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    }
  };

  if (tooNarrow) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        Sketching needs a tablet or wider screen — drawing precise floor plans
        on a phone is too painful. Open this page on a desktop or tablet.
        Existing sketches are still readable below:
        <FloorThumbnails scene={scene} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!canEdit && t.id !== "select"}
            onClick={() => {
              setTool(t.id);
              setDraftWall([]);
              setPendingDimFrom(null);
            }}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              tool === t.id
                ? "bg-primary text-primary-foreground"
                : "border border-input bg-background hover:bg-accent"
            } disabled:opacity-50`}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-2 text-[11px] text-muted-foreground">
          {TOOLS.find((t) => t.id === tool)?.hint}
        </span>

        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {pending ? (
            <span>saving…</span>
          ) : savedAt ? (
            <span>saved {savedAt.toLocaleTimeString()}</span>
          ) : (
            <span className="opacity-60">no changes</span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={saveNow}
            disabled={!canEdit || pending || !dirty}
          >
            Save
          </Button>
        </span>
      </div>

      {/* Floor tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background p-1 text-xs">
        {scene.floors.map((f) => (
          <div key={f.id} className="flex items-center">
            <button
              type="button"
              onClick={() =>
                setScene((s) => ({ ...s, activeFloorId: f.id }))
              }
              className={`rounded-md px-2 py-1 ${
                scene.activeFloorId === f.id
                  ? "bg-primary/10 font-medium text-primary"
                  : "hover:bg-accent"
              }`}
            >
              {f.name}
            </button>
            {canEdit ? (
              <button
                type="button"
                onClick={() => renameFloor(f.id)}
                className="px-1 text-muted-foreground hover:text-foreground"
                title="Rename"
              >
                ✏︎
              </button>
            ) : null}
            {canEdit && scene.floors.length > 1 ? (
              <button
                type="button"
                onClick={() => removeFloor(f.id)}
                className="px-1 text-muted-foreground hover:text-destructive"
                title="Delete floor"
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={addFloor}
            className="ml-1 h-6"
          >
            + Floor
          </Button>
        ) : null}

        <span className="ml-auto flex items-center gap-2">
          <Input
            placeholder="Rename sketch…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 w-44 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canEdit || !name.trim()}
            onClick={submitRename}
          >
            Rename
          </Button>
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={resetScene}
              title="Wipe and start over"
            >
              Reset
            </Button>
          ) : null}
        </span>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Stage */}
      <div className="overflow-hidden rounded-md border bg-white">
        <Stage
          width={STAGE_W}
          height={STAGE_H}
          onClick={handleStageClick}
          onTap={handleStageClick}
          onDblClick={handleStageDoubleClick}
          onDblTap={handleStageDoubleClick}
          onMouseMove={handleStageMouseMove}
          style={{ touchAction: "none" }}
        >
          {/* Grid layer (dot grid every 6") */}
          <Layer listening={false}>
            {gridDots(STAGE_W, STAGE_H, gridPx)}
          </Layer>

          {/* Content layer */}
          <Layer>
            {/* Room polygon fills */}
            {activeFloor.rooms.map((room) => {
              const poly = polygonForWalls(room.wallIds, activeFloor.walls);
              if (!poly || poly.length < 3) return null;
              const flat: number[] = [];
              for (const p of poly) flat.push(p.x, p.y);
              return (
                <Line
                  key={`fill-${room.id}`}
                  points={flat}
                  closed
                  fill="rgba(30, 58, 138, 0.06)"
                  listening={false}
                />
              );
            })}

            {/* Walls + length labels */}
            {activeFloor.walls.map((w) => (
              <WallShape
                key={w.id}
                wall={w}
                onClick={(e) => handleWallClick(w, e)}
                pxPerFt={pxPerFt}
              />
            ))}

            {/* Doors */}
            {activeFloor.doors.map((d) => {
              const wall = activeFloor.walls.find((w) => w.id === d.wallId);
              if (!wall) return null;
              return (
                <DoorShape
                  key={d.id}
                  door={d}
                  wall={wall}
                  pxPerFt={pxPerFt}
                  onClick={(e) => handleEntityClick("door", d.id, e)}
                />
              );
            })}

            {/* Windows */}
            {activeFloor.windows.map((win) => {
              const wall = activeFloor.walls.find((w) => w.id === win.wallId);
              if (!wall) return null;
              return (
                <WindowShape
                  key={win.id}
                  window={win}
                  wall={wall}
                  pxPerFt={pxPerFt}
                  onClick={(e) => handleEntityClick("window", win.id, e)}
                />
              );
            })}

            {/* Labels */}
            {activeFloor.labels.map((l) => (
              <Text
                key={l.id}
                x={l.x}
                y={l.y}
                text={l.text}
                fontSize={l.fontSize}
                fill="#0f172a"
                onClick={(e) => handleEntityClick("label", l.id, e)}
                onTap={(e) => handleEntityClick("label", l.id, e)}
              />
            ))}

            {/* Room labels */}
            {activeFloor.rooms.map((room) => {
              const c = room.cachedCentroid;
              if (!c) return null;
              return (
                <Group key={`label-${room.id}`} listening={false}>
                  <Text
                    x={c.x - 60}
                    y={c.y - 14}
                    width={120}
                    align="center"
                    text={room.name || "Room"}
                    fontSize={12}
                    fontStyle="bold"
                    fill="#1e293b"
                  />
                  {room.cachedSqFt ? (
                    <Text
                      x={c.x - 60}
                      y={c.y}
                      width={120}
                      align="center"
                      text={`${room.cachedSqFt.toFixed(0)} sq ft · ${room.cachedLinearFt?.toFixed(0) ?? "?"} lf`}
                      fontSize={10}
                      fill="#475569"
                    />
                  ) : null}
                </Group>
              );
            })}

            {/* Dimensions */}
            {activeFloor.dimensions.map((dim) => (
              <DimensionShape
                key={dim.id}
                dim={dim}
                pxPerFt={pxPerFt}
                onClick={(e) => {
                  if (!canEdit || tool !== "eraser") return;
                  e.cancelBubble = true;
                  updateFloor((f) => ({
                    ...f,
                    dimensions: f.dimensions.filter((x) => x.id !== dim.id),
                  }));
                }}
              />
            ))}

            {/* Draft wall (in-progress polyline) */}
            {draftWall.length >= 2 && hoverPoint ? (
              <Line
                points={[...draftWall, hoverPoint.x, hoverPoint.y]}
                stroke="#1e3a8a"
                strokeWidth={2}
                dash={[6, 4]}
                listening={false}
              />
            ) : null}

            {/* Snap indicator */}
            {hoverPoint && (tool === "wall" || tool === "dimension") ? (
              <Circle
                x={hoverPoint.x}
                y={hoverPoint.y}
                radius={4}
                fill="#1e3a8a"
                listening={false}
              />
            ) : null}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function gridDots(w: number, h: number, step: number) {
  if (step <= 0) return null;
  const out = [];
  for (let x = 0; x < w; x += step) {
    for (let y = 0; y < h; y += step) {
      out.push(
        <Circle
          key={`g-${x}-${y}`}
          x={x}
          y={y}
          radius={1.2}
          fill="#cbd5e1"
        />,
      );
    }
  }
  return out;
}

function WallShape({
  wall,
  onClick,
  pxPerFt,
}: {
  wall: Wall;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  pxPerFt: number;
}) {
  const lenFt = wallLengthPx(wall) / pxPerFt;
  const [x1, y1, x2, y2] = wall.points;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return (
    <Group>
      <Line
        points={[x1, y1, x2, y2]}
        stroke="#0f172a"
        strokeWidth={Math.max(2, wall.thickness)}
        lineCap="round"
        lineJoin="round"
        onClick={onClick}
        onTap={onClick as unknown as (e: Konva.KonvaEventObject<TouchEvent>) => void}
      />
      {lenFt >= 0.5 ? (
        <Text
          x={cx - 30}
          y={cy - 16}
          width={60}
          align="center"
          text={fmtFeetInches(lenFt)}
          fontSize={10}
          fill="#475569"
          listening={false}
        />
      ) : null}
    </Group>
  );
}

function DoorShape({
  door,
  wall,
  pxPerFt,
  onClick,
}: {
  door: Door;
  wall: Wall;
  pxPerFt: number;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
}) {
  const [x1, y1, x2, y2] = wall.points;
  const cx = x1 + (x2 - x1) * door.positionAlongWall;
  const cy = y1 + (y2 - y1) * door.positionAlongWall;
  const angle = wallAngleRadians(wall);
  const widthPx = (door.widthIn / 12) * pxPerFt;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const ax = cx - (dx * widthPx) / 2;
  const ay = cy - (dy * widthPx) / 2;
  const bx = cx + (dx * widthPx) / 2;
  const by = cy + (dy * widthPx) / 2;
  return (
    <Group onClick={onClick} onTap={onClick as unknown as (e: Konva.KonvaEventObject<TouchEvent>) => void}>
      {/* Erase wall under the door */}
      <Line
        points={[ax, ay, bx, by]}
        stroke="#ffffff"
        strokeWidth={Math.max(2, wall.thickness) + 2}
      />
      {/* Door jamb */}
      <Line points={[ax, ay, bx, by]} stroke="#0f172a" strokeWidth={1.5} />
    </Group>
  );
}

function WindowShape({
  window: win,
  wall,
  pxPerFt,
  onClick,
}: {
  window: WindowEntity;
  wall: Wall;
  pxPerFt: number;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
}) {
  const [x1, y1, x2, y2] = wall.points;
  const cx = x1 + (x2 - x1) * win.positionAlongWall;
  const cy = y1 + (y2 - y1) * win.positionAlongWall;
  const angle = wallAngleRadians(wall);
  const widthPx = (win.widthIn / 12) * pxPerFt;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const ax = cx - (dx * widthPx) / 2;
  const ay = cy - (dy * widthPx) / 2;
  const bx = cx + (dx * widthPx) / 2;
  const by = cy + (dy * widthPx) / 2;
  const nx = -dy;
  const ny = dx;
  const off = wall.thickness * 0.6;
  return (
    <Group onClick={onClick} onTap={onClick as unknown as (e: Konva.KonvaEventObject<TouchEvent>) => void}>
      <Line
        points={[ax, ay, bx, by]}
        stroke="#ffffff"
        strokeWidth={Math.max(2, wall.thickness) + 2}
      />
      <Line
        points={[ax + nx * off, ay + ny * off, bx + nx * off, by + ny * off]}
        stroke="#0f172a"
        strokeWidth={1}
      />
      <Line
        points={[ax - nx * off, ay - ny * off, bx - nx * off, by - ny * off]}
        stroke="#0f172a"
        strokeWidth={1}
      />
    </Group>
  );
}

function DimensionShape({
  dim,
  pxPerFt,
  onClick,
}: {
  dim: { from: [number, number]; to: [number, number]; offset: number };
  pxPerFt: number;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
}) {
  const [x1, y1] = dim.from;
  const [x2, y2] = dim.to;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const nx = -dy / len;
  const ny = dx / len;
  const off = dim.offset;
  const ox1 = x1 + nx * off;
  const oy1 = y1 + ny * off;
  const ox2 = x2 + nx * off;
  const oy2 = y2 + ny * off;
  const lf = len / pxPerFt;
  const cx = (ox1 + ox2) / 2;
  const cy = (oy1 + oy2) / 2;
  return (
    <Group onClick={onClick} onTap={onClick as unknown as (e: Konva.KonvaEventObject<TouchEvent>) => void}>
      <Line points={[x1, y1, ox1, oy1]} stroke="#475569" strokeWidth={0.8} />
      <Line points={[x2, y2, ox2, oy2]} stroke="#475569" strokeWidth={0.8} />
      <Line points={[ox1, oy1, ox2, oy2]} stroke="#475569" strokeWidth={1.2} />
      <Text
        x={cx - 30}
        y={cy - 14}
        width={60}
        align="center"
        text={fmtFeetInches(lf)}
        fontSize={10}
        fill="#0f172a"
      />
    </Group>
  );
}

function FloorThumbnails({ scene }: { scene: SketchScene }) {
  return (
    <ul className="mt-3 space-y-1 text-xs">
      {scene.floors.map((f) => (
        <li key={f.id}>
          <strong>{f.name}</strong> — {f.rooms.length} rooms, {f.walls.length} walls
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function projectOntoWall(
  w: Wall,
  p: { x: number; y: number },
): number {
  const [x1, y1, x2, y2] = w.points;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  const t = ((p.x - x1) * dx + (p.y - y1) * dy) / len2;
  if (t < 0.05) return 0.05;
  if (t > 0.95) return 0.95;
  return t;
}

function fmtFeetInches(lengthFt: number): string {
  const totalIn = Math.round(lengthFt * 12);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn % 12;
  if (inch === 0) return `${ft}'`;
  return `${ft}' ${inch}"`;
}

// avoid unused-import warning for type-only consumer
void ({} as LabelEntity);
