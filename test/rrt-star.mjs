import assert from 'node:assert/strict';
import {HarborNavigationMap, waterBounds} from '../src/route-planner.js';
import {rrtStarPath} from '../src/rrt-star.js';
import {makeRun, portLayout} from '../src/simulation.js';

function valid(path, map, start, goal) {
  assert.ok(path?.length >= 2);
  assert.deepEqual(path[0], start);
  assert.deepEqual(path.at(-1), goal);
  let metres = 0;
  for (let i = 1; i < path.length; i++) {
    assert.ok(map.clear(path[i - 1], path[i]), 'segment crosses an inflated obstacle');
    metres += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  }
  return metres;
}

const map = new HarborNavigationMap(makeRun(portLayout()).layout);
map.obstacles = [
  {minX: -14, maxX: -11, minZ: -29, maxZ: 9},
  {minX: 8, maxX: 11, minZ: -6, maxZ: 32}
];
const start = {x: -26, z: -10}, goal = {x: 26, z: 14};
const clear = (a, b) => map.clear(a, b);
assert.equal(clear(start, goal), false);
let improved = 0;
for (let seed = 0; seed < 16; seed++) {
  const initial = {}, refined = {};
  const first = rrtStarPath(start, goal, waterBounds, clear, {seed, refinement: 0, stats: initial});
  const final = rrtStarPath(start, goal, waterBounds, clear, {seed, stats: refined});
  valid(first, map, start, goal);
  const cost = valid(final, map, start, goal);
  assert.deepEqual(final, rrtStarPath(start, goal, waterBounds, clear, {seed}));
  assert.ok(refined.rewires > 0 && refined.samples > initial.samples);
  assert.equal(refined.firstCost, initial.treeCost);
  assert.ok(cost <= refined.treeCost + 1e-8 && refined.treeCost <= initial.treeCost + 1e-8);
  if (refined.treeCost < initial.treeCost - 1e-5) improved++;
}
assert.ok(improved > 0, 'rewiring and refinement must improve at least one initial solution');

map.obstacles = [{minX: -1, maxX: 1, minZ: -30, maxZ: 32}];
const blocked = {};
assert.equal(rrtStarPath(start, goal, waterBounds, clear, {iterations: 120, stats: blocked}), null);
assert.equal(blocked.samples, 120);
const direct = {}, near = {x: -22, z: -8};
assert.deepEqual(rrtStarPath(start, near, waterBounds, clear, {stats: direct}), [start, near]);
assert.equal(direct.samples, 0);
assert.deepEqual(map.findPath(start, start), [start, start]);
assert.equal(map.findPath(start, {x: 0, z: 0}), null);
assert.equal(map.findPath({x: NaN, z: 3}, goal), null);

for (let layout = 0; layout < 3; layout++) {
  const chart = makeRun(portLayout(layout)).navigationMap;
  const a = {x: 0, z: 20}, b = {x: 0, z: -14};
  const occupied = chart.withMooredVessel({x: 0, z: 2});
  assert.deepEqual(chart.findPath(a, b), [a, b]);
  assert.ok(valid(occupied.findPath(a, b), occupied, a, b) > 34);
  assert.deepEqual(chart.findPath(a, b), [a, b], 'neighbor obstacle leaked into base map');
}
console.log('RRT* passed direct, disconnected, occupied-berth and two-barrier routes. Refinement shortened '+improved+'/16 seeded trees.');
