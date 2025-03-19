// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Player class to manage state
class Player {
    constructor(id, x, y, isZombie = false) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.isZombie = isZombie;
        this.infectionTimer = null;
        this.lastUpdate = 0;
    }

    move() {
        this.x += this.vx;
        this.y += this.vy;
        this.x = Math.max(0, Math.min(800, this.x));
        this.y = Math.max(0, Math.min(600, this.y));
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = this.isZombie ? 'green' : 'black';
        ctx.fill();
        ctx.closePath();
    }
}

// PeerSelector (LightSeed) setup
const peerSelector = new LightSeed({
    worldSize: 800,
    maxDepth: 5,
    capacity: 4,
    nCells: 2,
    deltaT: 1,
    sigma: 0.1,
    d0: 100,
    v0: 5,
    beta: 1.0,
    epsilon: 0.05
});

// Game state
const players = {};
let localPlayerId;
const connections = new Map();

// Initialize PeerJS with dynamic ID
const peer = new Peer({
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true
});

peer.on('open', (id) => {
    localPlayerId = id;
    document.getElementById('peerId').textContent = id;
    console.log(`Local peer ID: ${id}`);
    players[localPlayerId] = new Player(localPlayerId, 400, 300);
    peerSelector.insertPeer(localPlayerId, 400, 300);
    initializeMatchmaking(id);
});

peer.on('connection', (conn) => {
    connections.set(conn.peer, conn);
    conn.on('open', () => {
        console.log(`Connected to ${conn.peer}`);
        sendInitialState(conn.peer);
    });
    conn.on('data', handleReceivedData);
    conn.on('close', () => {
        connections.delete(conn.peer);
        console.log(`${conn.peer} disconnected`);
    });
});

// Matchmaking via WebSocket
const MATCHMAKING_URL = 'ws://localhost:8082';
const ws = new WebSocket(MATCHMAKING_URL);

function initializeMatchmaking(peerId) {
    ws.onopen = () => {
        console.log('Connected to matchmaking');
        ws.send(JSON.stringify({ type: 'register', peerId }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'peerList') {
            connectToPeers(data.peers);
        }
    };

    ws.onerror = (err) => {
        console.error('Matchmaking error:', err);
    };
}

function connectToPeers(peerList) {
    peerList.forEach((peerId) => {
        if (peerId !== localPlayerId && !connections.has(peerId)) {
            const conn = peer.connect(peerId);
            connections.set(peerId, conn);
            conn.on('open', () => {
                console.log(`Connected to ${peerId}`);
                sendInitialState(peerId);
            });
            conn.on('data', handleReceivedData);
            conn.on('close', () => {
                connections.delete(peerId);
                console.log(`${peerId} disconnected`);
            });
        }
    });
}

// Send initial state to a peer
function sendInitialState(peerId) {
    const localPlayer = players[localPlayerId];
    if (localPlayer) {
        sendUpdate(peerId, {
            id: localPlayerId,
            x: localPlayer.x,
            y: localPlayer.y,
            vx: localPlayer.vx,
            vy: localPlayer.vy,
            isZombie: localPlayer.isZombie,
            infectionTimer: localPlayer.infectionTimer,
            timestamp: Date.now()
        });
    }
}

// Handle incoming data
function handleReceivedData(data) {
    const { id, x, y, vx, vy, isZombie, infectionTimer, timestamp } = data;
    if (!players[id]) {
        players[id] = new Player(id, x, y, isZombie);
        peerSelector.insertPeer(id, x, y);
        console.log(`Added new player ${id} at (${x}, ${y})`);
    }
    if (timestamp > players[id].lastUpdate) {
        players[id].x = x;
        players[id].y = y;
        players[id].vx = vx;
        players[id].vy = vy;
        players[id].isZombie = isZombie;
        players[id].infectionTimer = infectionTimer;
        players[id].lastUpdate = timestamp;
        peerSelector.updatePeer(id, x, y, vx, vy, 1.0, 0.050);
    }
}

// Send update to a specific peer
function sendUpdate(peerId, data) {
    const conn = connections.get(peerId);
    if (conn && conn.open) {
        conn.send(data);
    }
}

// Input handling
document.addEventListener('keydown', (e) => {
    if (!players[localPlayerId]) return;
    switch (e.key) {
        case 'ArrowUp': players[localPlayerId].vy = -2; break;
        case 'ArrowDown': players[localPlayerId].vy = 2; break;
        case 'ArrowLeft': players[localPlayerId].vx = -2; break;
        case 'ArrowRight': players[localPlayerId].vx = 2; break;
    }
});

document.addEventListener('keyup', (e) => {
    if (!players[localPlayerId]) return;
    switch (e.key) {
        case 'ArrowUp':
        case 'ArrowDown': players[localPlayerId].vy = 0; break;
        case 'ArrowLeft':
        case 'ArrowRight': players[localPlayerId].vx = 0; break;
    }
});

// Game loop
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 1000 / 30;

function gameLoop(timestamp) {
    if (!localPlayerId) {
        requestAnimationFrame(gameLoop);
        return;
    }

    // Local Physics
    players[localPlayerId].move();
    for (let id in players) {
        if (id !== localPlayerId) {
            players[id].move();
        }
    }

    // Collision Detection and Infection
    for (let id in players) {
        if (id !== localPlayerId && players[id].isZombie && !players[localPlayerId].isZombie) {
            const dx = players[localPlayerId].x - players[id].x;
            const dy = players[localPlayerId].y - players[id].y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 20) {
                players[localPlayerId].infectionTimer = Date.now();
            }
        }
    }

    // Infection Timer
    for (let id in players) {
        if (players[id].infectionTimer && Date.now() - players[id].infectionTimer >= 60000) {
            players[id].isZombie = true;
            players[id].infectionTimer = null;
        }
    }

    // PeerSelector and P2P Updates
    if (timestamp - lastUpdateTime >= UPDATE_INTERVAL) {
        for (let id in players) {
            peerSelector.updatePeer(id, players[id].x, players[id].y, players[id].vx, players[id].vy, 1.0, 0.050);
        }

        const selectedPeers = peerSelector.selectPeers(localPlayerId, localPlayerId);
        selectedPeers.forEach(({ peerIdx, prob }) => {
            if (Math.random() < prob && connections.has(peerIdx)) {
                sendUpdate(peerIdx, {
                    id: localPlayerId,
                    x: players[localPlayerId].x,
                    y: players[localPlayerId].y,
                    vx: players[localPlayerId].vx,
                    vy: players[localPlayerId].vy,
                    isZombie: players[localPlayerId].isZombie,
                    infectionTimer: players[localPlayerId].infectionTimer,
                    timestamp: Date.now()
                });
            }
        });
        lastUpdateTime = timestamp;
    }

    // Rendering
    ctx.clearRect(0, 0, 800, 600);
    for (let id in players) {
        players[id].draw();
    }

    requestAnimationFrame(gameLoop);
}

// Start the game loop
requestAnimationFrame(gameLoop);

// Randomly assign one player as a zombie
setTimeout(() => {
    if (localPlayerId && Math.random() < 0.5) {
        players[localPlayerId].isZombie = true;
        console.log(`${localPlayerId} starts as a zombie`);
    }
}, 1000);

// Debug printout for number of users (browser only)
if (typeof window !== 'undefined') {
    setInterval(() => {
        const numUsers = Object.keys(players).length;
        console.log(`[${localPlayerId}] Current number of users: ${numUsers}`);
    }, 5000); // Every 5 seconds
}
