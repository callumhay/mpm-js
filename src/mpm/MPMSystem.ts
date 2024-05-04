import * as THREE from 'three';
import { ZeroVector3, ZeroMatrix3 } from '../MathUtils';
import { Grid } from "./Grid";

const GRID_SIZE = 64;
const HALF_GRID_SIZE = GRID_SIZE / 2;
const GRAVITY = new THREE.Vector3(0, -9.8, 0);

class Particle {

  active: boolean;
  mass: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  B: THREE.Matrix3; // TODO: 3x3 matrix

  constructor(active = true, mass = 0.0, pos = ZeroVector3(), vel = ZeroVector3()) {
    this.active = active;
    this.mass = mass;
    this.pos = pos;
    this.vel = vel;
    this.B = ZeroMatrix3();
  }
}

export class MPMSystem {
  grid: Grid;
  particles: Array<Particle> = [];

  constructor(cellSize: number = 0.1) {
    this.grid = new Grid(
      new THREE.Vector3(GRID_SIZE,GRID_SIZE,1),
      cellSize,
      new THREE.Vector3(-HALF_GRID_SIZE, -HALF_GRID_SIZE, 0).multiplyScalar(cellSize)
    );
  }

  // size is the size of each particle
  addParticles(min: THREE.Vector3, max: THREE.Vector3, size: number, mass: number) {
    console.assert(min.x <= max.x && min.y <= max.y && min.z <= max.z, "Invalid bounds");
    console.assert(size > 0, "Invalid size");
    console.assert(mass > 0, "Invalid mass");

    const boxDim = max.clone().sub(min);
    console.assert(boxDim.x > 0 && boxDim.y > 0 && boxDim.z >= 0, "Invalid box dimensions");
    console.assert(size <= boxDim.x && size <= boxDim.y && (size <= boxDim.z || boxDim.z == 0), "Invalid size");

    const halfSize = size / 2.0;
    const numParticles = boxDim.divideScalar(size).floor();
    if (boxDim.z == 0) {
      numParticles.z = 1;
    }

    for (let x = 0; x < numParticles.x; x++) {
      for (let y = 0; y < numParticles.y; y++) {
        for (let z = 0; z < numParticles.z; z++) {
          const pos = new THREE.Vector3(
            min.x + x * size + halfSize,
            min.y + y * size + halfSize,
            min.z + z * size + halfSize
          );
          this.particles.push(new Particle(true, mass, pos));
        }
      }
    }
  }

  step(dt: number) {
    if (dt <= 0) { return; }

    this.grid.resetCells(); // Zero out all physics quantities in the grid
    this._particleToGrid();
    this._updateGrid(dt);
    this._gridToParticle(dt);
  }

  _particleToGrid() {
    const Dinv = this.grid.getDQuadratic().invert();
    for (const p of this.particles) {
      const gridIdx = this.grid.cellPositionToIndex(p.pos);
      const apic = p.B.multiply(Dinv);

      // Loops over the 3x3 matrix of the grid cells surrounding the particle
      const gzInit = this.grid.is2D ? 0 : -1;
      const gzEnd = this.grid.is2D ? 0 : 1;
      const delta = new THREE.Vector3();
      const idx = new THREE.Vector3();
      for (let gx = -1; gx <= 1; ++gx) {
        for (let gy = -1; gy <= 1; ++gy) {
          for (let gz = gzInit; gz <= gzEnd; ++gz) {
            delta.set(gx, gy, gz);
            idx.addVectors(gridIdx, delta);
            if (!this.grid.isValidCellIndex(idx.x, idx.y, idx.z)) {
              continue;
            }

            const weight = this.grid.getWeight(p.pos, delta);
            const gridPos = this.grid.cellIndexToPosition(idx.x, idx.y, idx.z);
            const cell = this.grid.getCell(idx);
            cell.mass += weight * p.mass;

            // cell.mv += weight * p.mass * (p.vel + math.mul(apic, (gridPos-p.pos)));
            cell.mv.add(gridPos.sub(p.pos).applyMatrix3(apic).add(p.vel).multiplyScalar(weight * p.mass));
          }
        }
      }
    }
  }


  _updateGrid(dt: number) {
    const idx = new THREE.Vector3();
    for (let x = 0; x < this.grid.size.x; x++) {
      for (let y = 0; y < this.grid.size.y; y++) {
        for (let z = 0; z < this.grid.size.z; z++) {
          idx.set(x, y, z);
          const cell = this.grid.getCell(idx);

          if (cell.mass <= 0) {
            cell.clear();
            continue;
          }

          cell.vel = cell.mv.clone().divideScalar(cell.mass);
          // cell.vel += dt * (cell.force / cell.mass + EXTERNAL_FORCE);
          cell.vel.add(cell.force.clone().divideScalar(cell.mass).add(GRAVITY).multiplyScalar(dt));

          // This is where we need to see if the cell is at a boundary
          // and apply boundary conditions to the velocity.
          // TODO: This is a hack currently, fix it.
          if (x < 2 || x >= this.grid.size.x - 2) {
            cell.vel.x = 0;
          }
          if (y < 2 || y >= this.grid.size.y - 2) {
            cell.vel.y = 0;
          }
          if (!this.grid.is2D && (z < 2 || z >= this.grid.size.z - 2)) {
            cell.vel.z = 0;
          }
        }
      }
    }
  }

  _gridToParticle(dt: number) {
    const outerMulVec3 = (v1: THREE.Vector3, v2: THREE.Vector3) => {
      return new THREE.Matrix3(
        v1.x * v2.x, v1.x * v2.y, v1.x * v2.z,
        v1.y * v2.x, v1.y * v2.y, v1.y * v2.z,
        v1.z * v2.x, v1.z * v2.y, v1.z * v2.z
      );
    };
    const addInPlaceMatrix3 = (m1: THREE.Matrix3, m2: THREE.Matrix3) => {
      m1.set(
        m1.elements[0] + m2.elements[0], m1.elements[1] + m2.elements[1], m1.elements[2] + m2.elements[2],
        m1.elements[3] + m2.elements[3], m1.elements[4] + m2.elements[4], m1.elements[5] + m2.elements[5],
        m1.elements[6] + m2.elements[6], m1.elements[7] + m2.elements[7], m1.elements[8] + m2.elements[8]
      );
    }

    const gridBounds = this.grid.getBounds();
    for (const p of this.particles) {
      p.vel = ZeroVector3();
      p.B = ZeroMatrix3();

      const gridIdx = this.grid.cellPositionToIndex(p.pos);
      // Loops over the 3x3 matrix of the grid cells surrounding the particle
      const gzInit = this.grid.is2D ? 0 : -1;
      const gzEnd = this.grid.is2D ? 0 : 1;
      const delta = new THREE.Vector3();
      const idx = new THREE.Vector3();
      for (let gx = -1; gx <= 1; ++gx) {
        for (let gy = -1; gy <= 1; ++gy) {
          for (let gz = gzInit; gz <= gzEnd; ++gz) {
            delta.set(gx, gy, gz);
            idx.addVectors(gridIdx, delta);
            if (!this.grid.isValidCellIndex(idx.x, idx.y, idx.z)) {
              continue;
            }

            const weight = this.grid.getWeight(p.pos, delta);
            const gridPos = this.grid.cellIndexToPosition(idx.x, idx.y, idx.z);
            const cellVel = this.grid.getCell(idx).vel.clone();
            p.vel.add(cellVel.multiplyScalar(weight));

            //p.B += w * Outer(vel, gpos - p.pos);
            const m = outerMulVec3(cellVel, gridPos.sub(p.pos)).multiplyScalar(weight);
            addInPlaceMatrix3(p.B, m);
          }
        }
      }
      p.pos.add(p.vel.clone().multiplyScalar(dt));
      p.pos.max(gridBounds.min);
      p.pos.min(gridBounds.max);
    }
  }

}