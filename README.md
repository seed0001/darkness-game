# Darkness

An infinite, navigable 3D world built with Three.js featuring procedural terrain, dynamic day/night cycles, and AI-driven entities.

## Features

- **Infinite Procedural World** - Seamlessly generated terrain with trees and environmental details
- **Third-Person Character** - Animated hillbilly character with idle, walk, and run animations
- **Companion System** - Buff Pitbull companion that follows you and wanders when idle
- **AI Entities**
  - Drone with random waypoint patrol and searchlights
  - Tank that roams the terrain
  - Dog companion
  - Chickens that spawn and wander
  - Glowing butterflies (blue, red, green) that fly around
- **Dynamic Sky** - Procedural day/night sky with stars, nebulae, and sun
- **Day/Night Cycle** - Press `1` or click TRANSITION to toggle
- **Flashlight** - Press `F` to toggle
- **Shooting** - Left-click to fire

## Controls

| Key | Action |
|-----|--------|
| `W A S D` | Move |
| `Mouse` | Look around |
| `Shift` | Sprint |
| `F` | Toggle flashlight |
| `1` | Toggle day/night |
| `Left Click` | Fire |

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm

### Installation

```bash
npm install
```

### Running

```bash
npm run dev
```

Or use the Python launcher:

```bash
python launcher.py
```

The game will open at `http://localhost:3000`

## Tech Stack

- **Three.js** - 3D rendering
- **Vite** - Build tool and dev server
- **FBX Models** - Character and entity models from Meshy AI

## Project Structure

```
darkness/
├── main.js          # Game entry point
├── character.js     # Player character (hillbilly)
├── pitbull.js       # Companion character
├── controls.js      # Third-person camera controls
├── world.js         # Procedural terrain generation
├── sky.js           # Dynamic sky system
├── drone.js         # AI drone with patrol
├── tank.js          # AI tank
├── dog.js           # Dog companion
├── chicken.js       # Chicken spawner
├── butterfly.js     # Glowing butterfly system
└── public/models/   # FBX models and textures
```

## License

MIT
