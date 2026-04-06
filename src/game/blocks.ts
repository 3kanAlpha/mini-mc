import {
	DoubleSide,
	LinearMipMapLinearFilter,
	type Material,
	MeshLambertMaterial,
	NearestFilter,
	TextureLoader,
} from "three";
import { BlockId, type Face } from "./types";

export interface BlockDef {
	id: BlockId;
	name: string;
	solid: boolean;
	breakable: boolean;
	breakSeconds: number;
	transparent: boolean;
	liquid: boolean;
	slows: boolean;
}

const loader = new TextureLoader();

function loadBlockTexture(path: string) {
	const texture = loader.load(path);
	texture.magFilter = NearestFilter;
	texture.minFilter = LinearMipMapLinearFilter;
	return texture;
}

const textureByKey = {
	dirt: loadBlockTexture("/textures/block/dirt.png"),
	grassTop: loadBlockTexture("/textures/block/grass_top.png"),
	grassSide: loadBlockTexture("/textures/block/grass_side.png"),
	stone: loadBlockTexture("/textures/block/stone.png"),
	sand: loadBlockTexture("/textures/block/sand.png"),
	log: loadBlockTexture("/textures/block/log_oak.png"),
	logTop: loadBlockTexture("/textures/block/log_oak_top.png"),
	planks: loadBlockTexture("/textures/block/planks_oak.png"),
	leaves: loadBlockTexture("/textures/block/leaves_oak.png"),
	bedrock: loadBlockTexture("/textures/block/bedrock.png"),
} as const;

export const BLOCK_DEFS: Record<BlockId, BlockDef> = {
	[BlockId.Air]: {
		id: BlockId.Air,
		name: "Air",
		solid: false,
		breakable: false,
		breakSeconds: 0,
		transparent: true,
		liquid: false,
		slows: false,
	},
	[BlockId.Grass]: {
		id: BlockId.Grass,
		name: "Grass",
		solid: true,
		breakable: true,
		breakSeconds: 0.45,
		transparent: false,
		liquid: false,
		slows: false,
	},
	[BlockId.Dirt]: {
		id: BlockId.Dirt,
		name: "Dirt",
		solid: true,
		breakable: true,
		breakSeconds: 0.35,
		transparent: false,
		liquid: false,
		slows: false,
	},
	[BlockId.Stone]: {
		id: BlockId.Stone,
		name: "Stone",
		solid: true,
		breakable: true,
		breakSeconds: 1.35,
		transparent: false,
		liquid: false,
		slows: false,
	},
	[BlockId.Sand]: {
		id: BlockId.Sand,
		name: "Sand",
		solid: true,
		breakable: true,
		breakSeconds: 0.3,
		transparent: false,
		liquid: false,
		slows: false,
	},
	[BlockId.Log]: {
		id: BlockId.Log,
		name: "Log",
		solid: true,
		breakable: true,
		breakSeconds: 0.95,
		transparent: false,
		liquid: false,
		slows: false,
	},
	[BlockId.Leaves]: {
		id: BlockId.Leaves,
		name: "Leaves",
		solid: true,
		breakable: true,
		breakSeconds: 0.22,
		transparent: true,
		liquid: false,
		slows: false,
	},
	[BlockId.Water]: {
		id: BlockId.Water,
		name: "Water",
		solid: false,
		breakable: false,
		breakSeconds: 0,
		transparent: true,
		liquid: true,
		slows: true,
	},
	[BlockId.Planks]: {
		id: BlockId.Planks,
		name: "Planks",
		solid: true,
		breakable: true,
		breakSeconds: 0.75,
		transparent: false,
		liquid: false,
		slows: false,
	},
	[BlockId.Bedrock]: {
		id: BlockId.Bedrock,
		name: "Bedrock",
		solid: true,
		breakable: false,
		breakSeconds: 0,
		transparent: false,
		liquid: false,
		slows: false,
	},
};

const FACE_ORDER: Face[] = [0, 1, 2, 3, 4, 5];

function textureKeyForFace(block: BlockId, face: Face) {
	switch (block) {
		case BlockId.Grass:
			if (face === 2) return "grassTop";
			if (face === 3) return "dirt";
			return "grassSide";
		case BlockId.Dirt:
			return "dirt";
		case BlockId.Stone:
			return "stone";
		case BlockId.Sand:
			return "sand";
		case BlockId.Log:
			if (face === 2 || face === 3) return "logTop";
			return "log";
		case BlockId.Leaves:
			return "leaves";
		case BlockId.Planks:
			return "planks";
		case BlockId.Bedrock:
			return "bedrock";
		default:
			return undefined;
	}
}

export class BlockMaterials {
	readonly materials: Material[] = [];
	private readonly materialIndexMap = new Map<string, number>();
	private readonly waterIndex: number;

	constructor() {
		const opaqueMat = (texture: keyof typeof textureByKey) =>
			new MeshLambertMaterial({ map: textureByKey[texture] });

		const leavesMaterial = new MeshLambertMaterial({
			map: textureByKey.leaves,
			transparent: true,
			alphaTest: 0.45,
			side: DoubleSide,
		});

		for (const block of [
			BlockId.Grass,
			BlockId.Dirt,
			BlockId.Stone,
			BlockId.Sand,
			BlockId.Log,
			BlockId.Planks,
			BlockId.Bedrock,
			BlockId.Leaves,
		]) {
			for (const face of FACE_ORDER) {
				const textureKey = textureKeyForFace(block, face);
				if (!textureKey) {
					continue;
				}
				const key = `${block}:${face}`;
				if (this.materialIndexMap.has(key)) {
					continue;
				}
				if (block === BlockId.Leaves) {
					this.materialIndexMap.set(key, this.pushMaterial(leavesMaterial));
					continue;
				}
				this.materialIndexMap.set(
					key,
					this.pushMaterial(opaqueMat(textureKey)),
				);
			}
		}

		this.waterIndex = this.pushMaterial(
			new MeshLambertMaterial({
				color: 0x3b82f6,
				transparent: true,
				opacity: 0.7,
			}),
		);
	}

	getMaterialIndex(block: BlockId, face: Face): number {
		if (block === BlockId.Water) {
			return this.waterIndex;
		}
		const key = `${block}:${face}`;
		const idx = this.materialIndexMap.get(key);
		if (idx === undefined) {
			throw new Error(`material index missing for ${key}`);
		}
		return idx;
	}

	private pushMaterial(material: Material): number {
		const idx = this.materials.length;
		this.materials.push(material);
		return idx;
	}
}
