export const WORLD_SIZE_X = 512;
export const WORLD_SIZE_Z = 512;
export const WORLD_HEIGHT = 64;

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = WORLD_HEIGHT;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE;

export const RENDER_DISTANCE = 6;
export const INTERACTION_DISTANCE = 6;

export const BlockId = {
	Air: 0,
	Grass: 1,
	Dirt: 2,
	Stone: 3,
	Sand: 4,
	Log: 5,
	Leaves: 6,
	Water: 7,
} as const;

export type BlockId = (typeof BlockId)[keyof typeof BlockId];

export type Face = 0 | 1 | 2 | 3 | 4 | 5;

export interface VoxelHit {
	block: { x: number; y: number; z: number };
	previous: { x: number; y: number; z: number };
}

export interface ChunkData {
	cx: number;
	cz: number;
	blocks: Uint8Array;
	dirty: boolean;
}
