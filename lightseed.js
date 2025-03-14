// LightSeed.js - A relatavistic P2P MMO game engine by Nicholas Gilpin

// Default configuration constants
const DEFAULT_CONFIG = {
    worldSize: 1000,    // World size in meters (square world)
    maxDepth: 5,        // Maximum depth of the quadtree
    capacity: 4,        // Maximum points per quadtree node before subdividing
    nCells: 2,          // Maximum cells a player can move per time period
    deltaT: 1,          // Time period in seconds
    sigma: 0.1,         // TDF similarity scale
    d0: 100,            // Distance scale in meters
    v0: 5,              // Speed scale in m/s
    beta: 1.0,          // Speed term multiplier
    epsilon: 0.05       // Random selection factor
};

// Helper functions for vector operations
function norm(vec) {
    return Math.sqrt(vec[0] ** 2 + vec[1] ** 2);
}

function dot(vec1, vec2) {
    return vec1[0] * vec2[0] + vec1[1] * vec2[1];
}

function subtract(vec1, vec2) {
    return [vec1[0] - vec2[0], vec1[1] - vec2[1]];
}

// QuadTree class for spatial partitioning
class QuadTree {
    constructor(boundary, capacity) {
        this.boundary = boundary; // { x, y, width, height }
        this.capacity = capacity; // Max points before subdividing
        this.points = [];         // Array of { x, y, idx }
        this.divided = false;
    }

    insert(point) {
        if (!this.inBoundary(point)) return false;

        if (this.points.length < this.capacity && !this.divided) {
            this.points.push(point);
            return true;
        }

        if (!this.divided) this.subdivide();

        return (
            this.northwest.insert(point) ||
            this.northeast.insert(point) ||
            this.southwest.insert(point) ||
            this.southeast.insert(point)
        );
    }

    subdivide() {
        const { x, y, width, height } = this.boundary;
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        this.northwest = new QuadTree(
            { x, y, width: halfWidth, height: halfHeight },
            this.capacity
        );
        this.northeast = new QuadTree(
            { x: x + halfWidth, y, width: halfWidth, height: halfHeight },
            this.capacity
        );
        this.southwest = new QuadTree(
            { x, y: y + halfHeight, width: halfWidth, height: halfHeight },
            this.capacity
        );
        this.southeast = new QuadTree(
            { x: x + halfWidth, y: y + halfHeight, width: halfWidth, height: halfHeight },
            this.capacity
        );
        this.divided = true;
    }

    inBoundary(point) {
        const { x, y, width, height } = this.boundary;
        return point.x >= x && point.x < x + width && point.y >= y && point.y < y + height;
    }

    query(range, found = []) {
        if (!this.intersects(range)) return found;

        for (let p of this.points) {
            if (this.pointInRange(p, range)) found.push(p);
        }

        if (this.divided) {
            this.northwest.query(range, found);
            this.northeast.query(range, found);
            this.southwest.query(range, found);
            this.southeast.query(range, found);
        }

        return found;
    }

    intersects(range) {
        const { x, y, width, height } = this.boundary;
        const { cx, cy, r } = range;
        const closestX = Math.max(x, Math.min(cx, x + width));
        const closestY = Math.max(y, Math.min(cy, y + height));
        const dx = closestX - cx;
        const dy = closestY - cy;
        return (dx * dx + dy * dy) <= (r * r);
    }

    pointInRange(point, range) {
        const { cx, cy, r } = range;
        const dx = point.x - cx;
        const dy = point.y - cy;
        return (dx * dx + dy * dy) <= (r * r);
    }
}

// LightSeed class for managing peers and selecting update recipients
class LightSeed {
    constructor(config = {}) {
        // Merge default config with user-provided config
        this.config = { ...DEFAULT_CONFIG, ...config };

        this.worldSize = this.config.worldSize;
        this.maxDepth = this.config.maxDepth;
        this.capacity = this.config.capacity;
        this.nCells = this.config.nCells;
        this.deltaT = this.config.deltaT;
        this.sigma = this.config.sigma;
        this.d0 = this.config.d0;
        this.v0 = this.config.v0;
        this.beta = this.config.beta;
        this.epsilon = this.config.epsilon;

        // Derived constants
        this.cellSize = this.worldSize / Math.pow(2, this.maxDepth);
        this.c = this.nCells * this.cellSize; // "Speed of light" in meters per time period

        // Initialize quadtree
        this.boundary = { x: 0, y: 0, width: this.worldSize, height: this.worldSize };
        this.quadtree = new QuadTree(this.boundary, this.capacity);

        // Peer data storage
        this.peers = []; // Array of { idx, x, y, vx, vy, tdf, latency }
    }

    /**
     * Insert a peer into the quadtree with initial position
     * @param {number} idx - Peer index
     * @param {number} x - X position
     * @param {number} y - Y position
     */
    insertPeer(idx, x, y) {
        const point = { x, y, idx };
        this.quadtree.insert(point);
        this.peers[idx] = { idx, x, y, vx: 0, vy: 0, tdf: 1.0, latency: 0 };
    }

    /**
     * Update peer data (position, velocity, TDF, latency)
     * @param {number} idx - Peer index
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {number} vx - X velocity
     * @param {number} vy - Y velocity
     * @param {number} tdf - Time dilation factor
     * @param {number} latency - Network latency in seconds
     */
    updatePeer(idx, x, y, vx, vy, tdf, latency) {
        this.peers[idx] = { idx, x, y, vx, vy, tdf, latency };
        // Rebuild quadtree (simple approach; optimize as needed)
        this.quadtree = new QuadTree(this.boundary, this.capacity);
        this.peers.forEach(peer => {
            if (peer) this.quadtree.insert({ x: peer.x, y: peer.y, idx: peer.idx });
        });
    }

    /**
     * Select peers to send updates to, based on sender and player indices
     * @param {number} senderIdx - Index of the peer sending updates
     * @param {number} playerIdx - Index of the player being updated
     * @returns {Array} List of { peerIdx, prob } objects
     */
    selectPeers(senderIdx, playerIdx) {
        const sender = this.peers[senderIdx];
        if (!sender) return [];

        // Query peers within "speed of light" range
        const range = { cx: sender.x, cy: sender.y, r: this.c * this.deltaT };
        const peersInRange = this.quadtree.query(range).map(p => p.idx);

        const weights = [];
        for (let j of peersInRange) {
            if (j === senderIdx) continue; // Skip sender
            const peer = this.peers[j];
            if (!peer) continue;

            // Latency term: inversely proportional to latency
            const latencyTerm = 1 / Math.max(peer.latency, 0.001); // Avoid division by zero

            // TDF similarity term: Gaussian similarity
            const tdfDiff = sender.tdf - peer.tdf;
            const tdfTerm = Math.exp(-(tdfDiff ** 2) / (2 * this.sigma ** 2));

            // Distance term: inverse distance between player and peer
            const pk = [this.peers[playerIdx].x, this.peers[playerIdx].y];
            const pj = [peer.x, peer.y];
            const relPosition = subtract(pk, pj);
            const dkj = norm(relPosition);
            const distanceTerm = 1 / (1 + dkj / this.d0);

            // Speed term: relative closing speed between player and peer
            let skj = 0;
            if (dkj > 0) {
                const vk = [this.peers[playerIdx].vx, this.peers[playerIdx].vy];
                const vj = [peer.vx, peer.vy];
                const relVelocity = subtract(vk, vj);
                skj = Math.max(0, -dot(relVelocity, relPosition) / dkj);
            }
            const speedTerm = 1 + this.beta * (skj / this.v0);

            // Combined weight
            const w = latencyTerm * tdfTerm * distanceTerm * speedTerm;
            weights.push(w);
        }

        // Normalize weights into probabilities
        const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1; // Avoid division by zero
        const probs = weights.map(w => 
            (1 - this.epsilon) * (w / totalWeight) + this.epsilon / (this.peers.length || 1)
        );

        // Return peers with their selection probabilities
        return peersInRange
            .filter((_, i) => weights[i] !== undefined)
            .map((peerIdx, i) => ({ peerIdx, prob: probs[i] }));
    }
}

// Export the class (optional, depending on environment)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LightSeed;
}

// Example usage (commented out for library use)
/*
const LightSeed = new LightSeed();
LightSeed.insertPeer(0, 100, 100); // Sender/Player 0
LightSeed.insertPeer(1, 150, 100); // Peer 1
LightSeed.insertPeer(2, 100, 200); // Peer 2
LightSeed.insertPeer(3, 500, 500); // Peer 3 (out of range)

LightSeed.updatePeer(0, 100, 100, 5, 0, 0.9, 0.050);
LightSeed.updatePeer(1, 150, 100, -5, 0, 0.85, 0.050);
LightSeed.updatePeer(2, 100, 200, 0, -3, 0.92, 0.100);
LightSeed.updatePeer(3, 500, 500, 0, 0, 0.8, 0.200);

const selectedPeers = LightSeed.selectPeers(0, 0);
console.log("Selected peers with probabilities:", selectedPeers);
*/