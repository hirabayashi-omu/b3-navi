import { B3_FLOORS_DATA } from './src/data/b3_floors_data.js';
import { RoutePlanner } from './src/js/pathfinding.js';
const floors=B3_FLOORS_DATA.floors;
const planner=new RoutePlanner(250);
const targetFloor=floors.find(f=>f.floor===1);
const targetRoom=targetFloor.rooms.find(r=>r.room_number==='101' || r.display_number==='101');
const tests=[
  {name:'611 center', x:44148.3, y:6277.4},
  {name:'611 just outside south', x:35000, y:9000},
  {name:'611 west corridor', x:30000, y:7000},
  {name:'611 east corridor', x:42000, y:10000}
];
for(const t of tests){
  const route=planner.findMultiFloorRoute(floors, 6, {x:t.x,y:t.y}, 1, targetRoom.room_id);
  console.log('test',t.name,t.x,t.y, route? route.segments[0].exit : 'null');
  if(route) console.log('  points', route.segments[0].points.slice(-3));
}
