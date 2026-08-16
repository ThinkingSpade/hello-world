/* ─────────────────────────────────────────────────────────────────────────────
 * munder-pathfinding.js — BFS over the office's walkability grid.
 *
 * Munder Difflin v0.4.3 · src/renderer/src/scene/office/pathfinding.ts,
 * types stripped, logic untouched. Their own note: ported verbatim from
 * shahar061/the-office (office/engine/pathfinding.ts).
 * https://github.com/chaitanyagiri/munder-difflin
 *
 * MIT License · Copyright (c) Chaitanya Giri — full notice in munder-people.js.
 * ───────────────────────────────────────────────────────────────────────────── */

const DIRECTIONS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

export function findPath(map, start, goal) {
  if (start.x === goal.x && start.y === goal.y) return [];
  if (!map.isWalkable(goal.x, goal.y)) return null;

  const key = (p) => `${p.x},${p.y}`;
  const visited = new Set();
  const parent = new Map();
  const queue = [start];
  visited.add(key(start));

  while (queue.length > 0) {
    const current = queue.shift();

    for (const dir of DIRECTIONS) {
      const next = { x: current.x + dir.x, y: current.y + dir.y };
      const nextKey = key(next);

      if (visited.has(nextKey) || !map.isWalkable(next.x, next.y)) continue;

      visited.add(nextKey);
      parent.set(nextKey, current);

      if (next.x === goal.x && next.y === goal.y) {
        return reconstructPath(parent, start, goal);
      }

      queue.push(next);
    }
  }

  return null;
}

function reconstructPath(parent, start, goal) {
  const path = [];
  let current = goal;
  const key = (p) => `${p.x},${p.y}`;

  while (!(current.x === start.x && current.y === start.y)) {
    path.unshift(current);
    current = parent.get(key(current));
  }

  return path;
}
