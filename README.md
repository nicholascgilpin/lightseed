# lightseed
A peer to peer relativistic game engine

## Usage
1. Initialization: Create a PeerSelector instance with optional configuration.
2. Insert Peers: Add peers with their initial positions.
3. Update Peer Data: Update positions, velocities, TDFs, and latencies as the game state changes.
4. Select Peers: Call selectPeers to get a list of peers to send updates to, with selection probabilities.

## Introduction

Managing Latency in a Peer-to-Peer MMO Game Engine

In a peer-to-peer (P2P) massively multiplayer online (MMO) game, players connect directly to each other to share game state—like player positions and actions—using a gossip protocol, where updates spread by peers randomly sharing with others. However, network delays (latency) can cause problems: if one player’s update arrives late, another player might see outdated or jerky movements, ruining the experience. To solve this, we use a clever system inspired by concepts from physics, but adapted for software engineers to understand without needing to know relativity.

How It Works: Spatial Filtering with a Quadtree

First, we manage who gets updates efficiently. In the game world, players are scattered across a virtual map. We use a quadtree, a data structure that divides the map into smaller regions, to quickly find which players are near each other. Think of it like a grid that helps us zoom in on relevant areas. We also set a game-specific "speed of light"—not the real one, but a rule saying how far a player can move in one time step (e.g., 10 units per second). This limits how far updates need to travel: if a player is too far away to interact within that time, we don’t bother sending them the update yet. This reduces unnecessary network traffic.

Prioritizing Updates: Smart Peer Selection

Next, among the nearby players (filtered by the quadtree), we decide who gets updates first. We calculate a priority score for each peer based on four factors:
Low Latency: Peers with faster connections get updates sooner since they’ll process them quickly.
Simulation Speed Similarity: Each player’s game runs at a slightly adjusted speed based on their average latency (more on this below). We prioritize peers whose game speeds match closely, ensuring their views stay consistent.
In-Game Distance: Closer players are more likely to interact, so they get higher priority.
Relative Movement: If two players are moving toward each other, they’ll likely meet soon, so we bump up their priority. Using these factors, we pick a small group of peers to send updates to first. The gossip protocol then spreads the info to others over time.

Hiding Latency: Adjusting Game Time

Finally, we tackle how to mask delays. If a player has high latency, updates from others arrive late. To avoid jarring jumps (like a player teleporting), we tweak their game time perception. Imagine a player with a slow connection: we slightly slow down their game clock so that when a delayed update arrives, it fits naturally into their timeline. This adjustment is called a "time dilation factor" (TDF)—a nod to physics, but really just a way to sync their experience with the network reality. Players with fast connections run at normal speed, while those with lag get a subtle tweak, making delays less noticeable.

Why It Works

This system combines spatial efficiency (quadtree), smart prioritization (peer selection), and perception adjustment (TDF) to keep the game smooth and consistent. By focusing updates on nearby, low-latency peers with similar game speeds, we ensure critical info spreads fast where it matters most. Adjusting each player’s game time hides network hiccups, so everyone feels like they’re playing in real-time, even in a decentralized P2P setup. It’s a practical, scalable way to manage latency without needing a central server—or a physics degree!