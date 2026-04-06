import "./style.css";
import {
	BackSide,
	BoxGeometry,
	BufferGeometry,
	Clock,
	Color,
	DirectionalLight,
	EdgesGeometry,
	Euler,
	Float32BufferAttribute,
	Fog,
	HemisphereLight,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	PerspectiveCamera,
	Points,
	PointsMaterial,
	Scene,
	ShaderMaterial,
	SphereGeometry,
	Vector3,
	WebGLRenderer,
} from "three";
import { BLOCK_DEFS, BlockMaterials } from "./game/blocks";
import { CloudLayer } from "./game/clouds";
import { Hud } from "./game/hud";
import { ChunkRenderer } from "./game/mesher";
import { Player } from "./game/player";
import { voxelRaycast } from "./game/raycast";
import {
	BlockId,
	CHUNK_SIZE,
	INTERACTION_DISTANCE,
	RENDER_DISTANCE,
} from "./game/types";
import { isBlockBreakable, VoxelWorld } from "./game/world";

const MAX_HEALTH = 20;
const HIGHLIGHT_DISTANCE = 5;
const WORLD_SEED = Date.now();
const BASE_FOV = 75;
const DASH_FOV = 85;
const BREAK_PARTICLES_PER_BLOCK = 24;

const hotbarSlots: BlockId[] = [
	BlockId.Grass,
	BlockId.Dirt,
	BlockId.Stone,
	BlockId.Sand,
	BlockId.Log,
	BlockId.Planks,
	BlockId.Leaves,
	BlockId.Water,
	BlockId.Grass,
];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
	throw new Error("missing app root");
}

const hud = new Hud(app);
const canvas = hud.canvas;
const scene = new Scene();
const skyColor = new Color(0xa9d3ff);
scene.fog = new Fog(
	skyColor,
	CHUNK_SIZE * (RENDER_DISTANCE - 1.2),
	CHUNK_SIZE * (RENDER_DISTANCE + 1.8),
);

const skyDome = new Mesh(
	new SphereGeometry(480, 32, 16),
	new ShaderMaterial({
		side: BackSide,
		depthWrite: false,
		uniforms: {
			horizonColor: { value: new Color(0xa9d3ff) },
			zenithColor: { value: new Color(0x4a86d9) },
		},
		vertexShader: `
			varying vec3 vDir;
			void main() {
				vec4 worldPos = modelMatrix * vec4(position, 1.0);
				vDir = normalize(worldPos.xyz - cameraPosition);
				gl_Position = projectionMatrix * viewMatrix * worldPos;
			}
		`,
		fragmentShader: `
			uniform vec3 horizonColor;
			uniform vec3 zenithColor;
			varying vec3 vDir;
			void main() {
				float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
				float t = smoothstep(0.45, 1.0, h);
				vec3 color = mix(horizonColor, zenithColor, t);
				gl_FragColor = vec4(color, 1.0);
			}
		`,
	}),
);
scene.add(skyDome);

const camera = new PerspectiveCamera(
	75,
	window.innerWidth / window.innerHeight,
	0.1,
	500,
);
const renderer = new WebGLRenderer({
	canvas,
	antialias: false,
});
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);

const hemi = new HemisphereLight(0xcde8ff, 0x5c7a4e, 1.0);
scene.add(hemi);

const sun = new DirectionalLight(0xffffff, 1.2);
sun.position.set(80, 180, 60);
scene.add(sun);

const world = new VoxelWorld(WORLD_SEED);
const materials = new BlockMaterials();
const chunkRenderer = new ChunkRenderer(world, scene, materials);
const player = new Player(world);
const clouds = new CloudLayer(WORLD_SEED);
scene.add(clouds.root);

const highlight = new LineSegments(
	new EdgesGeometry(new BoxGeometry(1.002, 1.002, 1.002)),
	new LineBasicMaterial({ color: 0x111111 }),
);
highlight.visible = false;
scene.add(highlight);

type BreakParticle = {
	position: Vector3;
	velocity: Vector3;
	life: number;
	totalLife: number;
	color: Color;
};

const breakParticles: BreakParticle[] = [];
const breakParticleGeometry = new BufferGeometry();
const breakParticleMaterial = new PointsMaterial({
	size: 0.1,
	vertexColors: true,
	transparent: true,
	opacity: 0.95,
	sizeAttenuation: true,
});
const breakParticlePoints = new Points(
	breakParticleGeometry,
	breakParticleMaterial,
);
breakParticlePoints.frustumCulled = false;
scene.add(breakParticlePoints);

let selectedSlot = 0;
let health = MAX_HEALTH;
let isDead = false;
let shakeTimer = 0;
let shakePower = 0;
let audioContext: AudioContext | undefined;

const keyState = {
	forward: false,
	backward: false,
	left: false,
	right: false,
	jump: false,
};
let sprintLatched = false;

function ensureAudioContext() {
	if (!audioContext) {
		audioContext = new AudioContext();
	}
	if (audioContext.state === "suspended") {
		audioContext.resume();
	}
	return audioContext;
}

function playBeep(frequency: number, durationSeconds = 0.07, volume = 0.035) {
	const ctx = ensureAudioContext();
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	const now = ctx.currentTime;
	osc.type = "square";
	osc.frequency.setValueAtTime(frequency, now);
	gain.gain.setValueAtTime(0.0001, now);
	gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
	gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);
	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.start(now);
	osc.stop(now + durationSeconds + 0.02);
}

function particleColorForBlock(block: BlockId) {
	switch (block) {
		case BlockId.Grass:
			return new Color(0x73b453);
		case BlockId.Dirt:
			return new Color(0x8a5b35);
		case BlockId.Stone:
			return new Color(0xa0a5ad);
		case BlockId.Sand:
			return new Color(0xd9cc8e);
		case BlockId.Log:
			return new Color(0x9a6a40);
		case BlockId.Leaves:
			return new Color(0x5b9c43);
		case BlockId.Water:
			return new Color(0x58a7ff);
		case BlockId.Planks:
			return new Color(0xb5854f);
		default:
			return new Color(0xffffff);
	}
}

function spawnBreakParticles(x: number, y: number, z: number, block: BlockId) {
	const base = new Vector3(x + 0.5, y + 0.5, z + 0.5);
	const color = particleColorForBlock(block);
	for (let i = 0; i < BREAK_PARTICLES_PER_BLOCK; i++) {
		const dir = new Vector3(
			Math.random() * 2 - 1,
			Math.random() * 1.2,
			Math.random() * 2 - 1,
		)
			.normalize()
			.multiplyScalar(1.2 + Math.random() * 1.4);
		breakParticles.push({
			position: base
				.clone()
				.add(
					new Vector3(
						(Math.random() - 0.5) * 0.25,
						(Math.random() - 0.5) * 0.25,
						(Math.random() - 0.5) * 0.25,
					),
				),
			velocity: dir,
			life: 0.45 + Math.random() * 0.35,
			totalLife: 0.45 + Math.random() * 0.35,
			color: color.clone(),
		});
	}
}

function updateBreakParticles(dt: number) {
	for (let i = breakParticles.length - 1; i >= 0; i--) {
		const p = breakParticles[i];
		p.life -= dt;
		if (p.life <= 0) {
			breakParticles.splice(i, 1);
			continue;
		}
		p.velocity.y -= 8.8 * dt;
		p.velocity.multiplyScalar(Math.max(0, 1 - 2.3 * dt));
		p.position.addScaledVector(p.velocity, dt);
	}

	const positions = new Float32Array(breakParticles.length * 3);
	const colors = new Float32Array(breakParticles.length * 3);
	for (let i = 0; i < breakParticles.length; i++) {
		const p = breakParticles[i];
		positions[i * 3] = p.position.x;
		positions[i * 3 + 1] = p.position.y;
		positions[i * 3 + 2] = p.position.z;
		const t = Math.max(0, p.life / p.totalLife);
		colors[i * 3] = p.color.r * t;
		colors[i * 3 + 1] = p.color.g * t;
		colors[i * 3 + 2] = p.color.b * t;
	}
	breakParticleGeometry.setAttribute(
		"position",
		new Float32BufferAttribute(positions, 3),
	);
	breakParticleGeometry.setAttribute(
		"color",
		new Float32BufferAttribute(colors, 3),
	);
	breakParticleGeometry.computeBoundingSphere();
}

function updateHud() {
	hud.renderHealth(health, MAX_HEALTH);
	hud.renderHotbar(hotbarSlots, selectedSlot);
}

function takeDamage(amount: number) {
	health = Math.max(0, health - amount);
	if (amount > 0) {
		shakePower = Math.min(0.22, 0.05 + amount * 0.012);
		shakeTimer = 0.28;
	}
	updateHud();
	if (health <= 0 && !isDead) {
		handleDeath();
	}
}

function handleDeath() {
	isDead = true;
	document.exitPointerLock();
	hud.showDeath(() => {
		health = MAX_HEALTH;
		isDead = false;
		player.setSpawn(world.getSpawnPosition());
		hud.hideDeath();
		updateHud();
	});
}

function updateMovementInput() {
	const strafe = (keyState.left ? -1 : 0) + (keyState.right ? 1 : 0);
	const forward = (keyState.forward ? 1 : 0) + (keyState.backward ? -1 : 0);
	const isMoving = strafe !== 0 || forward !== 0;
	if (!isMoving) {
		sprintLatched = false;
	}
	const sprinting = sprintLatched && isMoving;
	player.setMoveInput(strafe, forward);
	player.setSprinting(sprinting);
	if (keyState.jump) {
		player.jump();
	}
	return sprinting;
}

function blockLabel(block: BlockId) {
	return BLOCK_DEFS[block].name;
}

function tryInteract(isPrimary: boolean) {
	if (isDead) {
		return;
	}
	const origin = player.getEyePosition();
	const direction = new Vector3(0, 0, -1).applyEuler(player.getCameraEuler());
	const hit = voxelRaycast(world, origin, direction, INTERACTION_DISTANCE);
	if (!hit) {
		return;
	}
	const hitBlock = world.getBlock(hit.block.x, hit.block.y, hit.block.z);
	if (isPrimary) {
		if (hitBlock !== BlockId.Water && isBlockBreakable(hitBlock)) {
			spawnBreakParticles(hit.block.x, hit.block.y, hit.block.z, hitBlock);
			world.setBlock(hit.block.x, hit.block.y, hit.block.z, BlockId.Air);
			playBeep(174, 0.06, 0.04);
		}
		return;
	}

	const placeBlock = hotbarSlots[selectedSlot];
	const { x, y, z } = hit.previous;
	if (
		world.getBlock(x, y, z) !== BlockId.Air &&
		world.getBlock(x, y, z) !== BlockId.Water
	) {
		return;
	}
	if (player.intersectsBlock(x, y, z)) {
		return;
	}
	world.setBlock(x, y, z, placeBlock);
	playBeep(415, 0.05, 0.03);
}

function updateBlockHighlight() {
	if (isDead) {
		highlight.visible = false;
		return;
	}
	const origin = player.getEyePosition();
	const direction = new Vector3(0, 0, -1).applyEuler(player.getCameraEuler());
	const hit = voxelRaycast(world, origin, direction, HIGHLIGHT_DISTANCE);
	if (!hit) {
		highlight.visible = false;
		return;
	}
	const block = world.getBlock(hit.block.x, hit.block.y, hit.block.z);
	if (block === BlockId.Water || block === BlockId.Air) {
		highlight.visible = false;
		return;
	}
	const center = new Vector3(
		hit.block.x + 0.5,
		hit.block.y + 0.5,
		hit.block.z + 0.5,
	);
	if (center.distanceTo(origin) >= HIGHLIGHT_DISTANCE) {
		highlight.visible = false;
		return;
	}
	highlight.position.copy(center);
	highlight.visible = true;
}

function setSelectedSlot(index: number) {
	selectedSlot = (index + hotbarSlots.length) % hotbarSlots.length;
	updateHud();
	document.title = `mc-clone-three - ${blockLabel(hotbarSlots[selectedSlot])}`;
}

document.addEventListener("keydown", (event) => {
	switch (event.code) {
		case "KeyW":
			keyState.forward = true;
			break;
		case "KeyS":
			keyState.backward = true;
			break;
		case "KeyA":
			keyState.left = true;
			break;
		case "KeyD":
			keyState.right = true;
			break;
		case "Space":
			keyState.jump = true;
			break;
		case "ControlLeft":
		case "ControlRight":
			if (!sprintLatched) {
				sprintLatched = true;
			}
			break;
		default:
			break;
	}

	const numeric = Number.parseInt(event.key, 10);
	if (numeric >= 1 && numeric <= 9) {
		setSelectedSlot(numeric - 1);
	}
});

document.addEventListener("keyup", (event) => {
	switch (event.code) {
		case "KeyW":
			keyState.forward = false;
			break;
		case "KeyS":
			keyState.backward = false;
			break;
		case "KeyA":
			keyState.left = false;
			break;
		case "KeyD":
			keyState.right = false;
			break;
		case "Space":
			keyState.jump = false;
			break;
		default:
			break;
	}
});

window.addEventListener(
	"wheel",
	(event) => {
		event.preventDefault();
		setSelectedSlot(selectedSlot + Math.sign(event.deltaY));
	},
	{ passive: false },
);

canvas.addEventListener("click", () => {
	ensureAudioContext();
	if (!isDead && document.pointerLockElement !== canvas) {
		canvas.requestPointerLock();
	}
});

document.addEventListener("mousemove", (event) => {
	if (document.pointerLockElement !== canvas || isDead) {
		return;
	}
	player.setLookDelta(event.movementX, event.movementY);
});

document.addEventListener("mousedown", (event) => {
	if (document.pointerLockElement !== canvas) {
		return;
	}
	if (event.button === 0) {
		tryInteract(true);
	}
	if (event.button === 2) {
		tryInteract(false);
	}
});

document.addEventListener("contextmenu", (event) => {
	event.preventDefault();
});

window.addEventListener("resize", () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});

player.setSpawn(world.getSpawnPosition());
updateHud();

const clock = new Clock();
const euler = new Euler();

function animate() {
	requestAnimationFrame(animate);
	const dt = Math.min(clock.getDelta(), 0.05);
	const elapsed = clock.elapsedTime;

	if (!isDead) {
		const sprinting = updateMovementInput();
		const targetFov = sprinting ? DASH_FOV : BASE_FOV;
		camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8);
		camera.updateProjectionMatrix();
		const landedDistance = player.update(dt);
		if (landedDistance > 3) {
			const damage = Math.floor(landedDistance - 3); // 修正しなくてよい
			if (damage > 0) {
				takeDamage(damage);
			}
		}
	} else {
		camera.fov += (BASE_FOV - camera.fov) * Math.min(1, dt * 8);
		camera.updateProjectionMatrix();
	}
	hud.renderPosition(player.position.x, player.position.y, player.position.z);

	world.tickSand();
	clouds.update(elapsed);
	updateBreakParticles(dt);
	chunkRenderer.updateAround(
		player.position.x,
		player.position.z,
		RENDER_DISTANCE,
	);

	euler.copy(player.getCameraEuler());
	if (shakeTimer > 0) {
		shakeTimer = Math.max(0, shakeTimer - dt);
		const decay = shakeTimer / 0.28;
		const ampRot = shakePower * 0.6 * decay;
		euler.x += (Math.random() * 2 - 1) * ampRot;
		euler.y += (Math.random() * 2 - 1) * ampRot;
	}
	camera.quaternion.setFromEuler(euler);
	const rawEye = player.getEyePosition();
	skyDome.position.copy(rawEye);
	const eye = rawEye.clone();
	if (shakeTimer > 0) {
		const decay = shakeTimer / 0.28;
		const ampPos = shakePower * decay;
		eye.x += (Math.random() * 2 - 1) * ampPos;
		eye.y += (Math.random() * 2 - 1) * ampPos;
		eye.z += (Math.random() * 2 - 1) * ampPos;
	}
	camera.position.copy(eye);
	hud.setUnderwaterOverlay(
		world.getBlock(
			Math.floor(rawEye.x),
			Math.floor(rawEye.y),
			Math.floor(rawEye.z),
		) === BlockId.Water,
	);
	updateBlockHighlight();
	renderer.render(scene, camera);
}

animate();
