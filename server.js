const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let room = createInitialRoomState();

function createInitialRoomState() {
    return {
        player1: null,
        player2: null,
        spectators: [],
        gameStarted: false,
        phase: 'lobby', 
        p1Ready: false,
        p2Ready: false,
        p1Setup: [],
        p2Setup: [],
        currentTurnRole: 'first',
        winnerRole: null,
        board: createInitialBoard(),
        hands: { first: [], second: [] },
        pendingSkill: null
    };
}

function createInitialBoard() {
    const board = Array(5).fill(null).map(() => Array(5).fill(null));
    board[4][2] = { type: 'K', owner: 'first', hasUsedSkill: false, isSealed: false };
    board[0][2] = { type: 'K', owner: 'second', hasUsedSkill: false, isSealed: false };
    return board;
}

function removeFromRoom(socketId) {
    let changed = false;

    if (room.player1 && room.player1.id === socketId) {
        room.player1 = null;
        changed = true;
    }
    if (room.player2 && room.player2.id === socketId) {
        room.player2 = null;
        changed = true;
    }

    const prevSpecCount = room.spectators.length;
    room.spectators = room.spectators.filter(s => s.id !== socketId);
    if (room.spectators.length !== prevSpecCount) {
        changed = true;
    }

    if (changed && room.phase !== 'lobby') {
        room.gameStarted = false;
        room.phase = 'lobby';
        room.p1Ready = false;
        room.p2Ready = false;
        room.p1Setup = [];
        room.p2Setup = [];
        room.board = createInitialBoard();
        room.hands = { first: [], second: [] };
        room.pendingSkill = null;
        io.emit('returned-to-lobby');
    }

    return changed;
}

io.on('connection', (socket) => {
    socket.emit('room-update', room);

    socket.on('join-player', () => {
        if (room.player1?.id === socket.id || room.player2?.id === socket.id) return;
        room.spectators = room.spectators.filter(s => s.id !== socket.id);

        if (!room.player1) {
            room.player1 = { id: socket.id, name: `プレイヤー1 (${socket.id.slice(0, 4)})`, role: 'first' };
        } else if (!room.player2) {
            room.player2 = { id: socket.id, name: `プレイヤー2 (${socket.id.slice(0, 4)})`, role: 'second' };
        }

        io.emit('room-update', room);
    });

    socket.on('join-spectator', () => {
        if (room.player1?.id === socket.id) room.player1 = null;
        if (room.player2?.id === socket.id) room.player2 = null;

        if (!room.spectators.some(s => s.id === socket.id)) {
            room.spectators.push({ id: socket.id, name: `観戦者 (${socket.id.slice(0, 4)})` });
        }

        io.emit('room-update', room);
    });

    socket.on('leave-room', () => {
        if (removeFromRoom(socket.id)) {
            io.emit('room-update', room);
        }
    });

    socket.on('disconnect', () => {
        if (removeFromRoom(socket.id)) {
            io.emit('room-update', room);
        }
    });

    socket.on('start-game', () => {
        if (room.player1 && room.player2 && !room.gameStarted) {
            room.gameStarted = true;
            room.phase = 'setup';
            room.p1Ready = false;
            room.p2Ready = false;
            room.p1Setup = [];
            room.p2Setup = [];
            room.board = createInitialBoard();
            room.hands = { first: [], second: [] };
            io.emit('game-started', room);
            io.emit('room-update', room);
        }
    });

    socket.on('submit-setup', (placedPieces) => {
        const isP1 = room.player1?.id === socket.id;
        const isP2 = room.player2?.id === socket.id;

        if (isP1) {
            room.p1Setup = placedPieces;
            room.p1Ready = true;
        } else if (isP2) {
            room.p2Setup = placedPieces;
            room.p2Ready = true;
        }

        if (room.p1Ready && room.p2Ready) {
            room.p1Setup.forEach(p => {
                room.board[p.y][p.x] = { type: p.type, owner: 'first', hasUsedSkill: false, isSealed: false };
            });
            room.p2Setup.forEach(p => {
                room.board[p.y][p.x] = { type: p.type, owner: 'second', hasUsedSkill: false, isSealed: false };
            });

            room.phase = 'playing';
            room.currentTurnRole = 'first';
            io.emit('phase-changed', room);
        } else {
            io.emit('room-update', room);
        }
    });

    socket.on('move-piece', ({ fromX, fromY, toX, toY }) => {
        if (room.phase !== 'playing') return;
        const role = (room.player1?.id === socket.id) ? 'first' : (room.player2?.id === socket.id) ? 'second' : null;
        if (!role || room.currentTurnRole !== role) return;

        const piece = room.board[fromY][fromX];
        if (!piece || piece.owner !== role) return;

        const target = room.board[toY][toX];
        if (target) {
            if (target.owner === role) return;
            if (target.type !== 'K') {
                room.hands[role].push(target.type);
            }
        }

        room.board[toY][toX] = piece;
        room.board[fromY][fromX] = null;

        if (target && target.type === 'K') {
            room.phase = 'ended';
            room.winnerRole = role;
            io.emit('game-over', room);
            return;
        }

        room.currentTurnRole = (role === 'first') ? 'second' : 'first';
        io.emit('board-updated', room);
    });

    socket.on('drop-piece', ({ type, toX, toY }) => {
        if (room.phase !== 'playing') return;
        const role = (room.player1?.id === socket.id) ? 'first' : (room.player2?.id === socket.id) ? 'second' : null;
        if (!role || room.currentTurnRole !== role) return;

        const hand = room.hands[role];
        const idx = hand.indexOf(type);
        if (idx === -1 || room.board[toY][toX] !== null) return;

        hand.splice(idx, 1);
        room.board[toY][toX] = { type, owner: role, hasUsedSkill: false, isSealed: false };

        room.currentTurnRole = (role === 'first') ? 'second' : 'first';
        io.emit('board-updated', room);
    });

    socket.on('use-skill', ({ type, x, y, targets }) => {
        if (room.phase !== 'playing') return;
        const role = (room.player1?.id === socket.id) ? 'first' : (room.player2?.id === socket.id) ? 'second' : null;
        if (!role || room.currentTurnRole !== role) return;

        const piece = room.board[y][x];
        if (!piece || piece.owner !== role || piece.hasUsedSkill || piece.isSealed) return;

        const enemyRole = (role === 'first') ? 'second' : 'first';
        const enemySocketId = (enemyRole === 'first') ? room.player1?.id : room.player2?.id;

        if (type === 'S') {
            let myCount = 0;
            let enemyCount = 0;
            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 5; c++) {
                    const p = room.board[r][c];
                    if (p) {
                        if (p.owner === role) myCount++;
                        else if (p.owner === enemyRole) enemyCount++;
                    }
                }
            }
            if (enemyCount <= myCount) return;
        }

        let enemyNobunagaPos = null;
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const p = room.board[r][c];
                if (p && p.owner === enemyRole && p.type === 'N' && !p.hasUsedSkill && !p.isSealed) {
                    enemyNobunagaPos = { x: c, y: r };
                    break;
                }
            }
        }

        const executeSkill = () => {
            piece.hasUsedSkill = true;
            if (type === 'A') {
                targets.forEach(t => {
                    const targetPiece = room.board[t.y][t.x];
                    if (targetPiece && targetPiece.owner === enemyRole && targetPiece.type !== 'K') {
                        room.hands[enemyRole].push(targetPiece.type);
                        room.board[t.y][t.x] = null;
                    }
                });
            } else if (type === 'Y') {
                if (targets.length === 2) {
                    const p1 = room.board[targets[0].y][targets[0].x];
                    const p2 = room.board[targets[1].y][targets[1].x];
                    if (p1 && p2 && p1.owner === role && p2.owner === role) {
                        room.board[targets[0].y][targets[0].x] = p2;
                        room.board[targets[1].y][targets[1].x] = p1;
                    }
                }
            } else if (type === 'KE') {
                if (targets.length === 1) {
                    const targetPiece = room.board[targets[0].y][targets[0].x];
                    if (targetPiece && targetPiece.owner === enemyRole) {
                        targetPiece.isSealed = true;
                    }
                }
            }

            room.currentTurnRole = enemyRole;
            io.emit('board-updated', room);
        };

        if (enemyNobunagaPos && enemySocketId) {
            room.pendingSkill = { action: executeSkill, userRole: role, x, y, nobunagaPos: enemyNobunagaPos };
            io.to(enemySocketId).emit('prompt-nobunaga', { pieceType: type });
        } else {
            executeSkill();
        }
    });

    socket.on('respond-nobunaga', ({ cancel }) => {
        if (!room.pendingSkill) return;

        if (cancel) {
            const piece = room.board[room.pendingSkill.y]?.[room.pendingSkill.x];
            if (piece) {
                piece.hasUsedSkill = true;
            }

            if (room.pendingSkill.nobunagaPos) {
                const nobunaga = room.board[room.pendingSkill.nobunagaPos.y]?.[room.pendingSkill.nobunagaPos.x];
                if (nobunaga && nobunaga.type === 'N') {
                    nobunaga.hasUsedSkill = true;
                }
            }

            const userSocketId = (room.pendingSkill.userRole === 'first') ? room.player1?.id : room.player2?.id;
            if (userSocketId) {
                io.to(userSocketId).emit('skill-cancelled', { message: '相手のノブナガによりスキルが無効化されました！' });
            }

            room.currentTurnRole = room.pendingSkill.userRole;
            room.pendingSkill = null;
            io.emit('board-updated', room);
        } else {
            const action = room.pendingSkill.action;
            room.pendingSkill = null;
            action();
        }
    });

    socket.on('return-to-lobby', () => {
        room.gameStarted = false;
        room.phase = 'lobby';
        room.p1Ready = false;
        room.p2Ready = false;
        room.p1Setup = [];
        room.p2Setup = [];
        room.board = createInitialBoard();
        room.hands = { first: [], second: [] };
        room.pendingSkill = null;
        io.emit('returned-to-lobby');
        io.emit('room-update', room);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});