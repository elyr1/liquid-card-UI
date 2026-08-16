"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createLiquidPath, type LiquidShape } from "./liquid-engine";

const STAGE_WIDTH = 860;
const STAGE_HEIGHT = 500;

const INITIAL_SHAPES: LiquidShape[] = [
  { id: "player", x: 92, y: 142, width: 340, height: 190, radius: 52 },
  { id: "note", x: 470, y: 202, width: 244, height: 148, radius: 48 },
];

const REMIXES: LiquidShape[][] = [
  [
    { id: "player", x: 128, y: 222, width: 352, height: 174, radius: 54 },
    { id: "note", x: 495, y: 104, width: 248, height: 166, radius: 58 },
  ],
  [
    { id: "player", x: 166, y: 84, width: 340, height: 194, radius: 58 },
    { id: "note", x: 397, y: 300, width: 252, height: 132, radius: 46 },
  ],
  [
    { id: "player", x: 382, y: 150, width: 354, height: 190, radius: 64 },
    { id: "note", x: 108, y: 190, width: 248, height: 148, radius: 44 },
  ],
];

type DragState = {
  id: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
};

type ContentLayout = {
  width: number;
  align: "left" | "right";
  pressure: number;
  timelineWidth: number;
  lyricsSize: number;
};

const CONTENT_CLEARANCE = 22;
// Kept intentionally tight: content should only react once the protected
// zones are truly about to clash, not drift/anticipate from a distance.
const PROXIMITY_RAMP = 20;

const cloneShapes = (shapes: LiquidShape[]) => shapes.map((shape) => ({ ...shape }));

const clampShape = (shape: LiquidShape): LiquidShape => ({
  ...shape,
  x: Math.max(22, Math.min(STAGE_WIDTH - shape.width - 22, shape.x)),
  y: Math.max(24, Math.min(STAGE_HEIGHT - shape.height - 24, shape.y)),
});

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (value: number) => value * value * (3 - 2 * value);
const lerp = (start: number, end: number, amount: number) => start + (end - start) * amount;

function contentLayouts(player: LiquidShape, note: LiquidShape): Record<string, ContentLayout> {
  const playerBounds = {
    left: player.x + 27,
    top: player.y + 24,
    right: player.x + player.width - 27,
    bottom: player.y + player.height - 22,
  };
  const noteBounds = {
    left: note.x + 24,
    top: note.y + 25,
    right: note.x + note.width - 24,
    bottom: note.y + note.height - 24,
  };
  const overlapX = Math.min(playerBounds.right, noteBounds.right) - Math.max(playerBounds.left, noteBounds.left);
  const overlapY = Math.min(playerBounds.bottom, noteBounds.bottom) - Math.max(playerBounds.top, noteBounds.top);

  // A continuous 0..1 measure of how close the two protected zones are, ramping
  // gently over PROXIMITY_RAMP px so nothing ever snaps at a hard threshold.
  const proximity = Math.min(overlapX, overlapY);
  const pressure = smoothstep(clamp01((proximity + PROXIMITY_RAMP) / PROXIMITY_RAMP));

  const playerIsLeft = player.x + player.width / 2 <= note.x + note.width / 2;
  const horizontalSpan = playerIsLeft
    ? noteBounds.right - playerBounds.left
    : playerBounds.right - noteBounds.left;
  const playerWidth = playerBounds.right - playerBounds.left;
  const noteWidth = noteBounds.right - noteBounds.left;
  const availableWidth = Math.max(188, horizontalSpan - CONTENT_CLEARANCE);
  const engagedPlayerWidth = Math.min(playerWidth, Math.max(76, availableWidth * 0.42));
  const engagedNoteWidth = Math.min(noteWidth, Math.max(112, availableWidth - engagedPlayerWidth));

  const playerWidthNow = lerp(playerWidth, engagedPlayerWidth, pressure);
  const noteWidthNow = lerp(noteWidth, engagedNoteWidth, pressure);
  const playerTimelineFull = playerWidth * 0.86;
  const playerTimelineEngaged = engagedPlayerWidth * 0.64;

  return {
    player: {
      width: playerWidthNow,
      align: playerIsLeft ? "left" : "right",
      pressure,
      timelineWidth: Math.max(46, lerp(playerTimelineFull, playerTimelineEngaged, pressure)),
      lyricsSize: 15,
    },
    note: {
      width: noteWidthNow,
      align: playerIsLeft ? "right" : "left",
      pressure,
      timelineWidth: 0,
      lyricsSize: lerp(15, 17, pressure),
    },
  };
}

export default function Home() {
  const [shapes, setShapes] = useState<LiquidShape[]>(() => cloneShapes(INITIAL_SHAPES));
  const [blend, setBlend] = useState(112);
  const [detail, setDetail] = useState(7);
  const [scale, setScale] = useState(1);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isRemixing, setIsRemixing] = useState(false);
  const [remixIndex, setRemixIndex] = useState(0);

  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const measure = () => setScale(Math.min(1, shell.clientWidth / STAGE_WIDTH));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    },
    [],
  );

  const liquidPath = useMemo(
    () => createLiquidPath(shapes, STAGE_WIDTH, STAGE_HEIGHT, detail, blend),
    [shapes, detail, blend],
  );

  const getLocalPoint = (clientX: number, clientY: number) => {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (isRemixing) return;
    const shape = shapes.find((item) => item.id === id);
    if (!shape) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getLocalPoint(event.clientX, event.clientY);
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      offsetX: point.x - shape.x,
      offsetY: point.y - shape.y,
    };
    setActiveId(id);
  };

  const continueDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const point = getLocalPoint(event.clientX, event.clientY);
    setShapes((current) =>
      current.map((shape) =>
        shape.id === drag.id
          ? clampShape({
              ...shape,
              x: point.x - drag.offsetX,
              y: point.y - drag.offsetY,
            })
          : shape,
      ),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setActiveId(null);
  };

  const moveWithKeyboard = (event: ReactKeyboardEvent<HTMLElement>, id: string) => {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return;

    event.preventDefault();
    const amount = event.shiftKey ? 24 : 8;
    setShapes((current) =>
      current.map((shape) =>
        shape.id === id
          ? clampShape({
              ...shape,
              x: shape.x + direction[0] * amount,
              y: shape.y + direction[1] * amount,
            })
          : shape,
      ),
    );
  };

  const animateTo = (target: LiquidShape[]) => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShapes(cloneShapes(target));
      setIsRemixing(false);
      return;
    }

    const start = cloneShapes(shapes);
    const startedAt = performance.now();
    setIsRemixing(true);
    setActiveId(null);
    dragRef.current = null;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 720);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShapes(
        target.map((endShape) => {
          const startShape = start.find((shape) => shape.id === endShape.id) ?? endShape;
          return {
            ...endShape,
            x: startShape.x + (endShape.x - startShape.x) * eased,
            y: startShape.y + (endShape.y - startShape.y) * eased,
            width: startShape.width + (endShape.width - startShape.width) * eased,
            height: startShape.height + (endShape.height - startShape.height) * eased,
            radius: startShape.radius + (endShape.radius - startShape.radius) * eased,
          };
        }),
      );

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(tick);
      } else {
        animationRef.current = null;
        setShapes(cloneShapes(target));
        setIsRemixing(false);
      }
    };

    animationRef.current = requestAnimationFrame(tick);
  };

  const remix = () => {
    animateTo(REMIXES[remixIndex]);
    setRemixIndex((current) => (current + 1) % REMIXES.length);
  };

  const reset = () => {
    animateTo(INITIAL_SHAPES);
    setBlend(112);
    setDetail(7);
    setRemixIndex(0);
  };

  const player = shapes.find((shape) => shape.id === "player")!;
  const note = shapes.find((shape) => shape.id === "note")!;
  const layouts = contentLayouts(player, note);

  const shapeStyle = (shape: LiquidShape): CSSProperties => ({
    left: shape.x,
    top: shape.y,
    width: shape.width,
    height: shape.height,
    borderRadius: shape.radius,
  });

  const contentStyle = (id: string): CSSProperties => ({
    "--content-width": `${layouts[id].width}px`,
    "--content-margin-left": layouts[id].align === "right" ? "auto" : "0",
    "--content-pressure": layouts[id].pressure,
    "--timeline-width": `${layouts[id].timelineWidth}px`,
    "--lyrics-size": `${layouts[id].lyricsSize}px`,
  });

  return (
    <main className="page-shell">
      <section className="lab" aria-label="Interactive liquid UI playground">
        <div ref={shellRef} className="stage-shell" style={{ height: STAGE_HEIGHT * scale }}>
          <div
            className="stage"
            style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})` }}
          >
            <div className="stage-grid" />

            <svg
              className="liquid-surface"
              viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
              aria-hidden="true"
            >
              <path d={liquidPath} />
            </svg>

            <article
              className={`liquid-card player-card ${activeId === "player" ? "is-dragging" : ""}`}
              style={shapeStyle(player)}
              onPointerDown={(event) => beginDrag(event, "player")}
              onPointerMove={continueDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => moveWithKeyboard(event, "player")}
              tabIndex={0}
              role="group"
              aria-label="Draggable music card. Drag it, or use the arrow keys."
            >
              <div className="card-content" style={contentStyle("player")}>
                <div className="card-header">
                  <span className="card-kicker card-kicker--light">NOW PLAYING</span>
                </div>
                <div className="player-main">
                  <div className="album-art" aria-hidden="true" />
                  <div>
                    <h2>petal</h2>
                    <p>ariana grande</p>
                  </div>
                </div>
                <div className="timeline"><span /></div>
                <div className="time-row"><span>1:24</span><span>3:04</span></div>
              </div>
            </article>

            <article
              className={`liquid-card note-card ${activeId === "note" ? "is-dragging" : ""}`}
              style={shapeStyle(note)}
              onPointerDown={(event) => beginDrag(event, "note")}
              onPointerMove={continueDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => moveWithKeyboard(event, "note")}
              tabIndex={0}
              role="group"
              aria-label="Draggable note card. Drag it, or use the arrow keys."
            >
              <div className="card-content" style={contentStyle("note")}>
                <div className="note-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M6 8.5h12M6 12h8M6 15.5h5" /></svg>
                </div>
                <div className="lyrics-stack">
                  <span className="card-kicker card-kicker--light">LYRICS</span>
                  <div className="lyrics-lines" aria-label="Lyrics lines">
                    <p className="lyrics-line lyrics-line--active">all of my favorite stories</p>
                    <p className="lyrics-line lyrics-line--muted">end in some kind of catastrophe</p>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </div>

        <div className="controls">
          <label className="control-block">
            <span className="control-copy">
              <strong>Blend</strong>
              <output>{blend}</output>
            </span>
            <input
              type="range"
              min="36"
              max="156"
              step="1"
              value={blend}
              onChange={(event) => setBlend(Number(event.target.value))}
            />
          </label>

          <label className="control-block">
            <span className="control-copy">
              <strong>Detail</strong>
              <output>{detail}px</output>
            </span>
            <input
              type="range"
              min="4"
              max="12"
              step="1"
              value={detail}
              onChange={(event) => setDetail(Number(event.target.value))}
            />
          </label>

          <div className="button-group">
            <button className="secondary-button" type="button" onClick={reset} disabled={isRemixing}>Reset</button>
            <button className="primary-button" type="button" onClick={remix} disabled={isRemixing}>
              <span aria-hidden="true">✦</span> {isRemixing ? "Morphing…" : "Remix"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
