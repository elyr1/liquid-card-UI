export type LiquidShape = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

type Point = { x: number; y: number };
type Segment = [Point, Point];
type Edge = 0 | 1 | 2 | 3;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function roundedBoxDistance(px: number, py: number, shape: LiquidShape) {
  const radius = Math.min(shape.radius, shape.width / 2, shape.height / 2);
  const centerX = shape.x + shape.width / 2;
  const centerY = shape.y + shape.height / 2;
  const qx = Math.abs(px - centerX) - (shape.width / 2 - radius);
  const qy = Math.abs(py - centerY) - (shape.height / 2 - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

function smoothMinimum(a: number, b: number, amount: number) {
  if (amount <= 0) return Math.min(a, b);
  const h = clamp01(0.5 + (0.5 * (b - a)) / amount);
  return b * (1 - h) + a * h - amount * h * (1 - h);
}

function fieldAt(x: number, y: number, shapes: LiquidShape[], blend: number) {
  let distance = roundedBoxDistance(x, y, shapes[0]);
  for (let index = 1; index < shapes.length; index += 1) {
    distance = smoothMinimum(distance, roundedBoxDistance(x, y, shapes[index]), blend);
  }
  return distance;
}

function edgePoint(
  edge: Edge,
  x: number,
  y: number,
  size: number,
  values: [number, number, number, number],
): Point {
  const [topLeft, topRight, bottomRight, bottomLeft] = values;
  const interpolate = (first: number, second: number) => {
    const denominator = first - second;
    return Math.abs(denominator) < 0.000001 ? 0.5 : clamp01(first / denominator);
  };

  if (edge === 0) return { x: x + interpolate(topLeft, topRight) * size, y };
  if (edge === 1) return { x: x + size, y: y + interpolate(topRight, bottomRight) * size };
  if (edge === 2) return { x: x + interpolate(bottomLeft, bottomRight) * size, y: y + size };
  return { x, y: y + interpolate(topLeft, bottomLeft) * size };
}

function caseSegments(index: number, centerInside: boolean): [Edge, Edge][] {
  const fixed: Record<number, [Edge, Edge][]> = {
    0: [],
    1: [[3, 0]],
    2: [[0, 1]],
    3: [[3, 1]],
    4: [[1, 2]],
    6: [[0, 2]],
    7: [[3, 2]],
    8: [[2, 3]],
    9: [[0, 2]],
    11: [[1, 2]],
    12: [[3, 1]],
    13: [[0, 1]],
    14: [[3, 0]],
    15: [],
  };

  if (index === 5) return centerInside ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
  if (index === 10) return centerInside ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]];
  return fixed[index] ?? [];
}

function pointKey(point: Point) {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
}

function edgeKey(first: string, second: string) {
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function stitchSegments(segments: Segment[]) {
  const neighbors = new Map<string, string[]>();
  const points = new Map<string, Point>();

  const connect = (first: Point, second: Point) => {
    const firstKey = pointKey(first);
    const secondKey = pointKey(second);
    points.set(firstKey, first);
    points.set(secondKey, second);
    const firstNeighbors = neighbors.get(firstKey) ?? [];
    const secondNeighbors = neighbors.get(secondKey) ?? [];
    if (!firstNeighbors.includes(secondKey)) firstNeighbors.push(secondKey);
    if (!secondNeighbors.includes(firstKey)) secondNeighbors.push(firstKey);
    neighbors.set(firstKey, firstNeighbors);
    neighbors.set(secondKey, secondNeighbors);
  };

  segments.forEach(([first, second]) => connect(first, second));

  const used = new Set<string>();
  const loops: Point[][] = [];

  for (const [start, startNeighbors] of neighbors) {
    for (const initialNext of startNeighbors) {
      if (used.has(edgeKey(start, initialNext))) continue;

      const loop: Point[] = [points.get(start)!];
      let current = start;
      let next = initialNext;
      let closed = false;

      for (let guard = 0; guard < segments.length + 2; guard += 1) {
        used.add(edgeKey(current, next));
        current = next;
        if (current === start) {
          closed = true;
          break;
        }

        loop.push(points.get(current)!);
        const candidate = (neighbors.get(current) ?? []).find(
          (neighbor) => !used.has(edgeKey(current, neighbor)),
        );
        if (!candidate) break;
        next = candidate;
      }

      if (closed && loop.length >= 3) loops.push(loop);
    }
  }

  return loops;
}

function smoothLoop(points: Point[]) {
  const midpoint = (first: Point, second: Point): Point => ({
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  });

  const start = midpoint(points[points.length - 1], points[0]);
  let path = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const end = midpoint(current, next);
    path += ` Q ${current.x.toFixed(2)} ${current.y.toFixed(2)} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }
  return `${path} Z`;
}

export function createLiquidPath(
  shapes: LiquidShape[],
  width: number,
  height: number,
  cellSize: number,
  blend: number,
) {
  if (shapes.length === 0) return "";

  const columns = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const values = Array.from({ length: rows + 1 }, () => new Float32Array(columns + 1));

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      values[row][column] = fieldAt(column * cellSize, row * cellSize, shapes, blend);
    }
  }

  const segments: Segment[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cellValues: [number, number, number, number] = [
        values[row][column],
        values[row][column + 1],
        values[row + 1][column + 1],
        values[row + 1][column],
      ];
      const index =
        (cellValues[0] <= 0 ? 1 : 0) |
        (cellValues[1] <= 0 ? 2 : 0) |
        (cellValues[2] <= 0 ? 4 : 0) |
        (cellValues[3] <= 0 ? 8 : 0);
      if (index === 0 || index === 15) continue;

      const x = column * cellSize;
      const y = row * cellSize;
      const centerInside = fieldAt(x + cellSize / 2, y + cellSize / 2, shapes, blend) <= 0;
      for (const [firstEdge, secondEdge] of caseSegments(index, centerInside)) {
        segments.push([
          edgePoint(firstEdge, x, y, cellSize, cellValues),
          edgePoint(secondEdge, x, y, cellSize, cellValues),
        ]);
      }
    }
  }

  return stitchSegments(segments).map(smoothLoop).join(" ");
}
