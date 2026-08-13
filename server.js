const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ルーム管理
const rooms = {};

// 初期盤面の作成（4行 × 5列）
function createInitialBoard() {
    return [
        [null, null, { type: 'K', owner: 'second', hasUsedSkill: false }, null, null],
        [null, null, null, null, null],
        [null, null, null, null, null],
        [null, null, { type: 'K', owner: 'first', hasUsedSkill: false }, null, null]
    ];
}

function createRoomState(roomId) {
    return {
        id: roomId,
        player1: null, // 先攻 (first)
        player2: null, // 後攻 (second)
        spectators: [],
        phase: 'lobby', // 'lobby' | 'setup' | 'playing' | 'ended'
        p1Ready: false,
        p2Ready: false,
        board: createInitialBoard(),
        hands: { first: [], second: [] },
        currentTurnRole: 'first',
        winnerRole: null,
        pendingSkill: null // ノブナガ確認用の一時データ
    };
}

io.on('connection', (socket) => {
    // 常に単一のメインルームを使用（拡張可能）
    const roomId = 'main-room';
    if (!rooms[roomId]) {
        rooms[roomId] = createRoomState(roomId);
    }
    const room = rooms[roomId];
    socket.currentRoom = roomId;
    socket.join(roomId);

    // ロビーへ参加者として割り当て（空きがあれば自動参加、なければ観戦）
    if (!room.player1) {
        room.player1 = { id: socket.id, name: 'プレイヤー1', role: 'first' };
    } else if (!room.player2) {
        room.player2 = { id: socket.id, name: 'プレイヤー2', role: 'second' };
    } else {
        room.spectators.push({ id: socket.id, name: `観戦者 ${room.spectators.length + 1}` });
    }

    io.to(roomId).emit('room-update', room);

    // プレイヤー着席
    socket.on('join-player', () => {
        if (room.phase !== 'lobby') return;
        const inSpecIndex = room.spectators.findIndex(s => s.id === socket.id);
        if (inSpecIndex !== -1) room.spectators.splice(inSpecIndex, 1);

        if (!room.player1) {
            room.player1 = { id: socket.id, name: 'プレイヤー1', role: 'first' };
        } else if (!room.player2) {
            room.player2 = { id: socket.id, name: 'プレイヤー2', role: 'second' };
        }
        io.to(roomId).emit('room-update', room);
    });

    // 観戦へ移動
    socket.on('join-spectator', () => {
        if (room.phase !== 'lobby') return;
        if (room.player1?.id === socket.id) room.player1 = null;
        if (room.player2?.id === socket.id) room.player2 = null;

        if (!room.spectators.some(s => s.id === socket.id)) {
            room.spectators.push({ id: socket.id, name: `観戦者 ${room.spectators.length + 1}` });
        }
        io.to(roomId).emit('room-update', room);
    });

    // ゲーム開始（初期配置フェーズへ移行）
    socket.on('start-game', () => {
        if (room.player1 && room.player2 && room.phase === 'lobby') {
            room.phase = 'setup';
            room.board = createInitialBoard();
            room.hands = { first: [], second: [] };
            room.p1Ready = false;
            room.p2Ready = false;
            room.pendingSetups = { first: null, second: null }; // 一時保存用
            room.currentTurnRole = 'first';
            room.winnerRole = null;
            room.pendingSkill = null;

            io.to(roomId).emit('game-started', room);
        }
    });

    // 初期配置の完了を受け取り
    socket.on('submit-setup', (placedPieces) => {
        if (room.phase !== 'setup') return;

        const isP1 = socket.id === room.player1?.id;
        const isP2 = socket.id === room.player2?.id;
        if (!isP1 && !isP2) return;

        if (!room.pendingSetups) {
            room.pendingSetups = { first: null, second: null };
        }

        // 片方が準備完了したら一時保存エリアに保管するだけ（盤面にはまだ反映しない）
        if (isP1) {
            room.pendingSetups.first = placedPieces;
            room.p1Ready = true;
        } else if (isP2) {
            room.pendingSetups.second = placedPieces;
            room.p2Ready = true;
        }

        // 【お互いが準備完了を押した場合のみ】まとめて盤面に反映してゲーム開始
        if (room.p1Ready && room.p2Ready) {
            // 先攻の配置を反映
            if (room.pendingSetups.first) {
                room.pendingSetups.first.forEach(p => {
                    if (p.y === 3 && p.x !== 2) {
                        room.board[p.y][p.x] = {
                            type: p.type,
                            owner: 'first',
                            hasUsedSkill: false
                        };
                    }
                });
            }

            // 後攻の配置を反映
            if (room.pendingSetups.second) {
                room.pendingSetups.second.forEach(p => {
                    if (p.y === 0 && p.x !== 2) {
                        room.board[p.y][p.x] = {
                            type: p.type,
                            owner: 'second',
                            hasUsedSkill: false
                        };
                    }
                });
            }

            room.phase = 'playing';
            room.pendingSetups = null; // メモリクリア
            io.to(roomId).emit('phase-changed', room);
        } else {
            // 片方だけ完了した時点では準備完了フラグ（p1Ready / p2Ready）のみ通知
            io.to(roomId).emit('room-update', room);
        }
    });

    // 駒の移動
    socket.on('move-piece', (data) => {
        if (room.phase !== 'playing') return;

        const role = socket.id === room.player1?.id ? 'first' : socket.id === room.player2?.id ? 'second' : null;
        if (!role || role !== room.currentTurnRole) return;

        const { fromX, fromY, toX, toY } = data;
        const piece = room.board[fromY][fromX];
        if (!piece || piece.owner !== role) return;

        const target = room.board[toY][toX];

        // 相手の駒を取った場合
        if (target) {
            if (target.type === 'K') {
                // 王を取った場合はゲーム終了
                room.board[toY][toX] = piece;
                room.board[fromY][fromX] = null;
                room.phase = 'ended';
                room.winnerRole = role;
                io.to(roomId).emit('game-over', room);
                return;
            } else {
                // 通常の駒を取って手札に加える
                room.hands[role].push(target.type);
            }
        }

        // 駒を移動
        room.board[toY][toX] = piece;
        room.board[fromY][fromX] = null;

        // ターン交代
        switchTurn(room);
        io.to(roomId).emit('board-updated', room);
    });

    // 持ち駒を打つ
    socket.on('drop-piece', (data) => {
        if (room.phase !== 'playing') return;

        const role = socket.id === room.player1?.id ? 'first' : socket.id === room.player2?.id ? 'second' : null;
        if (!role || role !== room.currentTurnRole) return;

        const { type, toX, toY } = data;
        const handIndex = room.hands[role].indexOf(type);
        if (handIndex === -1) return;

        if (room.board[toY][toX] === null) {
            room.hands[role].splice(handIndex, 1);
            room.board[toY][toX] = {
                type: type,
                owner: role,
                hasUsedSkill: false
            };

            switchTurn(room);
            io.to(roomId).emit('board-updated', room);
        }
    });

    // スキル使用のリクエスト
    socket.on('use-skill', (data) => {
        if (room.phase !== 'playing') return;

        const role = socket.id === room.player1?.id ? 'first' : socket.id === room.player2?.id ? 'second' : null;
        if (!role || role !== room.currentTurnRole) return;

        const opponentRole = role === 'first' ? 'second' : 'first';

        // 相手の場に未着手の「ノブナガ」がいるか確認
        const nobunagaPos = findUnusedPieceOnBoard(room.board, opponentRole, 'N');

        room.pendingSkill = {
            userSocketId: socket.id,
            userRole: role,
            type: data.type,
            x: data.x,
            y: data.y,
            targets: data.targets
        };

        if (nobunagaPos) {
            // ノブナガ所持者（相手）へ発動するか問い合わせ
            const opponentSocketId = opponentRole === 'first' ? room.player1.id : room.player2.id;
            io.to(opponentSocketId).emit('prompt-nobunaga');
        } else {
            // ノブナガがいなければそのままスキル実行
            executeSkill(room, room.pendingSkill);
        }
    });

    // ノブナガ発動・キャンセルの応答処理
    socket.on('respond-nobunaga', (data) => {
        if (!room || !room.pendingSkill) return;

        const playerARole = room.pendingSkill.userRole;
        const playerBRole = playerARole === 'first' ? 'second' : 'first';

        if (data.cancel) {
            // 【プレイヤーBがノブナガを発動して無効化する場合】

            // 1. スキルを発動しようとして無効化された「プレイヤーAの駒」を「済」にする
            const playerAPiece = room.board[room.pendingSkill.y][room.pendingSkill.x];
            if (playerAPiece) {
                playerAPiece.hasUsedSkill = true;
            }

            // 2. 割り込み発動した「プレイヤーBのノブナガ」も「済」にする
            const nobunagaPos = findUnusedPieceOnBoard(room.board, playerBRole, 'N');
            if (nobunagaPos) {
                room.board[nobunagaPos.y][nobunagaPos.x].hasUsedSkill = true;
            }

            // 3. プレイヤーA（スキル使用側）へ通知
            io.to(room.pendingSkill.userSocketId).emit('skill-cancelled', {
                message: '相手のノブナガによりスキルが無効化されました。（スキルは消費されましたが、引き続きあなたのターンです）'
            });

            // 4. 保留を解除（※ターンは交代させずプレイヤーAのターンを継続）
            room.pendingSkill = null;

            // 両者の駒が「済」になった最新の盤面状態を全員に送信
            io.to(roomId).emit('board-updated', room);

        } else {
            // 【ノブナガを発動しない場合】通常通りスキル実行（実行後にターン交代）
            executeSkill(room, room.pendingSkill);
        }
    });

    // ロビーへ戻る
    socket.on('return-to-lobby', () => {
        room.phase = 'lobby';
        io.to(roomId).emit('returned-to-lobby');
        io.to(roomId).emit('room-update', room);
    });

    // 切断処理
    socket.on('disconnect', () => {
        if (room.player1?.id === socket.id) room.player1 = null;
        if (room.player2?.id === socket.id) room.player2 = null;
        const specIndex = room.spectators.findIndex(s => s.id === socket.id);
        if (specIndex !== -1) room.spectators.splice(specIndex, 1);

        if (room.phase !== 'lobby' && (!room.player1 || !room.player2)) {
            room.phase = 'lobby';
        }
        io.to(roomId).emit('room-update', room);
    });
});

// スキル実行ロジック
function executeSkill(room, skillData) {
    const piece = room.board[skillData.y][skillData.x];
    if (!piece) return;

    if (skillData.type === 'A') {
        // アケチ：相手の指定駒2体を持ち駒に戻す
        skillData.targets.forEach(t => {
            const targetPiece = room.board[t.y][t.x];
            if (targetPiece) {
                room.hands[skillData.userRole].push(targetPiece.type);
                room.board[t.y][t.x] = null;
            }
        });
    } else if (skillData.type === 'Y') {
        // ヨシツネ：味方2体の位置交換
        if (skillData.targets.length === 2) {
            const t1 = skillData.targets[0];
            const t2 = skillData.targets[1];
            const temp = room.board[t1.y][t1.x];
            room.board[t1.y][t1.x] = room.board[t2.y][t2.x];
            room.board[t2.y][t2.x] = temp;
        }
    }

    // スキル使用者の駒を「使用済み」にする
    piece.hasUsedSkill = true;
    room.pendingSkill = null;

    // ターン交代
    switchTurn(room);
    io.to(room.id).emit('board-updated', room);
}

// ターン交代関数
function switchTurn(room) {
    room.currentTurnRole = (room.currentTurnRole === 'first') ? 'second' : 'first';
}

// 盤面上の未使用の特定種類の駒を探すヘルパー
function findUnusedPieceOnBoard(board, owner, type) {
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 5; x++) {
            const p = board[y][x];
            if (p && p.owner === owner && p.type === type && !p.hasUsedSkill) {
                return { x, y };
            }
        }
    }
    return null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});