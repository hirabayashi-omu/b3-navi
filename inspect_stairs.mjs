import { B3_FLOORS_DATA } from './src/data/b3_floors_data.js';
import { RoutePlanner, isStairRoom } from './src/js/pathfinding.js';
const floors = B3_FLOORS_DATA.floors;
const floor6 = floors.find(f => f.floor === 6);
console.log('6F stair rooms:');
for (const room of floor6.rooms.filter(isStairRoom)) {
  console.log(room.room_id, room.display_label, room.room_name, room.center_point_mm, room.bounding_box_mm);
}
const planner = new RoutePlanner();
const clusters = planner._buildStairClusters(floors);
console.log('clusters count', clusters.length);
for (const c of clusters) {
  console.log('cluster', c.id, 'pos', [c.x, c.y], 'entries', c.entries.map(e => `${e.floor}:${e.room.room_id}@${e.room.center_point_mm}`).join(', '));
}
