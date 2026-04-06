import { Vector3 } from "three";
import { BLOCK_DEFS } from "./blocks";
import {
	BlockId,
	CHUNK_SIZE,
	CHUNK_VOLUME,
	type ChunkData,
	WORLD_HEIGHT,
	WORLD_SIZE_X,
	WORLD_SIZE_Z,
} from "./types";

const SEA_LEVEL = 32;

function clamp(v: number, min: number, max: number) {
	return Math.max(min, Math.min(max, v));
}

function floorDiv(a: number, b: number) {
	return Math.floor(a / b);
}

function mod(a: number, b: number) {
	return ((a % b) + b) % b;
}

function hash2(x: number, z: number, seed: number) {
	let h = x * 374_761_393 + z * 668_265_263 + seed * 1_446_647;
	h = (h ^ (h >>> 13)) * 1_274_126_177;
	h ^= h >>> 16;
	return (h >>> 0) / 4_294_967_295;
}

function smoothstep(t: number) {
	return t * t * (3 - 2 * t);
}

function valueNoise2(x: number, z: number, scale: number, seed: number) {
	const fx = x / scale;
	const fz = z / scale;
	const x0 = Math.floor(fx);
	const z0 = Math.floor(fz);
	const x1 = x0 + 1;
	const z1 = z0 + 1;
	const tx = smoothstep(fx - x0);
	const tz = smoothstep(fz - z0);
	const n00 = hash2(x0, z0, seed);
	const n10 = hash2(x1, z0, seed);
	const n01 = hash2(x0, z1, seed);
	const n11 = hash2(x1, z1, seed);
	const ix0 = n00 + (n10 - n00) * tx;
	const ix1 = n01 + (n11 - n01) * tx;
	return ix0 + (ix1 - ix0) * tz;
}

export class VoxelWorld {
	private readonly chunks = new Map<string, ChunkData>();
	readonly dirtyChunks = new Set<string>();
	private readonly sandQueue = new Set<string>();
	private readonly seed: number;

	constructor(seed = Date.now()) {
		this.seed = seed;
	}

	isInBounds(x: number, y: number, z: number) {
		return (
			x >= 0 &&
			x < WORLD_SIZE_X &&
			z >= 0 &&
			z < WORLD_SIZE_Z &&
			y >= 0 &&
			y < WORLD_HEIGHT
		);
	}

	heightAt(x: number, z: number) {
		const n1 = valueNoise2(x, z, 220, this.seed + 11);
		const n2 = valueNoise2(x, z, 82, this.seed + 29);
		const n3 = valueNoise2(x, z, 34, this.seed + 61);
		const ridges = Math.abs(valueNoise2(x, z, 110, this.seed + 97) - 0.5);
		const highland = Math.max(0, n1 - 0.45);
		const h = 8 + n1 * 30 + n2 * 14 + n3 * 9 + ridges * 10 + highland * 16;
		return clamp(Math.floor(h), 4, WORLD_HEIGHT - 6);
	}

	getSpawnPosition() {
		const centerX = Math.floor(WORLD_SIZE_X / 2);
		const centerZ = Math.floor(WORLD_SIZE_Z / 2);
		const maxRadius = Math.max(WORLD_SIZE_X, WORLD_SIZE_Z);
		for (let radius = 0; radius <= maxRadius; radius++) {
			for (let dz = -radius; dz <= radius; dz++) {
				for (let dx = -radius; dx <= radius; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) {
						continue;
					}
					const x = centerX + dx;
					const z = centerZ + dz;
					if (x < 0 || x >= WORLD_SIZE_X || z < 0 || z >= WORLD_SIZE_Z) {
						continue;
					}
					const y = this.findSafeSpawnY(x, z);
					if (y !== undefined) {
						return new Vector3(x + 0.5, y, z + 0.5);
					}
				}
			}
		}

		const fallbackY = this.findTopWalkableY(centerX, centerZ) + 2;
		return new Vector3(centerX + 0.5, fallbackY, centerZ + 0.5);
	}

	private findSafeSpawnY(x: number, z: number) {
		const groundY = this.findTopWalkableY(x, z);
		const feetY = groundY + 1;
		const headY = groundY + 2;
		if (!this.isInBounds(x, headY, z)) {
			return undefined;
		}
		const ground = this.getBlock(x, groundY, z);
		if (!this.isSolid(ground) || ground === BlockId.Water) {
			return undefined;
		}
		if (this.getBlock(x, feetY, z) !== BlockId.Air) {
			return undefined;
		}
		if (this.getBlock(x, headY, z) !== BlockId.Air) {
			return undefined;
		}
		return feetY;
	}

	findTopWalkableY(x: number, z: number) {
		if (x < 0 || x >= WORLD_SIZE_X || z < 0 || z >= WORLD_SIZE_Z) {
			return 1;
		}
		for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
			const block = this.getBlock(x, y, z);
			if (block !== BlockId.Air && block !== BlockId.Water) {
				return y;
			}
		}
		return 1;
	}

	getChunkKey(cx: number, cz: number) {
		return `${cx},${cz}`;
	}

	parseChunkKey(key: string) {
		const [cx, cz] = key.split(",").map((v) => Number(v));
		return { cx, cz };
	}

	worldToChunk(x: number, z: number) {
		const cx = floorDiv(x, CHUNK_SIZE);
		const cz = floorDiv(z, CHUNK_SIZE);
		return { cx, cz };
	}

	chunkToWorld(cx: number, cz: number) {
		return { x: cx * CHUNK_SIZE, z: cz * CHUNK_SIZE };
	}

	private index(lx: number, y: number, lz: number) {
		return y * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
	}

	private getLocal(chunk: ChunkData, lx: number, y: number, lz: number) {
		return chunk.blocks[this.index(lx, y, lz)] as BlockId;
	}

	private setLocal(
		chunk: ChunkData,
		lx: number,
		y: number,
		lz: number,
		block: BlockId,
	) {
		chunk.blocks[this.index(lx, y, lz)] = block;
	}

	private withinWorldXZ(x: number, z: number) {
		return x >= 0 && x < WORLD_SIZE_X && z >= 0 && z < WORLD_SIZE_Z;
	}

	getOrCreateChunk(cx: number, cz: number) {
		const key = this.getChunkKey(cx, cz);
		const existing = this.chunks.get(key);
		if (existing) {
			return existing;
		}
		const maxChunkX = Math.floor((WORLD_SIZE_X - 1) / CHUNK_SIZE);
		const maxChunkZ = Math.floor((WORLD_SIZE_Z - 1) / CHUNK_SIZE);
		if (cx < 0 || cz < 0 || cx > maxChunkX || cz > maxChunkZ) {
			return undefined;
		}
		const chunk: ChunkData = {
			cx,
			cz,
			blocks: new Uint8Array(CHUNK_VOLUME),
			dirty: true,
		};
		this.chunks.set(key, chunk);
		this.generateChunk(chunk);
		this.dirtyChunks.add(key);
		return chunk;
	}

	getBlock(x: number, y: number, z: number): BlockId {
		if (!this.isInBounds(x, y, z)) {
			return BlockId.Air;
		}
		const { cx, cz } = this.worldToChunk(x, z);
		const chunk = this.getOrCreateChunk(cx, cz);
		if (!chunk) {
			return BlockId.Air;
		}
		const lx = mod(x, CHUNK_SIZE);
		const lz = mod(z, CHUNK_SIZE);
		return this.getLocal(chunk, lx, y, lz);
	}

	setBlock(x: number, y: number, z: number, block: BlockId) {
		if (!this.isInBounds(x, y, z)) {
			return false;
		}
		const { cx, cz } = this.worldToChunk(x, z);
		const chunk = this.getOrCreateChunk(cx, cz);
		if (!chunk) {
			return false;
		}
		const lx = mod(x, CHUNK_SIZE);
		const lz = mod(z, CHUNK_SIZE);
		const idx = this.index(lx, y, lz);
		if (chunk.blocks[idx] === block) {
			return false;
		}
		chunk.blocks[idx] = block;
		chunk.dirty = true;
		this.dirtyChunks.add(this.getChunkKey(cx, cz));
		if (lx === 0) this.markChunkDirty(cx - 1, cz);
		if (lx === CHUNK_SIZE - 1) this.markChunkDirty(cx + 1, cz);
		if (lz === 0) this.markChunkDirty(cx, cz - 1);
		if (lz === CHUNK_SIZE - 1) this.markChunkDirty(cx, cz + 1);
		this.enqueueSand(x, y, z);
		this.enqueueSand(x, y + 1, z);
		this.enqueueSand(x + 1, y + 1, z);
		this.enqueueSand(x - 1, y + 1, z);
		this.enqueueSand(x, y + 1, z + 1);
		this.enqueueSand(x, y + 1, z - 1);
		return true;
	}

	isSolid(block: BlockId) {
		return BLOCK_DEFS[block].solid;
	}

	isWater(block: BlockId) {
		return block === BlockId.Water;
	}

	isPassable(block: BlockId) {
		return !BLOCK_DEFS[block].solid;
	}

	markChunkDirty(cx: number, cz: number) {
		const key = this.getChunkKey(cx, cz);
		const chunk = this.chunks.get(key);
		if (!chunk) {
			return;
		}
		chunk.dirty = true;
		this.dirtyChunks.add(key);
	}

	getChunk(cx: number, cz: number) {
		return this.chunks.get(this.getChunkKey(cx, cz));
	}

	forEachLoadedChunk(cb: (chunk: ChunkData) => void) {
		for (const chunk of this.chunks.values()) {
			cb(chunk);
		}
	}

	private shouldTreeGrow(x: number, z: number) {
		return hash2(x, z, this.seed + 700) < 0.02;
	}

	private shouldPondSpawn(x: number, z: number) {
		return hash2(x, z, this.seed + 1_500) < 0.0012;
	}

	private setGeneratedWorldBlock(
		chunk: ChunkData,
		wx: number,
		y: number,
		wz: number,
		block: BlockId,
	) {
		if (!this.isInBounds(wx, y, wz)) {
			return;
		}
		const { x: baseX, z: baseZ } = this.chunkToWorld(chunk.cx, chunk.cz);
		const lx = wx - baseX;
		const lz = wz - baseZ;
		if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
			return;
		}
		this.setLocal(chunk, lx, y, lz, block);
	}

	private generateChunk(chunk: ChunkData) {
		const { x: baseX, z: baseZ } = this.chunkToWorld(chunk.cx, chunk.cz);
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			for (let lz = 0; lz < CHUNK_SIZE; lz++) {
				const wx = baseX + lx;
				const wz = baseZ + lz;
				if (!this.withinWorldXZ(wx, wz)) {
					continue;
				}
				const surface = this.heightAt(wx, wz);
				for (let y = 0; y <= surface; y++) {
					let block: BlockId = y === 0 ? BlockId.Bedrock : BlockId.Stone;
					if (y >= surface - 2 && y < surface) {
						block = BlockId.Dirt;
					}
					if (y === surface) {
						block = surface <= 33 ? BlockId.Sand : BlockId.Grass;
					}
					this.setLocal(chunk, lx, y, lz, block);
				}
			}
		}

		this.fillSeaWater(chunk);
		this.decoratePonds(chunk);
		this.decorateTrees(chunk);
		this.enforceBedrockFloor(chunk);
	}

	private enforceBedrockFloor(chunk: ChunkData) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			for (let lz = 0; lz < CHUNK_SIZE; lz++) {
				this.setLocal(chunk, lx, 0, lz, BlockId.Bedrock);
			}
		}
	}

	private decoratePonds(chunk: ChunkData) {
		const { x: baseX, z: baseZ } = this.chunkToWorld(chunk.cx, chunk.cz);
		for (let cx = baseX - 4; cx < baseX + CHUNK_SIZE + 4; cx++) {
			for (let cz = baseZ - 4; cz < baseZ + CHUNK_SIZE + 4; cz++) {
				if (!this.withinWorldXZ(cx, cz) || !this.shouldPondSpawn(cx, cz)) {
					continue;
				}
				const centerY = this.heightAt(cx, cz);
				if (centerY < 10 || centerY > 46) {
					continue;
				}
				const radius = hash2(cx, cz, this.seed + 1_700) < 0.5 ? 2 : 3;
				for (let dx = -radius; dx <= radius; dx++) {
					for (let dz = -radius; dz <= radius; dz++) {
						if (dx * dx + dz * dz > radius * radius) {
							continue;
						}
						const wx = cx + dx;
						const wz = cz + dz;
						if (!this.withinWorldXZ(wx, wz)) {
							continue;
						}
						const y = this.heightAt(wx, wz);
						if (Math.abs(y - centerY) > 2 || y < 2) {
							continue;
						}
						this.setGeneratedWorldBlock(chunk, wx, y, wz, BlockId.Air);
						this.setGeneratedWorldBlock(chunk, wx, y - 1, wz, BlockId.Water);
						this.setGeneratedWorldBlock(chunk, wx, y - 2, wz, BlockId.Sand);
					}
				}
			}
		}
	}

	private decorateTrees(chunk: ChunkData) {
		const { x: baseX, z: baseZ } = this.chunkToWorld(chunk.cx, chunk.cz);
		for (let tx = baseX - 3; tx < baseX + CHUNK_SIZE + 3; tx++) {
			for (let tz = baseZ - 3; tz < baseZ + CHUNK_SIZE + 3; tz++) {
				if (!this.withinWorldXZ(tx, tz) || !this.shouldTreeGrow(tx, tz)) {
					continue;
				}
				const groundY = this.heightAt(tx, tz);
				if (groundY < 8 || groundY >= WORLD_HEIGHT - 8) {
					continue;
				}
				const groundBlock = this.getBlock(tx, groundY, tz);
				if (groundBlock !== BlockId.Grass && groundBlock !== BlockId.Dirt) {
					continue;
				}
				const trunkHeight = hash2(tx, tz, this.seed + 900) < 0.5 ? 4 : 5;
				for (let y = 1; y <= trunkHeight; y++) {
					this.setGeneratedWorldBlock(chunk, tx, groundY + y, tz, BlockId.Log);
				}
				const crownY = groundY + trunkHeight;
				for (let dx = -2; dx <= 2; dx++) {
					for (let dz = -2; dz <= 2; dz++) {
						for (let dy = -2; dy <= 1; dy++) {
							const dist = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
							if (dist > 4) {
								continue;
							}
							const wx = tx + dx;
							const wy = crownY + dy;
							const wz = tz + dz;
							if (!this.isInBounds(wx, wy, wz)) {
								continue;
							}
							if (this.getBlock(wx, wy, wz) !== BlockId.Air) {
								continue;
							}
							this.setGeneratedWorldBlock(chunk, wx, wy, wz, BlockId.Leaves);
						}
					}
				}
			}
		}
	}

	private fillSeaWater(chunk: ChunkData) {
		const { x: baseX, z: baseZ } = this.chunkToWorld(chunk.cx, chunk.cz);
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			for (let lz = 0; lz < CHUNK_SIZE; lz++) {
				const wx = baseX + lx;
				const wz = baseZ + lz;
				if (!this.withinWorldXZ(wx, wz)) {
					continue;
				}
				let highestNonLeaf = -1;
				for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
					const block = this.getBlock(wx, y, wz);
					if (block !== BlockId.Air && block !== BlockId.Leaves) {
						highestNonLeaf = y;
						break;
					}
				}

				for (let y = 0; y < SEA_LEVEL; y++) {
					if (y < highestNonLeaf) {
						continue;
					}
					if (this.getBlock(wx, y, wz) !== BlockId.Air) {
						continue;
					}
					this.setGeneratedWorldBlock(chunk, wx, y, wz, BlockId.Water);
				}

				let topWaterY = -1;
				for (let y = SEA_LEVEL - 1; y >= 0; y--) {
					if (this.getBlock(wx, y, wz) === BlockId.Water) {
						topWaterY = y;
						break;
					}
				}
				if (topWaterY > 0) {
					const below = this.getBlock(wx, topWaterY - 1, wz);
					if (below !== BlockId.Water) {
						this.setGeneratedWorldBlock(
							chunk,
							wx,
							topWaterY - 1,
							wz,
							BlockId.Sand,
						);
					}
				}
			}
		}
	}

	private enqueueSand(x: number, y: number, z: number) {
		if (!this.isInBounds(x, y, z)) {
			return;
		}
		if (this.getBlock(x, y, z) !== BlockId.Sand) {
			return;
		}
		this.sandQueue.add(`${x},${y},${z}`);
	}

	tickSand(maxSteps = 48) {
		let steps = 0;
		for (const key of this.sandQueue) {
			if (steps >= maxSteps) {
				break;
			}
			this.sandQueue.delete(key);
			const [x, y, z] = key.split(",").map((v) => Number(v));
			if (this.getBlock(x, y, z) !== BlockId.Sand) {
				continue;
			}
			if (y <= 0) {
				continue;
			}
			const below = this.getBlock(x, y - 1, z);
			if (below === BlockId.Air || below === BlockId.Water) {
				this.setBlock(x, y, z, BlockId.Air);
				this.setBlock(x, y - 1, z, BlockId.Sand);
				this.enqueueSand(x, y - 1, z);
			}
			steps++;
		}
	}
}

export function isChunkInsideWorld(cx: number, cz: number) {
	const maxChunkX = Math.floor((WORLD_SIZE_X - 1) / CHUNK_SIZE);
	const maxChunkZ = Math.floor((WORLD_SIZE_Z - 1) / CHUNK_SIZE);
	return cx >= 0 && cz >= 0 && cx <= maxChunkX && cz <= maxChunkZ;
}

export function blockCenter(x: number, y: number, z: number) {
	return new Vector3(x + 0.5, y + 0.5, z + 0.5);
}

export function isBlockBreakable(block: BlockId) {
	return BLOCK_DEFS[block].breakable;
}
