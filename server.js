// Minimal WebSocket multiplayer server (Node.js + ws)
const WebSocket = require('ws');
const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log('WebSocket server started on ws://localhost:' + PORT);

// Rooms: roomId -> { id, clients: Set, players: Map<id, PlayerState> }
const rooms = new Map();
function broadcast(roomId, msg){
  const r = rooms.get(roomId);
  if (!r) return;
  const s = JSON.stringify(msg);
  for (const cli of r.clients) if (cli.readyState === WebSocket.OPEN) cli.send(s);
}
function ensureRoom(roomId){
  if (!rooms.has(roomId)) rooms.set(roomId, { id: roomId, clients: new Set(), players: {}, mode:'coop' });
  return rooms.get(roomId);
}
function nextId(prefix='P'){ return prefix + Math.random().toString(36).slice(2,6); }

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch(e) { return; }
    if (data.type === 'join'){
      const room = ensureRoom(data.room || 'default');
      ws.room = room.id;
      ws.playerId = data.id || (data.player || nextId());
      // поддержка режима лобби (coop vs versus)
      if (data.mode && (data.mode === 'coop' || data.mode === 'versus')) {
        room.mode = data.mode;
      }
      // store player if not exists
      if (!room.players[ws.playerId]) {
        room.players[ws.playerId] = {
          id: ws.playerId,
          nickname: data.nickname || ws.playerId,
          x: 0, y: 0, z: 0, rot: 0, hp: 100, alive: true
        };
      }
      room.clients.add(ws);
      // host assignment
      if (!room.hostId) room.hostId = ws.playerId;
      // распределяем команду в зависимости от режима
      if (room.mode === 'coop') {
        // все в одной команде 0
        Object.values(room.players).forEach(p => p.team = 0);
      } else {
        // чередование команд для Versus
        let i = 0;
        for (let pid of Object.keys(room.players)) {
          room.players[pid].team = i % 2; i++;
        }
      }
      ws.send(JSON.stringify({type:'joinAck', id: ws.playerId, room: room.id, hostId: room.hostId, mode: room.mode}));
      broadcast(room.id, {type:'state', players: Object.values(room.players), hostId: room.hostId, mode: room.mode});
      return;
    }
    if (!ws.room) return; // ignore others before join
    // Move
    if (data.type === 'move'){
      const r = rooms.get(ws.room);
      const p = r?.players[ws.playerId];
      if (p){ p.x = data.x; p.y = data.y; p.z = data.z; p.rot = data.rot || p.rot; }
    } else if (data.type === 'shoot'){
      // simple hit test against players in same room
      const r = rooms.get(ws.room);
      const shooter = r?.players[ws.playerId];
      if (!r || !shooter) return;
      const origin = { ...shooter, x: shooter.x, y: shooter.y, z: shooter.z };
      // direction assumed to be provided
      const dir = data.direction || {x:0, y:0, z:1};
      const hitIds = [];
      for (const id of Object.keys(r.players)){
        if (id === ws.playerId) continue;
        const pl = r.players[id];
        const dx = pl.x - origin.x, dy = pl.y - origin.y, dz = pl.z - origin.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        // simple range check
        if (dist < 25){
          // naive line-of-sight by dot
          const v = {x: dx, y: dy, z: dz};
          const vnorm = Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z) || 1;
          const dirNorm = Math.sqrt(dir.x*dir.x+dir.y*dir.y+dir.z*dir.z) || 1;
          const dot = (v.x*dir.x + v.y*dir.y + v.z*dir.z) / (vnorm * dirNorm);
          if (dot > 0.8){
            hitIds.push(id);
            break;
          }
        }
      }
      // apply hits with friendly-fire protection
      const shooterTeam = shooter?.team !== undefined ? shooter.team : -1;
      hitIds.forEach(id => {
        const target = r.players[id];
        if (!target) return;
        if (shooterTeam !== -1 && target.team === shooterTeam) return; // no damage to same team
        target.hp -= 25; if (target.hp <= 0) target.alive = false;
      });
      broadcast(ws.room, {type:'state', players: Object.values(r.players), hostId: r.hostId, mode: r.mode});
    } else if (data.type === 'ready'){
      const r = rooms.get(ws.room);
      if (r && r.players[ws.playerId] != null){ r.players[ws.playerId].ready = !!data.ready; }
      broadcast(ws.room, {type:'state', players: Object.values(r.players), hostId: r.hostId});
    } else if (data.type === 'start'){
      const r = rooms.get(ws.room);
      if (r && r.hostId === ws.playerId){
        broadcast(ws.room, {type:'start', by: ws.playerId});
      }
    } else if (data.type === 'setMode'){
      const r = rooms.get(ws.room);
      if (r && (data.mode === 'coop' || data.mode === 'versus')){
        r.mode = data.mode;
        if (r.mode === 'coop'){ Object.values(r.players).forEach(p => p.team = 0); }
        else { let i=0; for (let pid of Object.keys(r.players)){ r.players[pid].team = i%2; i++; } }
        broadcast(ws.room, {type:'state', players: Object.values(r.players), hostId: r.hostId, mode: r.mode});
      }
    }
  });
  ws.on('close', () => {
    const room = ws.room;
    if (room && rooms.has(room)){
      const r = rooms.get(room);
      if (ws.playerId && r.players[ws.playerId]) delete r.players[ws.playerId];
      if (ws in r.clients) r.clients.delete(ws);
      broadcast(room, {type:'state', players: Object.values(r.players)});
    }
  });
});
