const socket = io();

let myId = null;
let currentRoom = null;
let myRole = null; 
let mySetupRow = null; 
let selectedHandPiece = null;

let setupPieces = ['A', 'N', 'S', 'Y']; 
let placedSetupPieces = []; 

let selectedBoardPiece = null; 
let selectedCapturedIndex = null; 
let skillTargetPieces = [];

const PIECE_DATA = {
    'K': {
        name: '王',
        skillName: 'なし',
        skillDesc: 'スキルを持ちません。',
        moves: [1, 1, 1, 1, 1, 1, 1, 1]
    },
    'A': {
        name: 'アケチ',
        skillName: '本能寺の変',
        skillDesc: '盤面の相手の駒2体を相手の持ち駒に戻す。',
        moves: [0, 1, 0, 2, 2, 2, 2, 2]
    },
    'N': {
        name: 'ノブナガ',
        skillName: '第六天魔王',
        skillDesc: '相手のスキル発動時、相手のスキルの効果を無効にする。（相手発動時に選択肢が出現）',
        moves: [1, 3, 1, 2, 2, 0, 2, 0]
    },
    'S': {
        name: 'シンゲン',
        skillName: '風林火山',
        skillDesc: '場の相手のキャラ数が自分より多いとき移動範囲増加（前＋1、左右＋1）。',
        moves: [3, 2, 3, 0, 0, 1, 1, 1]
    },
    'Y': {
        name: 'ヨシツネ',
        skillName: '牛若丸',
        skillDesc: '味方二体の場所を交換する。',
        moves: [2, 2, 2, 2, 2, 0, 2, 0]
    }
};

socket.on('connect', () => { 
    myId = socket.id; 
});

function joinPlayer() { socket.emit('join-player'); }
function joinSpectator() { socket.emit('join-spectator'); }
function leaveRoom() { socket.emit('leave-room'); }
function startGame() { socket.emit('start-game'); }
function returnToLobby() { socket.emit('return-to-lobby'); }

socket.on('room-update', (state) => {
    currentRoom = state;
    document.getElementById('p1-name').innerText = state.player1 ? state.player1.name : '（空き）';
    document.getElementById('p2-name').innerText = state.player2 ? state.player2.name : '（空き）';

    const specList = document.getElementById('spectator-list');
    specList.innerHTML = '';
    state.spectators.forEach(s => {
        const li = document.createElement('li');
        li.innerText = s.name;
        specList.appendChild(li);
    });

    const isPlayer = (state.player1?.id === myId || state.player2?.id === myId);
    document.getElementById('btn-start').style.display = (isPlayer && state.player1 && state.player2 && state.phase === 'lobby') ? 'inline-block' : 'none';

    if (currentRoom.phase === 'setup' && currentRoom.gameStarted) checkWaitStatus();
});

socket.on('game-started', (state) => {
    currentRoom = state;
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    document.getElementById('btn-return-lobby').style.display = 'none';
    document.getElementById('my-hand-container').style.display = 'none';
    document.getElementById('enemy-hand-container').style.display = 'none';

    if (state.player1?.id === myId) myRole = state.player1.role;
    else if (state.player2?.id === myId) myRole = state.player2.role;
    else myRole = 'spectator';

    mySetupRow = (myRole === 'first') ? 3 : 0;
    placedSetupPieces = [];
    setupPieces = ['A', 'N', 'S', 'Y']; 

    startSetupPhase();
});

function startSetupPhase() {
    document.getElementById('game-status').innerText = `【初期配置】手前1段に駒を配置してください (${myRole === 'first' ? '先攻' : myRole === 'second' ? '後攻' : '観戦'})`;
    if (myRole !== 'spectator') {
        document.getElementById('setup-palette').style.display = 'block';
        renderPalette();
    }
    renderSetupBoard();
}

function renderPalette() {
    const paletteEl = document.getElementById('palette-pieces');
    paletteEl.innerHTML = '';
    setupPieces.forEach((type, index) => {
        const btn = document.createElement('button');
        btn.innerText = PIECE_DATA[type].name;
        btn.className = 'palette-btn' + (selectedHandPiece === index ? ' selected' : '');
        btn.onclick = () => { 
            selectedHandPiece = index; 
            renderPalette();
            showPieceInfo(type, false);
        };
        paletteEl.appendChild(btn);
    });
    document.getElementById('btn-confirm-setup').disabled = (setupPieces.length > 0);
}

function renderTilePieceContent(piece) {
    const data = PIECE_DATA[piece.type];
    if (!data) return '';

    const badgeHtml = piece.hasUsedSkill ? `<span class="used-badge">済</span>` : '';
    const moves = data.moves;
    const gridIndices = [
        moves[0], moves[1], moves[2],
        moves[3], 'NAME',   moves[4],
        moves[5], moves[6], moves[7]
    ];

    const getDotClass = (val) => {
        if (val === 1) return 'dot-1';
        if (val === 2) return 'dot-2';
        if (val === 3) return 'dot-3';
        return '';
    };

    let gridHtml = '<div class="tile-grid">';
    gridIndices.forEach((val, idx) => {
        if (idx === 4) {
            gridHtml += `<div class="tile-cell tile-center-name"><span>${data.name}</span>${badgeHtml}</div>`;
        } else {
            const dotCls = getDotClass(val);
            const dotSpan = dotCls ? `<span class="tile-move-dot ${dotCls}"></span>` : '';
            gridHtml += `<div class="tile-cell">${dotSpan}</div>`;
        }
    });
    gridHtml += '</div>';

    return gridHtml;
}

function renderSetupBoard() {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';

    for (let vY = 0; vY < 4; vY++) {
        for (let vX = 0; vX < 5; vX++) {
            const bX = (myRole === 'second') ? 4 - vX : vX;
            const bY = (myRole === 'second') ? 3 - vY : vY;

            const tile = document.createElement('div');
            tile.className = 'tile';

            if (myRole !== 'spectator' && bY === mySetupRow && bX !== 2) {
                tile.classList.add('my-zone');
            }

            const serverPiece = currentRoom.board[bY][bX];
            if (serverPiece) {
                // 王(K)などサーバー側で公開されている駒のみ表示
                tile.innerHTML = renderTilePieceContent(serverPiece);
                if (serverPiece.owner !== myRole) tile.classList.add('enemy-piece');
            } else {
                // 自分の未決定配置駒のみ表示（相手の選択は見えない）
                const placed = placedSetupPieces.find(p => p.x === bX && p.y === bY);
                if (placed) {
                    tile.innerHTML = renderTilePieceContent({ type: placed.type, owner: myRole, hasUsedSkill: false });
                }
            }
            tile.onclick = () => onSetupTileClick(bX, bY);
            boardEl.appendChild(tile);
        }
    }
}

function onSetupTileClick(x, y) {
    if (myRole === 'spectator' || y !== mySetupRow || x === 2) return;
    const existingIndex = placedSetupPieces.findIndex(p => p.x === x && p.y === y);
    if (existingIndex !== -1) {
        const removed = placedSetupPieces.splice(existingIndex, 1)[0];
        setupPieces.push(removed.type);
        renderPalette(); renderSetupBoard(); return;
    }
    if (selectedHandPiece !== null && setupPieces[selectedHandPiece]) {
        const type = setupPieces.splice(selectedHandPiece, 1)[0];
        placedSetupPieces.push({ x, y, type });
        selectedHandPiece = null;
        renderPalette(); renderSetupBoard();
    }
}

function confirmSetup() {
    document.getElementById('setup-palette').style.display = 'none';
    socket.emit('submit-setup', placedSetupPieces);
    checkWaitStatus();
}

function checkWaitStatus() {
    const amIP1 = myId === currentRoom.player1?.id;
    const amIP2 = myId === currentRoom.player2?.id;
    if ((amIP1 && currentRoom.p1Ready && !currentRoom.p2Ready) || (amIP2 && currentRoom.p2Ready && !currentRoom.p1Ready)) {
        document.getElementById('game-status').innerText = '相手の準備完了を待っています...';
    }
}

socket.on('phase-changed', (state) => {
    currentRoom = state;
    resetSelections();
    if (myRole !== 'spectator') {
        document.getElementById('my-hand-container').style.display = 'block';
        document.getElementById('enemy-hand-container').style.display = 'block';
    }
    updateGameStatus();
    renderPlayingBoard();
});

socket.on('board-updated', (state) => {
    currentRoom = state;
    resetSelections();
    updateGameStatus();
    renderPlayingBoard();
});

socket.on('prompt-nobunaga', (data) => { 
    const pieceInfo = PIECE_DATA[data.pieceType];
    const detailEl = document.getElementById('nobunaga-skill-detail');

    if (pieceInfo && detailEl) {
        detailEl.innerHTML = `
            <div><strong>使用する駒：</strong>${pieceInfo.name}</div>
            <div><strong>スキル名：</strong>${pieceInfo.skillName}</div>
            <div><strong>スキル効果：</strong>${pieceInfo.skillDesc}</div>
        `;
    }

    document.getElementById('nobunaga-modal').style.display = 'flex'; 
});

function respondNobunaga(cancel) {
    document.getElementById('nobunaga-modal').style.display = 'none';
    socket.emit('respond-nobunaga', { cancel });
}

socket.on('skill-cancelled', (data) => { alert(data.message); });

socket.on('game-over', (state) => {
    currentRoom = state;
    resetSelections();
    const isWinner = (state.winnerRole === myRole);
    if (myRole === 'spectator') {
        document.getElementById('game-status').innerText = `【ゲーム終了】 ${state.winnerRole === 'first' ? '先攻' : '後攻'} の勝利です！`;
    } else {
        document.getElementById('game-status').innerText = isWinner ? '勝利！！' : '敗北...';
    }
    document.getElementById('btn-return-lobby').style.display = 'inline-block';
    renderPlayingBoard();
});

socket.on('returned-to-lobby', () => {
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'block';
});

function resetSelections() {
    selectedBoardPiece = null;
    selectedCapturedIndex = null;
    skillTargetPieces = [];
    document.getElementById('skill-control').style.display = 'none';
}

function updateGameStatus() {
    if (currentRoom.phase === 'ended') return;
    const isMyTurn = currentRoom.currentTurnRole === myRole;
    const turnText = currentRoom.currentTurnRole === 'first' ? '先攻' : '後攻';
    if (myRole === 'spectator') document.getElementById('game-status').innerText = `【対局中】 ${turnText} のターンです`;
    else if (isMyTurn) document.getElementById('game-status').innerText = `【あなたのターン】 駒を動かすかスキルを使用してください`;
    else document.getElementById('game-status').innerText = `【相手のターン】 相手の操作を待っています...`;
}

function getValidMoves(x, y, piece) {
    const validMoves = [];
    const dir = (piece.owner === 'first') ? -1 : 1;
    const type = piece.type;

    let shingenExtra = 0;
    if (type === 'S') {
        const myCount = countPiecesOnBoard(piece.owner);
        const enemyCount = countPiecesOnBoard(piece.owner === 'first' ? 'second' : 'first');
        if (enemyCount > myCount) shingenExtra = 1;
    }

    const checkMove = (dx, dy, maxDist) => {
        for (let step = 1; step <= maxDist; step++) {
            const nx = x + dx * step;
            const ny = y + dy * step;
            if (nx < 0 || nx >= 5 || ny < 0 || ny >= 4) break;
            const target = currentRoom.board[ny][nx];
            if (!target) {
                validMoves.push({ x: nx, y: ny });
            } else {
                if (target.owner !== piece.owner) validMoves.push({ x: nx, y: ny });
                break;
            }
        }
    };

    if (type === 'K') {
        [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dx,dy]) => checkMove(dx, dy, 1));
    } else if (type === 'A') {
        checkMove(0, dir, 1); checkMove(-1, 0, 2); checkMove(1, 0, 2); checkMove(0, -dir, 2); checkMove(-1, -dir, 2); checkMove(1, -dir, 2);
    } else if (type === 'N') {
        checkMove(0, dir, 3); checkMove(-1, dir, 1); checkMove(1, dir, 1); checkMove(-1, 0, 2); checkMove(1, 0, 2); checkMove(0, -dir, 2);
    } else if (type === 'S') {
        checkMove(0, dir, 2 + shingenExtra); checkMove(-1, dir, 3); checkMove(1, dir, 3);
        if (shingenExtra > 0) { checkMove(-1, 0, 1); checkMove(1, 0, 1); }
        checkMove(0, -dir, 1); checkMove(-1, -dir, 1); checkMove(1, -dir, 1);
    } else if (type === 'Y') {
        checkMove(0, dir, 2); checkMove(-1, dir, 2); checkMove(1, dir, 2); checkMove(-1, 0, 2); checkMove(1, 0, 2); checkMove(0, -dir, 2);
    }

    return validMoves;
}

function countPiecesOnBoard(owner) {
    let c = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) if (currentRoom.board[y][x]?.owner === owner) c++;
    return c;
}

function renderPlayingBoard() {
    renderHands();
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';

    let validMoves = [];
    if (selectedBoardPiece && currentRoom.currentTurnRole === myRole) {
        const p = currentRoom.board[selectedBoardPiece.y][selectedBoardPiece.x];
        if (p) validMoves = getValidMoves(selectedBoardPiece.x, selectedBoardPiece.y, p);
    }

    for (let vY = 0; vY < 4; vY++) {
        for (let vX = 0; vX < 5; vX++) {
            const bX = (myRole === 'second') ? 4 - vX : vX;
            const bY = (myRole === 'second') ? 3 - vY : vY;

            const tile = document.createElement('div');
            tile.className = 'tile';

            const piece = currentRoom.board[bY][bX];
            if (piece) {
                tile.innerHTML = renderTilePieceContent(piece);
                if (piece.owner !== myRole) tile.classList.add('enemy-piece');
            }

            if (selectedBoardPiece && selectedBoardPiece.x === bX && selectedBoardPiece.y === bY) {
                tile.classList.add('selected');
            }
            if (validMoves.some(m => m.x === bX && m.y === bY)) {
                tile.classList.add('movable');
            }
            if (skillTargetPieces.some(t => t.x === bX && t.y === bY)) {
                tile.classList.add('target-selected');
            }

            tile.onclick = () => onPlayingTileClick(bX, bY);
            boardEl.appendChild(tile);
        }
    }
}

function renderHands() {
    if (myRole === 'spectator') return;
    const enemyRole = (myRole === 'first') ? 'second' : 'first';
    const myHand = currentRoom.hands[myRole] || [];
    const enemyHand = currentRoom.hands[enemyRole] || [];

    const myHandEl = document.getElementById('my-hand-pieces');
    myHandEl.innerHTML = '';
    if (myHand.length === 0) myHandEl.innerText = 'なし';
    else {
        myHand.forEach((type, idx) => {
            const btn = document.createElement('button');
            btn.className = 'hand-piece-btn' + (selectedCapturedIndex === idx ? ' selected' : '');
            btn.innerText = PIECE_DATA[type].name;
            btn.onclick = () => {
                showPieceInfo(type, false);
                if (currentRoom.currentTurnRole !== myRole) return;
                selectedBoardPiece = null;
                skillTargetPieces = [];
                document.getElementById('skill-control').style.display = 'none';
                selectedCapturedIndex = (selectedCapturedIndex === idx) ? null : idx;
                renderPlayingBoard();
            };
            myHandEl.appendChild(btn);
        });
    }

    const enemyHandEl = document.getElementById('enemy-hand-pieces');
    enemyHandEl.innerHTML = '';
    if (enemyHand.length === 0) enemyHandEl.innerText = 'なし';
    else {
        enemyHand.forEach((type) => {
            const btn = document.createElement('button');
            btn.className = 'hand-piece-btn';
            btn.innerText = PIECE_DATA[type].name;
            btn.onclick = () => showPieceInfo(type, false);
            enemyHandEl.appendChild(btn);
        });
    }
}

function onPlayingTileClick(x, y) {
    if (currentRoom.phase !== 'playing') return;
    const targetPiece = currentRoom.board[y][x];

    if (targetPiece) {
        showPieceInfo(targetPiece.type, targetPiece.hasUsedSkill);
    }

    if (myRole === 'spectator' || currentRoom.currentTurnRole !== myRole) return;

    if (selectedBoardPiece && skillTargetPieces.length > 0) {
        handleSkillTargetClick(x, y);
        return;
    }

    if (selectedCapturedIndex !== null) {
        if (targetPiece === null) {
            socket.emit('drop-piece', { type: currentRoom.hands[myRole][selectedCapturedIndex], toX: x, toY: y });
            selectedCapturedIndex = null;
        }
        return;
    }

    if (selectedBoardPiece) {
        const p = currentRoom.board[selectedBoardPiece.y][selectedBoardPiece.x];
        const validMoves = getValidMoves(selectedBoardPiece.x, selectedBoardPiece.y, p);
        if (validMoves.some(m => m.x === x && m.y === y)) {
            socket.emit('move-piece', { fromX: selectedBoardPiece.x, fromY: selectedBoardPiece.y, toX: x, toY: y });
            return;
        }
    }

    if (targetPiece && targetPiece.owner === myRole) {
        selectedBoardPiece = { x, y };
        selectedCapturedIndex = null;
        skillTargetPieces = [];

        if (!targetPiece.hasUsedSkill && targetPiece.type !== 'K' && targetPiece.type !== 'N') {
            document.getElementById('skill-control').style.display = 'flex';
            document.getElementById('skill-desc').innerText = `【${PIECE_DATA[targetPiece.type].skillName}】`;
        } else {
            document.getElementById('skill-control').style.display = 'none';
        }

        renderPlayingBoard();
    }
}

function showPieceInfo(type, hasUsedSkill) {
    const data = PIECE_DATA[type];
    if (!data) return;

    const infoEl = document.getElementById('info-content');
    infoEl.className = '';

    let tagHtml = '';
    if (type === 'K') {
        tagHtml = '<span class="info-status-tag tag-none">スキルなし</span>';
    } else if (hasUsedSkill) {
        tagHtml = '<span class="info-status-tag tag-used">スキル使用済み</span>';
    } else {
        tagHtml = '<span class="info-status-tag tag-unused">スキル未使用</span>';
    }

    const getDotClass = (val) => {
        if (val === 1) return 'dot-1';
        if (val === 2) return 'dot-2';
        if (val === 3) return 'dot-3';
        return '';
    };

    const moves = data.moves;
    const gridMoves = [
        moves[0], moves[1], moves[2],
        moves[3], '駒',    moves[4],
        moves[5], moves[6], moves[7]
    ];

    let gridHtml = '<div class="move-grid">';
    gridMoves.forEach((val, idx) => {
        if (idx === 4) {
            gridHtml += `<div class="move-cell center-cell">${data.name.slice(0, 2)}</div>`;
        } else {
            const dotCls = getDotClass(val);
            const dotHtml = dotCls ? `<span class="move-dot ${dotCls}"></span>` : '';
            gridHtml += `<div class="move-cell">${dotHtml}</div>`;
        }
    });
    gridHtml += '</div>';

    infoEl.innerHTML = `
        <div class="info-piece-name">${data.name}</div>
        ${tagHtml}
        <div class="info-section-title">移動範囲</div>
        ${gridHtml}
        <div class="legend">
            <span class="legend-item"><span class="legend-dot dot-1"></span>1マス</span>
            <span class="legend-item"><span class="legend-dot dot-2"></span>2マス</span>
            <span class="legend-item"><span class="legend-dot dot-3"></span>3マス</span>
        </div>
        <div class="info-section-title">スキル：${data.skillName}</div>
        <div class="info-text">${data.skillDesc}</div>
    `;
}

function triggerSelectedSkill() {
    if (!selectedBoardPiece) return;
    const piece = currentRoom.board[selectedBoardPiece.y][selectedBoardPiece.x];
    if (!piece) return;

    if (piece.type === 'A') {
        alert('【本能寺の変】盤面の相手の駒を2体選択してください。');
        skillTargetPieces = [{ dummy: true }];
    } else if (piece.type === 'Y') {
        alert('【牛若丸】入れ替える味方の駒を2体選択してください。');
        skillTargetPieces = [{ dummy: true }];
    } else if (piece.type === 'S') {
        socket.emit('use-skill', { type: 'S', x: selectedBoardPiece.x, y: selectedBoardPiece.y, targets: [] });
    }
}

function handleSkillTargetClick(x, y) {
    const piece = currentRoom.board[selectedBoardPiece.y][selectedBoardPiece.x];
    const target = currentRoom.board[y][x];

    if (skillTargetPieces[0]?.dummy) skillTargetPieces = [];

    if (piece.type === 'A') {
        if (target && target.owner !== myRole && target.type !== 'K') {
            if (!skillTargetPieces.some(t => t.x === x && t.y === y)) skillTargetPieces.push({ x, y });
            if (skillTargetPieces.length === 2) {
                socket.emit('use-skill', { type: 'A', x: selectedBoardPiece.x, y: selectedBoardPiece.y, targets: skillTargetPieces });
            }
        }
    } else if (piece.type === 'Y') {
        if (target && target.owner === myRole) {
            if (!skillTargetPieces.some(t => t.x === x && t.y === y)) skillTargetPieces.push({ x, y });
            if (skillTargetPieces.length === 2) {
                socket.emit('use-skill', { type: 'Y', x: selectedBoardPiece.x, y: selectedBoardPiece.y, targets: skillTargetPieces });
            }
        }
    }
    renderPlayingBoard();
}

function cancelSkillSelection() {
    resetSelections();
    renderPlayingBoard();
}