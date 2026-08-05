import { B3_FLOORS_DATA } from './src/data/b3_floors_data.js';
import { RoutePlanner } from './src/js/pathfinding.js';
const floors = B3_FLOORS_DATA.floors;
const floor6 = floors.find(f => f.floor === 6);
const floor1 = floors.find(f => f.floor === 1);
const planner = new RoutePlanner();
const targets = [
  { name: '610 center', x: 44148.3, y: 6277.4 },
  { name: '611 center', x: 22924, y: 3515.5 },
  { name: 'near 611 east', x: 38000, y: 5000 },
  { name: 'near 611 west', x: 25000, y: 4000 }
];
const clusters = planner._buildStairClusters(floors);
const stairEntries = clusters.map(c => c.entries.find(e => e.floor === 6));
const targetRoom = floor1.rooms.find(r => r.room_number === '101' || r.display_number === '101');
console.log('target room', targetRoom.room_id, targetRoom.room_number, targetRoom.display_number, targetRoom.center_point_mm);
for (const t of targets) {
  const start = { x: t.x, y: t.y };
  const startRect = planner._findRoomRectAtPoint(floor6, start);
  console.log('\n===', t.name, start, 'startRect', !!startRect);
  for (const se of stairEntries) {
    const stairMm = { x: se.room.center_point_mm[0], y: se.room.center_point_mm[1] };
    const route = planner.findRouteToPoint(floor6, start, stairMm, [se.room.room_id], se.room.bounding_box_mm, startRect);
    console.log('  stair', se.room.room_id, se.room.center_point_mm, 'dist', route ? route.distanceMm : 'null', 'points', route ? route.points.slice(0, 3) : '');
  }
  const multi = planner.findMultiFloorRoute(floors, 6, start, 1, targetRoom.room_id);
  console.log('  chosen', multi ? multi.segments[0].exit : 'null', 'segments', multi ? multi.segments.map(s => ({floor:s.floor,dist:s.distanceMm,enter:s.enter,exit:s.exit})) : null);
}
