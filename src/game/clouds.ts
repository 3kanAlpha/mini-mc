import {
	BufferAttribute,
	BufferGeometry,
	Group,
	Mesh,
	MeshLambertMaterial,
} from "three";
import { WORLD_SIZE_X, WORLD_SIZE_Z } from "./types";

const CLOUD_Y = 120;
const CLOUD_SPEED = 2.2;
const CLOUD_CELL_SIZE = 8;
const CLOUD_THICKNESS = 2;

function smoothstep(t: number) {
	return t * t * (3 - 2 * t);
}

function hash2(x: number, z: number, seed: number) {
	let h = x * 374_761_393 + z * 668_265_263 + seed * 1_446_647;
	h = (h ^ (h >>> 13)) * 1_274_126_177;
	h ^= h >>> 16;
	return (h >>> 0) / 4_294_967_295;
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

function generateCloudMask(tileSize: number, seed: number) {
	const cells = Math.floor(tileSize / CLOUD_CELL_SIZE);
	const mask: boolean[][] = Array.from({ length: cells }, () =>
		Array.from({ length: cells }, () => false),
	);
	for (let gz = 0; gz < cells; gz++) {
		for (let gx = 0; gx < cells; gx++) {
			const wx = gx * CLOUD_CELL_SIZE;
			const wz = gz * CLOUD_CELL_SIZE;
			const n1 = valueNoise2(wx, wz, 42, seed + 3_201);
			const n2 = valueNoise2(wx, wz, 19, seed + 5_951);
			const density = n1 * 0.72 + n2 * 0.28;
			if (density < 0.62) {
				continue;
			}
			const sparse = hash2(gx, gz, seed + 8_231);
			if (sparse < 0.08) {
				continue;
			}
			mask[gz][gx] = true;
		}
	}
	return mask;
}

function createCloudTile(tileSize: number, seed: number) {
	const mask = generateCloudMask(tileSize, seed);
	const rows = mask.length;
	const cols = rows > 0 ? mask[0].length : 0;
	const positions: number[] = [];
	const normals: number[] = [];
	const indices: number[] = [];

	const halfCell = CLOUD_CELL_SIZE * 0.5;
	const yBottom = CLOUD_Y - CLOUD_THICKNESS;
	const yTop = CLOUD_Y;

	const pushQuad = (
		v0: [number, number, number],
		v1: [number, number, number],
		v2: [number, number, number],
		v3: [number, number, number],
		n: [number, number, number],
	) => {
		const base = positions.length / 3;
		positions.push(...v0, ...v1, ...v2, ...v3);
		normals.push(...n, ...n, ...n, ...n);
		indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	};

	for (let z = 0; z < rows; z++) {
		for (let x = 0; x < cols; x++) {
			if (!mask[z][x]) {
				continue;
			}

			const cx = x * CLOUD_CELL_SIZE + halfCell;
			const cz = z * CLOUD_CELL_SIZE + halfCell;
			const minX = cx - halfCell;
			const maxX = cx + halfCell;
			const minZ = cz - halfCell;
			const maxZ = cz + halfCell;

			pushQuad(
				[minX, yTop, maxZ],
				[maxX, yTop, maxZ],
				[maxX, yTop, minZ],
				[minX, yTop, minZ],
				[0, 1, 0],
			);

			pushQuad(
				[minX, yBottom, minZ],
				[maxX, yBottom, minZ],
				[maxX, yBottom, maxZ],
				[minX, yBottom, maxZ],
				[0, -1, 0],
			);

			if (x === cols - 1 || !mask[z][x + 1]) {
				pushQuad(
					[maxX, yBottom, minZ],
					[maxX, yTop, minZ],
					[maxX, yTop, maxZ],
					[maxX, yBottom, maxZ],
					[1, 0, 0],
				);
			}
			if (x === 0 || !mask[z][x - 1]) {
				pushQuad(
					[minX, yBottom, maxZ],
					[minX, yTop, maxZ],
					[minX, yTop, minZ],
					[minX, yBottom, minZ],
					[-1, 0, 0],
				);
			}
			if (z === rows - 1 || !mask[z + 1][x]) {
				pushQuad(
					[maxX, yBottom, maxZ],
					[maxX, yTop, maxZ],
					[minX, yTop, maxZ],
					[minX, yBottom, maxZ],
					[0, 0, 1],
				);
			}
			if (z === 0 || !mask[z - 1][x]) {
				pushQuad(
					[minX, yBottom, minZ],
					[minX, yTop, minZ],
					[maxX, yTop, minZ],
					[maxX, yBottom, minZ],
					[0, 0, -1],
				);
			}
		}
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
	geometry.setIndex(indices);
	geometry.computeBoundingSphere();

	const material = new MeshLambertMaterial({
		color: 0xffffff,
		emissive: 0x222222,
		emissiveIntensity: 0.16,
	});
	const mesh = new Mesh(geometry, material);
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.frustumCulled = true;
	mesh.position.set(0, 0, 0);
	return mesh;
}

export class CloudLayer {
	readonly root = new Group();
	private readonly tileA: Mesh;
	private readonly tileB: Mesh;
	private readonly tileSize: number;
	private readonly baseOffsetX: number;

	constructor(seed: number) {
		this.tileSize = Math.max(WORLD_SIZE_X, WORLD_SIZE_Z) * 2;
		this.baseOffsetX = -WORLD_SIZE_X * 0.5;
		this.tileA = createCloudTile(this.tileSize, seed + 10_001);
		this.tileB = createCloudTile(this.tileSize, seed + 10_001);
		this.root.add(this.tileA);
		this.root.add(this.tileB);
		this.update(0);
	}

	update(elapsedSeconds: number) {
		const phase = (elapsedSeconds * CLOUD_SPEED) % this.tileSize;
		const offsetX = this.baseOffsetX - phase;
		this.tileA.position.set(offsetX, 0, 0);
		this.tileB.position.set(offsetX + this.tileSize, 0, 0);
	}
}
