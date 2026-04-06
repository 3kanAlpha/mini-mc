import { Euler, Vector3 } from "three";
import { BlockId } from "./types";
import type { VoxelWorld } from "./world";

const PLAYER_WIDTH = 0.6;
const PLAYER_HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const GRAVITY = 24;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.6;
const WATER_SPEED_FACTOR = 0.45;
const JUMP_SPEED = 8.5;
const DRAG = 10;
const LOOK_SENSITIVITY = 0.0015;
const SWIM_UP_SPEED = 2.2;
const SWIM_DOWN_SPEED = 1.2;
const SWIM_ACCEL = 10;
const SWIM_CLIMB_BOOST = 4.8;

export class Player {
	position = new Vector3();
	velocity = new Vector3();
	yaw = 0;
	pitch = 0;
	onGround = false;
	inWater = false;
	headInWater = false;
	private fallStartY = 0;
	private wasOnGround = false;
	private sprinting = false;
	private swimAscend = false;

	private readonly moveInput = new Vector3();
	private readonly world: VoxelWorld;

	constructor(world: VoxelWorld) {
		this.world = world;
	}

	setSpawn(position: Vector3) {
		this.position.copy(position);
		this.velocity.set(0, 0, 0);
		this.onGround = false;
		this.wasOnGround = false;
		this.fallStartY = position.y;
	}

	setLookDelta(deltaX: number, deltaY: number) {
		this.yaw -= deltaX * LOOK_SENSITIVITY;
		this.pitch -= deltaY * LOOK_SENSITIVITY;
		this.pitch = Math.max(
			-Math.PI / 2 + 0.001,
			Math.min(Math.PI / 2 - 0.001, this.pitch),
		);
	}

	setMoveInput(strafe: number, forward: number) {
		this.moveInput.set(strafe, 0, forward);
	}

	setSprinting(sprinting: boolean) {
		this.sprinting = sprinting;
	}

	setSwimAscend(swimAscend: boolean) {
		this.swimAscend = swimAscend;
	}

	isTouchingWater() {
		return this.inWater;
	}

	jump() {
		if (!this.onGround) {
			return;
		}
		this.velocity.y = JUMP_SPEED;
		this.onGround = false;
	}

	update(dt: number) {
		this.inWater = this.checkInWater();
		this.headInWater = this.checkHeadInWater();
		const moveDir = new Vector3();
		const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
		const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
		moveDir.addScaledVector(right, this.moveInput.x);
		moveDir.addScaledVector(forward, this.moveInput.z);
		if (moveDir.lengthSq() > 0) {
			moveDir.normalize();
		}

		const baseSpeed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;
		const speed = this.inWater ? baseSpeed * WATER_SPEED_FACTOR : baseSpeed;
		this.velocity.x += moveDir.x * speed * DRAG * dt;
		this.velocity.z += moveDir.z * speed * DRAG * dt;
		const dragScale = Math.max(0, 1 - DRAG * dt);
		this.velocity.x *= dragScale;
		this.velocity.z *= dragScale;
		if (this.inWater) {
			const targetY = this.swimAscend ? SWIM_UP_SPEED : -SWIM_DOWN_SPEED;
			this.velocity.y +=
				(targetY - this.velocity.y) * Math.min(1, SWIM_ACCEL * dt);
			if (
				this.swimAscend &&
				!this.headInWater &&
				moveDir.lengthSq() > 0 &&
				this.canSwimClimbOut(moveDir)
			) {
				this.velocity.y = Math.max(this.velocity.y, SWIM_CLIMB_BOOST);
			}
		} else {
			this.velocity.y -= GRAVITY * dt * (this.inWater ? 0.3 : 1);
		}

		this.moveAxis("x", this.velocity.x * dt);
		this.moveAxis("y", this.velocity.y * dt);
		this.moveAxis("z", this.velocity.z * dt);

		const landedNow = !this.wasOnGround && this.onGround;
		let landedDistance = 0;
		if (landedNow) {
			landedDistance = this.fallStartY - this.position.y;
		}
		if (this.wasOnGround && !this.onGround) {
			this.fallStartY = this.position.y;
		}
		if (!this.onGround && this.velocity.y > 0) {
			this.fallStartY = Math.max(this.fallStartY, this.position.y);
		}
		this.wasOnGround = this.onGround;
		this.inWater = this.checkInWater();
		this.headInWater = this.checkHeadInWater();
		return landedDistance;
	}

	isHeadInWater() {
		return this.headInWater;
	}

	getEyePosition() {
		return new Vector3(
			this.position.x,
			this.position.y + EYE_HEIGHT,
			this.position.z,
		);
	}

	getCameraEuler() {
		return new Euler(this.pitch, this.yaw, 0, "YXZ");
	}

	intersectsBlock(x: number, y: number, z: number) {
		const half = PLAYER_WIDTH * 0.5;
		const minX = this.position.x - half;
		const maxX = this.position.x + half;
		const minY = this.position.y;
		const maxY = this.position.y + PLAYER_HEIGHT;
		const minZ = this.position.z - half;
		const maxZ = this.position.z + half;
		return (
			x + 1 > minX &&
			x < maxX &&
			y + 1 > minY &&
			y < maxY &&
			z + 1 > minZ &&
			z < maxZ
		);
	}

	private moveAxis(axis: "x" | "y" | "z", amount: number) {
		if (Math.abs(amount) < 1e-6) {
			if (axis === "y") {
				this.onGround = this.checkGrounded();
			}
			return;
		}
		const sign = Math.sign(amount);
		let remaining = Math.abs(amount);
		const step = 0.08;
		if (axis === "y") {
			this.onGround = false;
		}
		while (remaining > 0) {
			const move = Math.min(step, remaining) * sign;
			this.position[axis] += move;
			if (this.collides()) {
				this.position[axis] -= move;
				if (axis === "y") {
					if (sign < 0) {
						this.onGround = true;
					}
					this.velocity.y = 0;
				} else {
					this.velocity[axis] = 0;
				}
				return;
			}
			remaining -= Math.abs(move);
		}
		if (axis === "y") {
			this.onGround = this.checkGrounded();
		}
	}

	private collides() {
		const half = PLAYER_WIDTH * 0.5;
		const minX = Math.floor(this.position.x - half);
		const maxX = Math.floor(this.position.x + half);
		const minY = Math.floor(this.position.y);
		const maxY = Math.floor(this.position.y + PLAYER_HEIGHT);
		const minZ = Math.floor(this.position.z - half);
		const maxZ = Math.floor(this.position.z + half);
		for (let x = minX; x <= maxX; x++) {
			for (let y = minY; y <= maxY; y++) {
				for (let z = minZ; z <= maxZ; z++) {
					const block = this.world.getBlock(x, y, z);
					if (this.world.isSolid(block)) {
						return true;
					}
				}
			}
		}
		return false;
	}

	private checkGrounded() {
		const half = PLAYER_WIDTH * 0.5;
		const y = Math.floor(this.position.y - 0.04);
		const minX = Math.floor(this.position.x - half);
		const maxX = Math.floor(this.position.x + half);
		const minZ = Math.floor(this.position.z - half);
		const maxZ = Math.floor(this.position.z + half);
		for (let x = minX; x <= maxX; x++) {
			for (let z = minZ; z <= maxZ; z++) {
				if (this.world.isSolid(this.world.getBlock(x, y, z))) {
					return true;
				}
			}
		}
		return false;
	}

	private checkInWater() {
		const half = PLAYER_WIDTH * 0.5;
		const minX = Math.floor(this.position.x - half);
		const maxX = Math.floor(this.position.x + half);
		const minY = Math.floor(this.position.y + 0.1);
		const maxY = Math.floor(this.position.y + PLAYER_HEIGHT - 0.2);
		const minZ = Math.floor(this.position.z - half);
		const maxZ = Math.floor(this.position.z + half);
		for (let x = minX; x <= maxX; x++) {
			for (let y = minY; y <= maxY; y++) {
				for (let z = minZ; z <= maxZ; z++) {
					if (this.world.getBlock(x, y, z) === BlockId.Water) {
						return true;
					}
				}
			}
		}
		return false;
	}

	private checkHeadInWater() {
		const eye = this.getEyePosition();
		return (
			this.world.getBlock(
				Math.floor(eye.x),
				Math.floor(eye.y),
				Math.floor(eye.z),
			) === BlockId.Water
		);
	}

	private canSwimClimbOut(moveDir: Vector3) {
		const half = PLAYER_WIDTH * 0.5;
		const ahead = this.position.clone().addScaledVector(moveDir, half + 0.36);
		const fx = Math.floor(ahead.x);
		const fz = Math.floor(ahead.z);
		const y0 = Math.floor(this.position.y + 0.1);
		const y1 = y0 + 1;
		const y2 = y0 + 2;

		const wallAtFeet = this.world.isSolid(this.world.getBlock(fx, y0, fz));
		const wallAtBody = this.world.isSolid(this.world.getBlock(fx, y1, fz));
		const spaceAbove =
			this.world.getBlock(fx, y1, fz) === BlockId.Air &&
			this.world.getBlock(fx, y2, fz) === BlockId.Air;

		return (wallAtFeet || wallAtBody) && spaceAbove;
	}
}
