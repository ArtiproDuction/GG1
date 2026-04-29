// Minimal WebSocket multiplayer server (Node.js + ws)
const WebSocket = require('ws');
const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });
console.log('WebSocket server started on ws://localhost:' + PORT);

const rooms = new Map();
function broadcast(roomId, msg){
  const r = rooms.get(roomId); if (!r) return;
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
      if (data.mode) room.mode = data.mode;
      const team = data.team !== undefined ? data.team : null;

      if (!room.players[ws.playerId]) {
        room.players[ws.playerId] = { id: ws.playerId, nickname: data.nickname || ws.playerId, x:0,y:0,z:0, rot:0, hp:100, alive:true, team: team };
      } else if (typeof data.team !== 'undefined') {
        room.players[ws.playerId].team = data.team;
      }

      room.clients.add(ws);
      if (!room.hostId) room.hostId = ws.playerId;

      if (room.mode === 'versus'){
        let i=0; for (let pid of Object.keys(room.players)){ if (pid===ws.playerId) continue; room.players[pid].team = i%2; i++; }
      } else if (room.mode==='coop'){
        Object.values(room.players).forEach(p => p.team = 0);
      }

      ws.send(JSON.stringify({type:'joinAck', id: ws.playerId, room: room.id, hostId: room.hostId, mode: room.mode}));
      broadcast(room.id, {type:'state', players: Object.values(room.players), hostId: room.hostId, mode: room.mode});
      return;
    }
    if (!ws.room) return;
    if (data.type === 'move'){ /* ... */ } else if (data.type === 'shoot'){ /* ... */ } else if (data.type === 'ready'){ /* ... */ } else if (data.type === 'start'){ /* ... */ } else if (data.type === 'setMode'){ /* ... */ }
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
