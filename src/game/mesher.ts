import { BufferAttribute, BufferGeometry, Mesh, type Scene } from "three";
import { BLOCK_DEFS, type BlockMaterials } from "./blocks";
import { BlockId, CHUNK_SIZE, type Face } from "./types";
import { isChunkInsideWorld, type VoxelWorld } from "./world";

const FACE_NORMALS = [
	[1, 0, 0],
	[-1, 0, 0],
	[0, 1, 0],
	[0, -1, 0],
	[0, 0, 1],
	[0, 0, -1],
] as const;

const FACE_OFFSETS = [
	[1, 0, 0],
	[-1, 0, 0],
	[0, 1, 0],
	[0, -1, 0],
	[0, 0, 1],
	[0, 0, -1],
] as const;

const FACE_VERTICES: Record<Face, readonly [number, number, number][]> = {
	0: [
		[1, 0, 0],
		[1, 1, 0],
		[1, 1, 1],
		[1, 0, 1],
	],
	1: [
		[0, 0, 1],
		[0, 1, 1],
		[0, 1, 0],
		[0, 0, 0],
	],
	2: [
		[0, 1, 1],
		[1, 1, 1],
		[1, 1, 0],
		[0, 1, 0],
	],
	3: [
		[0, 0, 0],
		[1, 0, 0],
		[1, 0, 1],
		[0, 0, 1],
	],
	4: [
		[1, 0, 1],
		[1, 1, 1],
		[0, 1, 1],
		[0, 0, 1],
	],
	5: [
		[0, 0, 0],
		[0, 1, 0],
		[1, 1, 0],
		[1, 0, 0],
	],
};

function pushFaceUvs(uvs: number[], block: BlockId, face: Face) {
	const base = [
		[0, 0],
		[1, 0],
		[1, 1],
		[0, 1],
	] as const;
	const isSideFace = face !== 2 && face !== 3;
	const shouldRotate = isSideFace && block !== BlockId.Water;
	if (!shouldRotate) {
		uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
		return;
	}
	for (const [u, v] of base) {
		uvs.push(1 - v, u);
	}
}

function shouldRenderFace(
	world: VoxelWorld,
	current: BlockId,
	nx: number,
	ny: number,
	nz: number,
) {
	if (current === BlockId.Leaves) {
		return true;
	}
	const neighbor = world.getBlock(nx, ny, nz);
	if (neighbor === BlockId.Air) {
		return true;
	}
	if (current === BlockId.Water) {
		return neighbor !== BlockId.Water;
	}
	if (neighbor === BlockId.Water) {
		return true;
	}
	return BLOCK_DEFS[neighbor].transparent;
}

export function buildChunkMesh(
	world: VoxelWorld,
	materials: BlockMaterials,
	cx: number,
	cz: number,
) {
	const chunk = world.getChunk(cx, cz) ?? world.getOrCreateChunk(cx, cz);
	if (!chunk) {
		return undefined;
	}
	const baseX = cx * CHUNK_SIZE;
	const baseZ = cz * CHUNK_SIZE;
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const groups = new Map<number, number[]>();

	for (let y = 0; y < chunk.blocks.length / (CHUNK_SIZE * CHUNK_SIZE); y++) {
		for (let lz = 0; lz < CHUNK_SIZE; lz++) {
			for (let lx = 0; lx < CHUNK_SIZE; lx++) {
				const wx = baseX + lx;
				const wz = baseZ + lz;
				const block = world.getBlock(wx, y, wz);
				if (block === BlockId.Air) {
					continue;
				}

				for (let face = 0 as Face; face <= 5; face = (face + 1) as Face) {
					const [ox, oy, oz] = FACE_OFFSETS[face];
					if (!shouldRenderFace(world, block, wx + ox, y + oy, wz + oz)) {
						continue;
					}
					const matIndex = materials.getMaterialIndex(block, face);
					const bucket = groups.get(matIndex) ?? [];
					const baseIndex = positions.length / 3;
					const verts = FACE_VERTICES[face];
					const [nx, ny, nz] = FACE_NORMALS[face];
					for (let i = 0; i < 4; i++) {
						const [vx, vy, vz] = verts[i];
						positions.push(wx + vx, y + vy, wz + vz);
						normals.push(nx, ny, nz);
					}
					pushFaceUvs(uvs, block, face);
					const faceIndices = [
						baseIndex,
						baseIndex + 1,
						baseIndex + 2,
						baseIndex,
						baseIndex + 2,
						baseIndex + 3,
					];
					bucket.push(...faceIndices);
					groups.set(matIndex, bucket);
				}
			}
		}
	}

	if (positions.length === 0) {
		return undefined;
	}

	const geometry = new BufferGeometry();
	geometry.setAttribute(
		"position",
		new BufferAttribute(new Float32Array(positions), 3),
	);
	geometry.setAttribute(
		"normal",
		new BufferAttribute(new Float32Array(normals), 3),
	);
	geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));

	let indexStart = 0;
	for (const [materialIndex, groupIndices] of groups.entries()) {
		indices.push(...groupIndices);
		geometry.addGroup(indexStart, groupIndices.length, materialIndex);
		indexStart += groupIndices.length;
	}
	geometry.setIndex(indices);
	geometry.computeBoundingSphere();

	const mesh = new Mesh(geometry, materials.materials);
	mesh.frustumCulled = true;
	mesh.castShadow = false;
	mesh.receiveShadow = true;
	return mesh;
}

export class ChunkRenderer {
	private readonly meshes = new Map<string, Mesh>();
	private readonly world: VoxelWorld;
	private readonly scene: Scene;
	private readonly materials: BlockMaterials;

	constructor(world: VoxelWorld, scene: Scene, materials: BlockMaterials) {
		this.world = world;
		this.scene = scene;
		this.materials = materials;
	}

	updateAround(playerX: number, playerZ: number, radius: number) {
		const centerCx = Math.floor(playerX / CHUNK_SIZE);
		const centerCz = Math.floor(playerZ / CHUNK_SIZE);
		const required = new Set<string>();

		for (let dz = -radius; dz <= radius; dz++) {
			for (let dx = -radius; dx <= radius; dx++) {
				const cx = centerCx + dx;
				const cz = centerCz + dz;
				if (!isChunkInsideWorld(cx, cz)) {
					continue;
				}
				const key = this.world.getChunkKey(cx, cz);
				required.add(key);
				this.world.getOrCreateChunk(cx, cz);
				if (!this.meshes.has(key)) {
					this.rebuildChunk(cx, cz);
				}
			}
		}

		for (const [key, mesh] of this.meshes.entries()) {
			if (required.has(key)) {
				continue;
			}
			mesh.geometry.dispose();
			this.scene.remove(mesh);
			this.meshes.delete(key);
		}

		let rebuilt = 0;
		for (const key of [...this.world.dirtyChunks]) {
			if (rebuilt >= 3 || !required.has(key)) {
				continue;
			}
			const { cx, cz } = this.world.parseChunkKey(key);
			this.rebuildChunk(cx, cz);
			this.world.dirtyChunks.delete(key);
			rebuilt++;
		}
	}

	private rebuildChunk(cx: number, cz: number) {
		const key = this.world.getChunkKey(cx, cz);
		const old = this.meshes.get(key);
		if (old) {
			old.geometry.dispose();
			this.scene.remove(old);
			this.meshes.delete(key);
		}
		const mesh = buildChunkMesh(this.world, this.materials, cx, cz);
		if (!mesh) {
			return;
		}
		this.meshes.set(key, mesh);
		this.scene.add(mesh);
	}
}
