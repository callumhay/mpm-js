
import * as THREE from 'three';
import { ZeroVector3 } from '../MathUtils';

export class Cell {
  mass: number = 0;
  mv: THREE.Vector3 = ZeroVector3();
  vel: THREE.Vector3 = ZeroVector3();
  force: THREE.Vector3 = ZeroVector3();

  constructor() {
  }

  clear() {
    this.mass = 0;
    this.mv = ZeroVector3();
    this.vel = ZeroVector3();
    this.force = ZeroVector3();
  }
  reset() {
    this.mass = 0;
    this.mv.setScalar(0.0);
    this.vel.setScalar(0.0);
    this.force.setScalar(0.0);
  }
}

export class Grid {
  size: THREE.Vector3; // Number of cells per side of the grid
  cellSize: number; // Size of each cell
  leftBottomBackPos: THREE.Vector3; // Left-bottom-back position of the grid
  data: Array<Cell> = [];

  constructor(size: THREE.Vector3, cellSize: number, leftBottomBackPos: THREE.Vector3) {
    console.assert(cellSize > 0, "Cell size must be greater than 0");
    this.size = size;
    this.cellSize = cellSize;
    this.leftBottomBackPos = leftBottomBackPos;
    this._initData();
  }

  get is2D() : boolean {
    return this.size.z === 1;
  }

  gridDimensions(): THREE.Vector3 {
    return this.cellDimensions().multiply(this.size);
  }
  cellDimensions() : THREE.Vector3 { // H
    return new THREE.Vector3(this.cellSize, this.cellSize, this.is2D ? 1.0 : this.cellSize);
  }
  invCellDimensions() : THREE.Vector3 { // invH
    return new THREE.Vector3(1.0 / this.cellSize, 1.0 / this.cellSize, this.is2D ? 1.0 : 1.0 / this.cellSize);
  }
  getH() { return this.cellDimensions(); }
  getInvH() { return this.invCellDimensions(); }

  get cellVolume() {
    const cellDims = this.cellDimensions();
    return cellDims.x * cellDims.y * cellDims.z;
  }
  getBounds() {
    return new THREE.Box3(this.leftBottomBackPos.clone(), this.gridDimensions().add(this.leftBottomBackPos));
  }

  _initData() {
    const dataLength = this.size.x * this.size.y * this.size.z;
    console.assert(dataLength > 0, "Grid size must be greater than 0");
    this.data = new Array(dataLength);
    for (let i = 0; i < dataLength; i++) {
      this.data[i] = new Cell();
    }
  }
  _toFlatIndex(xIdx: number, yIdx: number, zIdx: number): number { // ToIndex
    return xIdx + yIdx * this.size.x + zIdx * this.size.x * this.size.y;
  }

  resetCells() {
    for (let i = 0; i < this.data.length; i++) {
      this.data[i].reset();
    }
  }

  getCell(idx: THREE.Vector3): Cell {
    const flatIdx = this._toFlatIndex(idx.x, idx.y, idx.z);
    console.assert(flatIdx >= 0 && flatIdx < this.data.length, "Invalid cell index");
    return this.data[flatIdx];
  }

  isValidCellIndex(xIdx: number, yIdx: number, zIdx: number): boolean { // InGrid
    const flatIdx = this._toFlatIndex(xIdx, yIdx, zIdx);
    return flatIdx >= 0 && flatIdx < this.data.length;
  }
  /**
   * @returns A new Vector3 with the position of the center of the cell at the given index
   */
  cellIndexToPosition(xIdx: number, yIdx: number, zIdx: number): THREE.Vector3 { // IndexToCellPos
    const v = new THREE.Vector3(xIdx, yIdx, zIdx).addScalar(0.5).multiplyScalar(this.cellSize);
    return v.add(this.leftBottomBackPos);
  }
  /**
   * @returns A new Vector3 with the index of the cell that contains the given position
   */
  cellPositionToIndex(pos: THREE.Vector3): THREE.Vector3 { // ToIndex
    return pos.clone().sub(this.leftBottomBackPos).divide(this.cellDimensions()).floor();
  }

  getWeight(pos: THREE.Vector3, delta: THREE.Vector3): number {
    const gridIndex = this.cellPositionToIndex(pos);
    gridIndex.add(delta);
    if (!this.isValidCellIndex(gridIndex.x, gridIndex.y, gridIndex.z)) {
      return 0;
    }
    const gridPos = this.cellIndexToPosition(gridIndex.x, gridIndex.y, gridIndex.z);
    const dis = pos.clone().sub(gridPos).divide(this.getH());

    // NOTE: If the grid is 2D then we don't consider the z component in the weighting
    const w = this.getNQuadratic(dis.x) * this.getNQuadratic(dis.y) *
              (this.is2D ? 1.0 : this.getNQuadratic(dis.z));
    return w;
  }

  getWeightGradient(pos: THREE.Vector3, delta: THREE.Vector3): THREE.Vector3 {
    const gridIndex = this.cellPositionToIndex(pos);
    gridIndex.add(delta);
    if (!this.isValidCellIndex(gridIndex.x, gridIndex.y, gridIndex.z)) {
      return ZeroVector3();
    }
    const gridPos = this.cellIndexToPosition(gridIndex.x, gridIndex.y, gridIndex.z);
    const invH = this.getInvH();
    const dis = pos.clone().sub(gridPos).multiply(invH);

    const wx = this.getNQuadratic(dis.x);
    const wy = this.getNQuadratic(dis.y);
    const wz = this.is2D ? 1.0 : this.getNQuadratic(dis.z);
    const wdx = this.getNQuadraticDerivative(dis.x);
    const wdy = this.getNQuadraticDerivative(dis.y);

    // TODO: Check if we should set this to zero instead of 1 for the 2D case
    const wdz = this.is2D ? 1.0 : this.getNQuadraticDerivative(dis.z);

    return invH.multiply(new THREE.Vector3(wdx * wy * wz, wx * wdy * wz, wx * wy * wdz));
  }

  /**
   * @returns A new Matrix3 with the MPM D matrix. This represents an
   * affine preserving matrix for transferring motion from particles to the grid.
   * See page 42 of https://www.math.ucla.edu/~cffjiang/research/mpmcourse/mpmcourse.pdf
   */
  getDQuadratic(): THREE.Matrix3 {
    const H = this.getH();
    const v = H.multiply(H).multiplyScalar(0.25);
    const m = new THREE.Matrix3(
      v.x, 0, 0,
      0, v.y, 0,
      0, 0, v.z
    );
    return m;
  }

  getNQuadratic(x: number): number {
    x = Math.abs(x);
    if (x < 0.5) { return 0.75 - x * x; }
    if (x < 1.5) { return 0.5 * (1.5 - x) * (1.5 - x); }
    return 0;
  }

  getNQuadraticDerivative(x: number): number {
    x = Math.abs(x);
    if (x < 0.5) { return -2 * x; }
    if (x < 1.5) { return x > 0 ? x - 1.5 : -(x - 1.5); }
    return 0;
  }

  /*
  getNCubic(x: number): number {
    x = Math.abs(x);
    if (x < 1.0) { return 2.0 / 3.0 - x * x + 0.5 * x * x * x; }
    if (x < 2.0) { return 1.0 / 6.0 * Math.pow(2 - x, 3); }
    return 0;
  }
  getNCubicDerivative(x: number): number {
    x = Math.abs(x);
    if (x < 1.0) { return -2 * x + 1.5 * x * x; }
    if (x < 2.0) { return x > 0 ? -0.5 * Math.pow(2 - x, 2) : 0.5 * Math.pow(2 + x, 2); }
    return 0;
  }
  */
}