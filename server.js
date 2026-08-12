const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

const CHARACTERS = {
  dragon: { name: '龍', moves: [[-1,0],[1,0],[0,-1],[0,1]], skillName: '神速', skillDesc: '全方向に何マスでも進める' },
  knight: { name: '桂', moves: [[-2,-1],[-2,1]], skillName: '跳躍', skillDesc: '敵駒を1体飛び越えて奇襲' },
  gold:   { name: '金', moves: [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1]], skillName: '咆哮', skillDesc: '周囲1マスの敵を全員気絶' },
  runner: { name: '香', moves: [[-1,0],[-2,0],[-3,0]], skillName: '突撃', skillDesc: '直線状の敵を貫通攻撃' }
};

io.on('connection', (socket) => {
  socket.on('join_room', (roomId) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: { sente: null, gote: null },
        spectators: [],
        board: Array(6).fill(null).map(() => Array(5).fill(null)),
        turn: 'sente',
        phase: 'setup',
        placedCount: { sente: 0, gote: 0 },
        captured: { sente: [], gote: [] }
      };
      rooms[roomId].board[5][2] = { type: 'king', owner: 'sente', name: '王', hasUsedSkill: false };
      rooms[roomId].board[0][2] = { type: 'king', owner: 'gote', name: '王', hasUsedSkill: false };
    }

    const room = rooms[roomId];
    let role = 'spectator';

    if (!room.players.sente) {
      room.players.sente = socket.id;
      role = 'sente';
    } else if (!room.players.gote) {
      room.players.gote = socket.id;
      role = 'gote';
    } else {
      if (room.spectators.length < 8) {
        room.spectators.push(socket.id);
      } else {
        socket.emit('error_message', '部屋が満員です（最大10人）');
        return;
      }
    }

    socket.emit('init_state', { role, roomId, characters: CHARACTERS });
    io.to(roomId).emit('update_board', { board: room.board, turn: room.turn, phase: room.phase, captured: room.captured });
  });

  // 駒の初期配置
  socket.on('place_piece', ({ roomId, charKey, col }) => {
    const room = rooms[roomId];
    if (!room) return;

    const isSente = socket.id === room.players.sente;
    const isGote = socket.id === room.players.gote;
    if (!isSente && !isGote) return;

    const row = isSente ? 5 : 0;
    const owner = isSente ? 'sente' : 'gote';

    if (room.board[row][col] === null) {
      room.board[row][col] = {
        type: charKey,
        owner: owner,
        name: CHARACTERS[charKey].name,
        hasUsedSkill: false
      };
      room.placedCount[owner]++;

      if (room.placedCount.sente >= 4 && room.placedCount.gote >= 4) {
        room.phase = 'playing';
      }

      io.to(roomId).emit('update_board', { board: room.board, turn: room.turn, phase: room.phase, captured: room.captured });
    }
  });

  // 駒の移動処理
  socket.on('move_piece', ({ roomId, from, to }) => {
    const room = rooms[roomId];
    if (!room || room.phase !== 'playing') return;

    const isSente = socket.id === room.players.sente;
    const isGote = socket.id === room.players.gote;
    const currentOwner = room.turn;

    if ((currentOwner === 'sente' && !isSente) || (currentOwner === 'gote' && !isGote)) return;

    const targetPiece = room.board[to.r][to.c];
    const movingPiece = room.board[from.r][from.c];

    if (!movingPiece || movingPiece.owner !== currentOwner) return;

    // 敵駒を取る処理
    if (targetPiece) {
      if (targetPiece.owner === currentOwner) return; // 味方の駒には移動不可
      
      // 取った駒を再配置用に持ち駒へ（スキル使用状態をリセット）
      targetPiece.owner = currentOwner;
      targetPiece.hasUsedSkill = false;
      room.captured[currentOwner].push(targetPiece);

      if (targetPiece.type === 'king') {
        io.to(roomId).emit('game_over', { winner: currentOwner });
      }
    }

    // 移動実行
    room.board[to.r][to.c] = movingPiece;
    room.board[from.r][from.c] = null;

    // 手番交代
    room.turn = room.turn === 'sente' ? 'gote' : 'sente';
    io.to(roomId).emit('update_board', { board: room.board, turn: room.turn, phase: room.phase, captured: room.captured });
  });

  // スキル使用処理
  socket.on('use_skill', ({ roomId, pos }) => {
    const room = rooms[roomId];
    if (!room || room.phase !== 'playing') return;

    const piece = room.board[pos.r][pos.c];
    if (piece && !piece.hasUsedSkill) {
      piece.hasUsedSkill = true; // スキル使用済みに変更
      io.to(roomId).emit('skill_activated', { name: piece.name, skill: CHARACTERS[piece.type]?.skillName || 'スキル' });
      io.to(roomId).emit('update_board', { board: room.board, turn: room.turn, phase: room.phase, captured: room.captured });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバー起動中: http://localhost:${PORT}`);
});