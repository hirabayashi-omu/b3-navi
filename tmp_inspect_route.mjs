import { RoutePlanner } from './src/js/pathfinding.js';
import fs from 'fs';

const data = JSON.parse(fs.readFileSync('./src/data/b3_floors_customized.json', 'utf8'));
const planner = new RoutePlanner();
const floor = data.floors.find(f => f.floor === 4);
const targetRoomId = '4F_NEW_1785559023039';
const targetRoom = floor.rooms.find(r => r.room_id === targetRoomId);
const grid = planner._buildGrid(floor, []);
const goal = planner._mmToCell(grid, targetRoom.center_point_mm[0], targetRoom.center_point_mm[1]);
const goalCell = planner._clampToNearestWalkable(grid, goal);
console.log({ goalCell, goalBlocked: planner._isBlocked(grid, goalCell.cx, goalCell.cy) });
let walkable = 0;
for (let y = 0; y < grid.rows; y++) {
  for (let x = 0; x < grid.cols; x++) {
    if (!planner._isBlocked(grid, x, y)) walkable++;
  }
}
console.log({ rows: grid.rows, cols: grid.cols, walkable });

const samples = [
  { x: 14000, y: 36000 },
  { x: 13000, y: 32000 },
  { x: 12000, y: 40000 },
  { x: 17000, y: 37000 },
  { x: 20000, y: 38000 },
  { x: 10000, y: 38000 },
  { x: 11500, y: 43000 },
  { x: 16000, y: 33000 }
];
for (const start of samples) {
  const startCell = planner._clampToNearestWalkable(grid, planner._mmToCell(grid, start.x, start.y));
  const path = planner._aStar(grid, startCell, goalCell);
  console.log(start, startCell, path ? path.length : null);
}
