import type { Vector3 } from "three";
import { BLOCK_DEFS } from "./blocks";
import type { VoxelHit } from "./types";
import type { VoxelWorld } from "./world";

export function voxelRaycast(
	world: VoxelWorld,
	origin: Vector3,
	direction: Vector3,
	maxDistance: number,
): VoxelHit | undefined {
	const dir = direction.clone().normalize();
	let x = Math.floor(origin.x);
	let y = Math.floor(origin.y);
	let z = Math.floor(origin.z);

	const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
	const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
	const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

	const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.x);
	const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.y);
	const tDeltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.z);

	const frac = (v: number) => v - Math.floor(v);
	let tMaxX =
		stepX > 0
			? (1 - frac(origin.x)) * tDeltaX
			: stepX < 0
				? frac(origin.x) * tDeltaX
				: Number.POSITIVE_INFINITY;
	let tMaxY =
		stepY > 0
			? (1 - frac(origin.y)) * tDeltaY
			: stepY < 0
				? frac(origin.y) * tDeltaY
				: Number.POSITIVE_INFINITY;
	let tMaxZ =
		stepZ > 0
			? (1 - frac(origin.z)) * tDeltaZ
			: stepZ < 0
				? frac(origin.z) * tDeltaZ
				: Number.POSITIVE_INFINITY;

	let traveled = 0;
	let previous = { x, y, z };

	while (traveled <= maxDistance) {
		const block = world.getBlock(x, y, z);
		if (block !== 0 && !BLOCK_DEFS[block].liquid) {
			return {
				block: { x, y, z },
				previous,
			};
		}
		previous = { x, y, z };
		if (tMaxX < tMaxY) {
			if (tMaxX < tMaxZ) {
				x += stepX;
				traveled = tMaxX;
				tMaxX += tDeltaX;
			} else {
				z += stepZ;
				traveled = tMaxZ;
				tMaxZ += tDeltaZ;
			}
		} else if (tMaxY < tMaxZ) {
			y += stepY;
			traveled = tMaxY;
			tMaxY += tDeltaY;
		} else {
			z += stepZ;
			traveled = tMaxZ;
			tMaxZ += tDeltaZ;
		}
	}
	return undefined;
}
