const socket = io();

let myId = null;
let currentRoom = null;
let myRole = null; 
let selectedHandPiece = null;

let setupPieces = ['A', 'N', 'S', 'Y', 'KE', 'YOR', 'SAI', 'RYO'];
let placedSetupPieces = []; 

let selectedBoardPiece = null; 
let selectedCapturedIndex = null; 
let skillTargetPieces = [];

const PIECE_DATA = {
    'K': { name: '王', skillName: 'なし', skillDesc: 'スキルを持ちません。', moves: [1, 1, 1, 1, 1, 1, 1, 1] },
    'A': { name: 'アケチ', skillName: '本能寺の変', skillDesc: '盤面の相手の駒2体を相手の持ち駒に戻す。', moves: [0, 1, 0, 2, 2, 2, 2, 2] },
    'N': { name: 'ノブナガ', skillName: '第六天魔王', skillDesc: '相手のスキル発動時、相手のスキルの効果を無効にする。（相手発動時に選択肢が出現）', moves: [1, 3, 1, 2, 2, 0, 2, 0] },
    'S': { name: 'シンゲン', skillName: '風林火山', skillDesc: '場の相手のキャラ数が自分より多いときにスキル発動可能。移動範囲増加（←↑→+1）。', moves: [3, 2, 3, 0, 0, 1, 1, 1] },
    'Y': { name: 'ヨシツネ', skillName: '牛若丸', skillDesc: '味方二体の場所を交換する。', moves: [2, 2, 2, 2, 2, 0, 2, 0] },
    'KE': { name: 'ケンシン', skillName: '毘沙門天', skillDesc: '相手一体をスキル封印状態にする。（スキル使用不可・移動は可能）', moves: [2, 1, 3, 3, 0, 2, 0, 2] },
    'YOR': { name: 'ヨリトモ', skillName: '1192つくろう', skillDesc: '盤面の空きマスに「うんち（障害物）」を1つ置く。場にヨシツネがいれば2つ置く。', moves: [0, 1, 0, 1, 1, 3, 3, 3] },
    'SAI': { name: 'サイゴウ', skillName: 'おいどん', skillDesc: '好きな場所にワープする。', moves: [0, 2, 1, 1, 3, 2, 1, 0] },
    'RYO': { name: 'リョウマ', skillName: '日本の夜明けは近いぜよ', skillDesc: '相手一体を好きな場所にワープさせる。', moves: [3, 0, 3, 1, 1, 1, 3, 1] },
    'UNCHI': { name: 'うんち', skillName: 'なし', skillDesc: '障害物。キャラクターはここを通ることができず、入ることもできません。', moves: [0, 0, 0, 0, 0, 0, 0, 0] }
};

socket.on('connect', () => { 
    myId = socket.id; 
});

function joinPlayer() { socket.emit('join-player'); }
function joinSpectator() { socket.emit('join-spectator'); }

function leaveRoom() { 
    socket.emit('leave-room'); 
    currentRoom = null;
    myRole = null;
    resetSelections();

    // 画面切り替え：ロビー・ゲーム画面を閉じて部屋選択画面を表示
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'none';
    const roomSelectEl = document.getElementById('room-select-screen');
    if (roomSelectEl) roomSelectEl.style.display = 'block';
}

function startGame() { socket.emit('start-game'); }
function returnToLobby() { socket.emit('return-to-lobby'); }

socket.on('room-update', (state) => {
    currentRoom = state;

    // 自身の役割を判定
    if (state.player1?.id === myId) myRole = state.player1.role;
    else if (state.player2?.id === myId) myRole = state.player2.role;
    else if (state.spectators?.some(s => s.id === myId)) myRole = 'spectator';
    else myRole = null;

    if (!myRole) return;

    // ロビー画面表示の更新
    document.getElementById('p1-name').innerText = state.player1 ? state.player1.name : '（空き）';
    document.getElementById('p2-name').innerText = state.player2 ? state.player2.name : '（空き）';

    const specList = document.getElementById('spectator-list');
    if (specList) {
        specList.innerHTML = '';
        state.spectators.forEach(s => {
            const li = document.createElement('li');
            li.innerText = s.name;
            specList.appendChild(li);
        });
    }

    const isPlayer = (state.player1?.id === myId || state.player2?.id === myId);
    const btnStart = document.getElementById('btn-start');
    if (btnStart) {
        btnStart.style.display = (isPlayer && state.player1 && state.player2 && state.phase === 'lobby') ? 'inline-block' : 'none';
    }

    // 途中観戦の対応：観戦者が進行中の部屋に入った場合
    if (myRole === 'spectator' && state.phase !== 'lobby') {
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'block';

        if (state.phase === 'setup') {
            startSetupPhase();
        } else if (state.phase === 'playing' || state.phase === 'ended') {
            document.getElementById('setup-palette').style.display = 'none';
            document.getElementById('my-hand-container').style.display = 'block';
            document.getElementById('enemy-hand-container').style.display = 'block';
            updateGameStatus();
            renderPlayingBoard();
        }
    } else if (currentRoom.phase === 'setup' && currentRoom.gameStarted) {
        checkWaitStatus();
    }
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

    placedSetupPieces = [];
    setupPieces = ['A', 'N', 'S', 'Y', 'KE', 'YOR']; 

    startSetupPhase();
});

function startSetupPhase() {
    if (myRole === 'spectator') {
        document.getElementById('game-status').innerText = '準備中';
        document.getElementById('setup-palette').style.display = 'none';
    } else {
        document.getElementById('game-status').innerText = `【初期配置】 (${myRole === 'first' ? '先攻' : '後攻'})`;
        const paletteContainer = document.getElementById('setup-palette');
        paletteContainer.style.display = 'block';

        // 対象の案内文を取得し、1つ目だけ表示を残して2つ目以降を非表示にする
        const guideElements = Array.from(paletteContainer.querySelectorAll('p, h3, h4, span, div'))
            .filter(el => el.id !== 'palette-pieces' && el.innerText.includes('手持ちの駒を選び'));

        guideElements.forEach((el, index) => {
            if (index === 0) {
                el.style.display = ''; // 1つ目は表示を維持
            } else {
                el.style.display = 'none'; // 2つ目以降の重複文のみ削除
            }
        });

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
            showPieceInfo(type, false, false);
        };
        paletteEl.appendChild(btn);
    });
    
    document.getElementById('btn-confirm-setup').disabled = (placedSetupPieces.length !== 4);
}

function isSetupZone(x, y, role) {
    if (role === 'first') return (y === 4 && x !== 2);
    if (role === 'second') return (y === 0 && x !== 2);
    return false;
}

function getPieceMoves(type, hasUsedSkill) {
    const moves = [...PIECE_DATA[type].moves];
    if (type === 'S' && hasUsedSkill) {
        moves[1] = 3; 
        moves[3] = 1; 
        moves[4] = 1; 
    }
    return moves;
}

function renderTilePieceContent(piece) {
    if (piece.type === 'UNCHI') {
        return '<div class="tile-grid"><div class="tile-cell tile-center-name" style="grid-column: 1/4; grid-row: 1/4; font-size: 22px;">💩</div></div>';
    }

    const data = PIECE_DATA[piece.type];
    if (!data) return '';

    let badgeHtml = '';
    if (piece.isSealed) {
        badgeHtml = `<span class="sealed-badge">封</span>`;
    } else if (piece.hasUsedSkill) {
        badgeHtml = `<span class="used-badge">済</span>`;
    }

    const moves = getPieceMoves(piece.type, piece.hasUsedSkill);
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

    for (let vY = 0; vY < 5; vY++) {
        for (let vX = 0; vX < 5; vX++) {
            const bX = (myRole === 'second') ? 4 - vX : vX;
            const bY = (myRole === 'second') ? 4 - vY : vY;

            const tile = document.createElement('div');
            tile.className = 'tile';

            if (myRole !== 'spectator' && isSetupZone(bX, bY, myRole)) {
                tile.classList.add('my-zone');
            }

            const serverPiece = currentRoom.board[bY][bX];
            if (serverPiece) {
                tile.innerHTML = renderTilePieceContent(serverPiece);
                const isEnemy = (myRole === 'second') ? (serverPiece.owner === 'first') : (serverPiece.owner === 'second');
                if (isEnemy && serverPiece.type !== 'UNCHI') tile.classList.add('enemy-piece');
            } else {
                const placed = placedSetupPieces.find(p => p.x === bX && p.y === bY);
                if (placed) {
                    tile.innerHTML = renderTilePieceContent({ type: placed.type, owner: myRole, hasUsedSkill: false, isSealed: false });
                }
            }
            tile.onclick = () => onSetupTileClick(bX, bY);
            boardEl.appendChild(tile);
        }
    }
}

function onSetupTileClick(x, y) {
    if (myRole === 'spectator' || !isSetupZone(x, y, myRole)) return;
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
    if (myRole === 'spectator') return;
    const amIP1 = myId === currentRoom.player1?.id;
    const amIP2 = myId === currentRoom.player2?.id;
    if ((amIP1 && currentRoom.p1Ready && !currentRoom.p2Ready) || (amIP2 && currentRoom.p2Ready && !currentRoom.p1Ready)) {
        document.getElementById('game-status').innerText = '相手の準備完了を待っています...';
    }
}

socket.on('phase-changed', (state) => {
    currentRoom = state;
    resetSelections();
    document.getElementById('my-hand-container').style.display = 'block';
    document.getElementById('enemy-hand-container').style.display = 'block';
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

    if (myRole === 'spectator') {
        if (currentRoom.phase === 'setup') {
            document.getElementById('game-status').innerText = '準備中';
        } else if (currentRoom.currentTurnRole === 'first') {
            document.getElementById('game-status').innerText = '先攻のターンです';
        } else {
            document.getElementById('game-status').innerText = '後攻のターンです';
        }
    } else {
        const isMyTurn = currentRoom.currentTurnRole === myRole;
        if (isMyTurn) {
            document.getElementById('game-status').innerText = `【あなたのターン】 駒を動かすかスキルを使用してください`;
        } else {
            document.getElementById('game-status').innerText = `【相手のターン】 相手の操作を待っています...`;
        }
    }
}

function checkPieceOnBoard(pieceType) {
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            if (currentRoom.board[r][c]?.type === pieceType) return true;
        }
    }
    return false;
}

function getValidMoves(x, y, piece) {
    const validMoves = [];
    const dir = (piece.owner === 'first') ? -1 : 1;
    const type = piece.type;

    let shingenExtra = (type === 'S' && piece.hasUsedSkill) ? 1 : 0;

    const checkMove = (dx, dy, maxDist) => {
        for (let step = 1; step <= maxDist; step++) {
            const nx = x + dx * step;
            const ny = y + dy * step;
            if (nx < 0 || nx >= 5 || ny < 0 || ny >= 5) break;
            const target = currentRoom.board[ny][nx];
            if (!target) {
                validMoves.push({ x: nx, y: ny });
            } else if (target.type === 'UNCHI') {
                break;
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
    } else if (type === 'KE') {
        checkMove(-1, dir, 2);  
        checkMove(0, dir, 1);   
        checkMove(1, dir, 3);   
        checkMove(-1, 0, 3);    
        checkMove(-1, -dir, 2); 
        checkMove(1, -dir, 2);  
    } else if (type === 'YOR') {
        checkMove(0, dir, 1);    
        checkMove(-1, 0, 1);   
        checkMove(1, 0, 1);    
        checkMove(-1, -dir, 3);
        checkMove(0, -dir, 3); 
        checkMove(1, -dir, 3); 
    } else if (type === 'SAI') {
        checkMove(0, dir, 2);   // 前 2
        checkMove(1, dir, 1);   // 右前 1
        checkMove(-1, 0, 1);    // 左 1
        checkMove(1, 0, 3);     // 右 3
        checkMove(-1, -dir, 2); // 左下 2
        checkMove(0, -dir, 1);  // 下 1
    } else if (type === 'RYO') {
        checkMove(-1, dir, 3);  // 左前 3
        checkMove(1, dir, 3);   // 右前 3
        checkMove(-1, 0, 1);    // 左 1
        checkMove(1, 0, 1);     // 右 1
        checkMove(-1, -dir, 1); // 左下 1
        checkMove(0, -dir, 3);  // 下 3
        checkMove(1, -dir, 1);  // 右下 1
    }

    return validMoves;
}

function countPiecesOnBoard(owner) {
    let c = 0;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (currentRoom.board[y][x]?.owner === owner) c++;
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

    for (let vY = 0; vY < 5; vY++) {
        for (let vX = 0; vX < 5; vX++) {
            const bX = (myRole === 'second') ? 4 - vX : vX;
            const bY = (myRole === 'second') ? 4 - vY : vY;

            const tile = document.createElement('div');
            tile.className = 'tile';

            const piece = currentRoom.board[bY][bX];
            if (piece) {
                tile.innerHTML = renderTilePieceContent(piece);
                const isEnemy = (myRole === 'second') ? (piece.owner === 'first') : (piece.owner === 'second');
                if (isEnemy && piece.type !== 'UNCHI') tile.classList.add('enemy-piece');
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
    let myHandRole = myRole;
    let enemyHandRole = (myRole === 'first') ? 'second' : 'first';

    if (myRole === 'spectator') {
        myHandRole = 'first';
        enemyHandRole = 'second';
    }

    const myHand = currentRoom.hands[myHandRole] || [];
    const enemyHand = currentRoom.hands[enemyHandRole] || [];

    const myHandEl = document.getElementById('my-hand-pieces');
    myHandEl.innerHTML = '';
    if (myHand.length === 0) myHandEl.innerText = 'なし';
    else {
        myHand.forEach((type, idx) => {
            const btn = document.createElement('button');
            btn.className = 'hand-piece-btn' + (selectedCapturedIndex === idx && myRole !== 'spectator' ? ' selected' : '');
            btn.innerText = PIECE_DATA[type].name;
            btn.onclick = () => {
                showPieceInfo(type, false, false);
                if (myRole === 'spectator' || currentRoom.currentTurnRole !== myRole) return;
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
            btn.onclick = () => showPieceInfo(type, false, false);
            enemyHandEl.appendChild(btn);
        });
    }
}

function onPlayingTileClick(x, y) {
    if (currentRoom.phase !== 'playing') return;
    const targetPiece = currentRoom.board[y][x];

    if (targetPiece) {
        showPieceInfo(targetPiece.type, targetPiece.hasUsedSkill, targetPiece.isSealed);
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

        if (!targetPiece.hasUsedSkill && !targetPiece.isSealed && targetPiece.type !== 'K' && targetPiece.type !== 'N') {
            document.getElementById('skill-control').style.display = 'flex';
            document.getElementById('skill-desc').innerText = `【${PIECE_DATA[targetPiece.type].skillName}】`;
        } else {
            document.getElementById('skill-control').style.display = 'none';
        }

        renderPlayingBoard();
    }
}

function showPieceInfo(type, hasUsedSkill, isSealed) {
    const data = PIECE_DATA[type];
    if (!data) return;

    const infoEl = document.getElementById('info-content');
    infoEl.className = '';

    let tagHtml = '';
    if (type === 'K' || type === 'UNCHI') {
        tagHtml = '<span class="info-status-tag tag-none">スキルなし</span>';
    } else if (isSealed) {
        tagHtml = '<span class="info-status-tag tag-used" style="background-color: #7b1fa2;">スキル封印中</span>';
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

    const moves = getPieceMoves(type, hasUsedSkill);
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
    } else if (piece.type === 'KE') {
        alert('【毘沙門天】スキルを封印する相手の駒を1体選択してください。');
        skillTargetPieces = [{ dummy: true }];
    } else if (piece.type === 'S') {
        const myCount = countPiecesOnBoard(piece.owner);
        const enemyCount = countPiecesOnBoard(piece.owner === 'first' ? 'second' : 'first');
        if (enemyCount > myCount) {
            socket.emit('use-skill', { type: 'S', x: selectedBoardPiece.x, y: selectedBoardPiece.y, targets: [] });
        } else {
            alert('【風林火山】相手のキャラ数が自分より多くないため、スキルを発動できません。');
        }
    } else if (piece.type === 'YOR') {
        const hasYoshitsune = checkPieceOnBoard('Y');
        const targetCount = hasYoshitsune ? 2 : 1;
        alert(`【1192つくろう】空いているマスを ${targetCount} 箇所選択してください。${hasYoshitsune ? '（場にヨシツネがいるため2つ置けます）' : ''}`);
        skillTargetPieces = [{ dummy: true }];
    } else if (piece.type === 'SAI') {
        alert('【おいどん】移動先の空きマスを選択してください。');
        skillTargetPieces = [{ dummy: true }];
    } else if (piece.type === 'RYO') {
        alert('【日本の夜明けは近いぜよ】ワープさせる相手の駒を1体選び、次に移動先の空きマスを選択してください。');
        skillTargetPieces = [{ dummy: true }];
    }
}

function handleSkillTargetClick(x, y) {
    const piece = currentRoom.board[selectedBoardPiece.y][selectedBoardPiece.x];
    const target = currentRoom.board[y][x];

    if (skillTargetPieces[0]?.dummy) skillTargetPieces = [];

    if (piece.type === 'A') {
        if (target && target.owner !== myRole && target.type !== 'K' && target.type !== 'UNCHI') {
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
    } else if (piece.type === 'KE') {
        if (target && target.owner !== myRole && target.type !== 'K' && target.type !== 'UNCHI') {
            socket.emit('use-skill', { type: 'KE', x: selectedBoardPiece.x, y: selectedBoardPiece.y, targets: [{ x, y }] });
        }
    } else if (piece.type === 'YOR') {
        const hasYoshitsune = checkPieceOnBoard('Y');
        const maxTargets = hasYoshitsune ? 2 : 1;
        if (target === null) {
            if (!skillTargetPieces.some(t => t.x === x && t.y === y)) skillTargetPieces.push({ x, y });
            if (skillTargetPieces.length === maxTargets) {
                socket.emit('use-skill', { type: 'YOR', x: selectedBoardPiece.x, y: selectedBoardPiece.y, targets: skillTargetPieces });
            }
        }
    } else if (piece.type === 'SAI') {
        // サイゴウ：移動先（空きマス）を1つ選択
        if (target === null) {
            socket.emit('use-skill', { type: 'SAI', x: selectedBoardPiece.x, y: selectedBoardPiece.y, targets: [{ x, y }] });
        }
    } else if (piece.type === 'RYO') {
        // リョウマ：1人目＝相手の駒、2人目＝移動先の空きマス
        if (skillTargetPieces.length === 0) {
            if (target && target.owner !== myRole && target.type !== 'K' && target.type !== 'UNCHI') {
                skillTargetPieces.push({ x, y });
            }
        } else if (skillTargetPieces.length === 1) {
            if (target === null) {
                skillTargetPieces.push({ x, y });
                socket.emit('use-skill', { type: 'RYO', x: selectedBoardPiece.x, y: selectedBoardPiece.y, targets: skillTargetPieces });
            }
        }
    }
    renderPlayingBoard();
}

function cancelSkillSelection() {
    resetSelections();
    renderPlayingBoard();
}