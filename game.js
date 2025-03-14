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

// PeerSelector setup
const peerSelector = new PeerSelector({
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
const connections = new Map(); // Store PeerJS connections

// Initialize PeerJS
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
    // Initialize local player
    players[localPlayerId] = new Player(localPlayerId, 400, 300);
    peerSelector.insertPeer(localPlayerId, 400, 300);
});

peer.on('connection', (conn) => {
    connections.set(conn.peer, conn);
    conn.on('open', () => {
        console.log(`Connected to ${conn.peer}`);
    });
    conn.on('data', handleReceivedData);
    conn.on('close', () => {
        connections.delete(conn.peer);
        console.log(`${conn.peer} disconnected`);
    });
});

// Function to connect to another peer
window.connectToPeer = () => {
    const connectId = document.getElementById('connectId').value;
    if (connectId && connectId !== localPlayerId && !connections.has(connectId)) {
        const conn = peer.connect(connectId);
        connections.set(connectId, conn);
        conn.on('open', () => {
            console.log(`Connected to ${connectId}`);
        });
        conn.on('data', handleReceivedData);
        conn.on('close', () => {
            connections.delete(connectId);
            console.log(`${connectId} disconnected`);
        });
    }
};

// Handle incoming data
function handleReceivedData(data) {
    const { id, x, y, vx, vy, isZombie, infectionTimer, timestamp } = data;
    if (!players[id]) {
        players[id] = new Player(id, x, y, isZombie);
        peerSelector.insertPeer(id, x, y);
    }
    // Update if timestamp is newer
    if (timestamp > players[id].lastUpdate) {
        players[id].x = x;
        players[id].y = y;
        players[id].vx = vx;
        players[id].vy = vy;
        players[id].isZombie = isZombie;
        players[id].infectionTimer = infectionTimer;
        players[id].lastUpdate = timestamp;
        peerSelector.updatePeer(id, x, y, vx, vy, 1.0, 0.050); // Update TDF and latency as placeholder
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
const UPDATE_INTERVAL = 1000 / 30; // ~30 updates per second

function gameLoop(timestamp) {
    if (!localPlayerId) {
        requestAnimationFrame(gameLoop);
        return;
    }

    // **Local Physics**
    players[localPlayerId].move();
    for (let id in players) {
        if (id !== localPlayerId) {
            players[id].move();
        }
    }

    // **Collision Detection and Infection**
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

    // **Infection Timer**
    for (let id in players) {
        if (players[id].infectionTimer && Date.now() - players[id].infectionTimer >= 60000) {
            players[id].isZombie = true;
            players[id].infectionTimer = null;
        }
    }

    // **PeerSelector and P2P Updates**
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

    // **Rendering**
    ctx.clearRect(0, 0, 800, 600);
    for (let id in players) {
        players[id].draw();
    }

    requestAnimationFrame(gameLoop);
}

// Start the game loop
requestAnimationFrame(gameLoop);

// For testing: Start one player as a zombie
setTimeout(() => {
    if (localPlayerId === 'player1') { // Arbitrary choice for demo
        players[localPlayerId].isZombie = true;
    }
}, 1000);