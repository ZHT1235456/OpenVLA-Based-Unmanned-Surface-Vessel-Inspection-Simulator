export const plannerName = 'RRT*';

const squaredDistance = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const point = p => ({x: p.x, z: p.z});

function routeRandom(start, goal, seed) {
  let state = seed ?? 2166136261;
  for (const value of [start.x, start.z, goal.x, goal.z]) {
    state = Math.imul(state ^ Math.round(value * 100), 16777619);
  }
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function rewire(node, parent, cost) {
  node.parent.children.delete(node);
  node.parent = parent;
  parent.children.add(node);
  const saving = node.cost - cost;
  node.cost = cost;
  const pending = [...node.children];
  while (pending.length) {
    const child = pending.pop();
    child.cost -= saving;
    for (const grandchild of child.children) pending.push(grandchild);
  }
}

function shorten(path, clear) {
  const result = [path[0]];
  for (let i = 0; i < path.length - 1;) {
    let next = path.length - 1;
    while (next > i + 1 && !clear(path[i], path[next])) next--;
    result.push(path[next]);
    i = next;
  }
  return result;
}

// Geometric RRT* in the x/z plane. The caller supplies a collision test for a whole edge.
export function rrtStarPath(start, goal, bounds, clear, options = {}) {
  const {step = 6, iterations = 1500, refinement = 200, seed, stats} = options;
  if (stats) Object.assign(stats, {samples: 0, rewires: 0, firstCost: null, treeCost: null});
  if (!clear(start, start) || !clear(goal, goal)) return null;
  if (clear(start, goal)) {
    if (stats) stats.firstCost = stats.treeCost = Math.sqrt(squaredDistance(start, goal));
    return [point(start), point(goal)];
  }

  const random = routeRandom(start, goal, seed);
  const local = {
    minX: Math.max(bounds.minX, Math.min(start.x, goal.x) - 2 * step),
    maxX: Math.min(bounds.maxX, Math.max(start.x, goal.x) + 2 * step),
    minZ: Math.max(bounds.minZ, Math.min(start.z, goal.z) - 2 * step),
    maxZ: Math.min(bounds.maxZ, Math.max(start.z, goal.z) + 2 * step)
  };
  const area = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ);
  const root = {...point(start), parent: null, children: new Set(), cost: 0};
  const nodes = [root], goalEdges = [];
  let limit = iterations;
  for (let i = 0; i < limit; i++) {
    if (stats) stats.samples++;
    // Mix goal bias and nearby samples with uniform samples over the entire basin.
    const region = i % 2 === 0 ? bounds : local;
    const sample = i % 9 === 0 ? goal : {
      x: region.minX + random() * (region.maxX - region.minX),
      z: region.minZ + random() * (region.maxZ - region.minZ)
    };
    let nearest = root, nearestSq = squaredDistance(root, sample);
    for (const node of nodes) {
      const d = squaredDistance(node, sample);
      if (d < nearestSq) { nearest = node; nearestSq = d; }
    }
    if (nearestSq < 1e-12) continue;
    const distance = Math.sqrt(nearestSq), scale = Math.min(1, step / distance);
    const next = {x: nearest.x + (sample.x - nearest.x) * scale,
      z: nearest.z + (sample.z - nearest.z) * scale};
    if (!clear(nearest, next)) continue;

    const n = nodes.length + 1;
    const radiusSq = Math.min(step * step, 4 * area * Math.log(n) / n);
    const neighbors = [];
    let parent = nearest, cost = nearest.cost + Math.min(distance, step);
    for (const node of nodes) {
      const sq = squaredDistance(node, next);
      if (sq > radiusSq) continue;
      const edge = Math.sqrt(sq);
      neighbors.push([node, edge]);
      if (node.cost + edge < cost && clear(node, next)) {
        parent = node; cost = node.cost + edge;
      }
    }
    Object.assign(next, {parent, cost, children: new Set()});
    parent.children.add(next); nodes.push(next);
    for (const [node, edge] of neighbors) {
      const via = next.cost + edge;
      if (via + 1e-9 < node.cost && clear(next, node)) {
        rewire(node, next, via);
        if (stats) stats.rewires++;
      }
    }
    const toGoal = Math.sqrt(squaredDistance(next, goal));
    if (toGoal <= step && clear(next, goal)) {
      if (!goalEdges.length) {
        if (stats) stats.firstCost = next.cost + toGoal;
        limit = Math.min(limit, i + 1 + refinement);
      }
      goalEdges.push({node: next, distance: toGoal});
    }
  }
  if (!goalEdges.length) return null;
  // A later rewire may have shortened any subtree that already reaches the goal.
  let best = goalEdges[0];
  for (const edge of goalEdges) {
    if (edge.node.cost + edge.distance < best.node.cost + best.distance) best = edge;
  }
  if (stats) stats.treeCost = best.node.cost + best.distance;
  const path = best.distance > 1e-9 ? [point(goal)] : [];
  for (let node = best.node; node; node = node.parent) path.push(point(node));
  path.reverse();
  path[path.length - 1] = point(goal);
  return shorten(path, clear);
}
