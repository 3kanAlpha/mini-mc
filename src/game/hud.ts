import { BlockId } from "./types";

const BLOCK_LABEL: Record<BlockId, string> = {
	[BlockId.Air]: "Air",
	[BlockId.Grass]: "Grass",
	[BlockId.Dirt]: "Dirt",
	[BlockId.Stone]: "Stone",
	[BlockId.Sand]: "Sand",
	[BlockId.Log]: "Log",
	[BlockId.Leaves]: "Leaves",
	[BlockId.Water]: "Water",
	[BlockId.Planks]: "Planks",
	[BlockId.Bedrock]: "Bedrock",
};

export class Hud {
	private readonly healthEl: HTMLDivElement;
	private readonly oxygenEl: HTMLDivElement;
	private readonly positionEl: HTMLDivElement;
	private readonly underwaterOverlayEl: HTMLDivElement;
	private readonly hotbarEl: HTMLDivElement;
	private readonly deathEl: HTMLDivElement;
	private readonly deathMessageEl: HTMLDivElement;
	private readonly respawnButton: HTMLButtonElement;

	constructor(root: HTMLElement) {
		root.innerHTML = `
			<div id="game-wrap">
				<canvas id="game-canvas"></canvas>
				<div id="hud-layer">
					<div id="underwater-overlay"></div>
					<div id="crosshair" aria-hidden="true"></div>
					<div id="position"></div>
					<div id="health"></div>
					<div id="oxygen" class="hidden"></div>
					<div id="hotbar"></div>
					<div id="hint">クリックで視点固定 / WASD + Space で移動</div>
					<div id="death-screen" class="hidden">
						<div id="death-message"></div>
						<button id="respawn">リスポーン</button>
					</div>
				</div>
			</div>
		`;
		this.underwaterOverlayEl = root.querySelector<HTMLDivElement>(
			"#underwater-overlay",
		)!;
		this.positionEl = root.querySelector<HTMLDivElement>("#position")!;
		this.healthEl = root.querySelector<HTMLDivElement>("#health")!;
		this.oxygenEl = root.querySelector<HTMLDivElement>("#oxygen")!;
		this.hotbarEl = root.querySelector<HTMLDivElement>("#hotbar")!;
		this.deathEl = root.querySelector<HTMLDivElement>("#death-screen")!;
		this.deathMessageEl = root.querySelector<HTMLDivElement>("#death-message")!;
		this.respawnButton = root.querySelector<HTMLButtonElement>("#respawn")!;
	}

	get canvas() {
		return document.querySelector<HTMLCanvasElement>("#game-canvas")!;
	}

	renderHealth(health: number, maxHealth: number) {
		this.healthEl.textContent = `Health: ${health}/${maxHealth}`;
	}

	renderPosition(x: number, y: number, z: number, seed: number) {
		this.positionEl.textContent = `XYZ: ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}\nseed: ${seed}`;
	}

	renderOxygen(oxygen: number, maxOxygen: number, visible: boolean) {
		this.oxygenEl.textContent = `O2: ${Math.ceil(oxygen)}/${maxOxygen}`;
		this.oxygenEl.classList.toggle("hidden", !visible);
	}

	setUnderwaterOverlay(visible: boolean) {
		this.underwaterOverlayEl.classList.toggle("visible", visible);
	}

	renderHotbar(blocks: BlockId[], selectedIndex: number) {
		this.hotbarEl.innerHTML = blocks
			.map((id, index) => {
				const selected = index === selectedIndex ? "selected" : "";
				const blockClass = `block-${BLOCK_LABEL[id].toLowerCase()}`;
				return `<div class="slot ${selected}" title="${BLOCK_LABEL[id]}"><span class="num">${index + 1}</span><div class="preview"><div class="cube ${blockClass}"><span class="face top"></span><span class="face left"></span><span class="face right"></span></div></div></div>`;
			})
			.join("");
	}

	showDeath(onRespawn: () => void) {
		this.deathMessageEl.textContent = "あなたは死亡しました";
		this.deathEl.classList.remove("hidden");
		this.respawnButton.onclick = onRespawn;
	}

	hideDeath() {
		this.deathEl.classList.add("hidden");
	}
}
