import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";
import "@babylonjs/loaders/glTF";
import {
  Engine, Scene, Camera, ArcRotateCamera, Vector3, HemisphericLight, MeshBuilder,
  PointerEventTypes, SolidParticleSystem
} from "@babylonjs/core";
import * as THREE from 'three';

import { MPMSystem } from "./mpm/MPMSystem";

class App {

  canvas: HTMLCanvasElement;
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;

  // Camera variables
  aspectRatio: number;
  zoomTarget: Vector3;

  mpm: MPMSystem;
  particleSystem: SolidParticleSystem;

  constructor() {

    this.zoomTarget = Vector3.Zero();
    this.mpm = new MPMSystem();

    // create the canvas html element and attach it to the webpage
    this.canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    if (this.canvas == null) {
      throw new Error("No canvas found in HTML");
    }
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    document.body.appendChild(this.canvas);

    // initialize babylon scene and engine
    this.engine = new Engine(this.canvas, true);
    this.scene = new Scene(this.engine);

    this.camera = new ArcRotateCamera("Camera", 0, 0, 0, Vector3.Zero(), this.scene);
    this.camera.setPosition(new Vector3(0, 0, -5));
    this.camera.orthoBottom = -8;
    this.camera.orthoTop = 8;
    this.aspectRatio = this.canvas.width / this.canvas.height;
    this.camera.orthoRight = this.camera.orthoTop * this.aspectRatio;
    this.camera.orthoLeft = this.camera.orthoBottom * this.aspectRatio;
    this.updateCameraSensitivity();

    this.camera.lowerRadiusLimit = this.camera.radius;
    this.camera.upperRadiusLimit = this.camera.radius;
    this.camera.attachControl(true, false, 0);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;

    // Fix zooming in/out using the mouse wheel so it isn't too weak when
    // zoomed out, and too strong when zoomed in.
    this.camera.wheelDeltaPercentage = 0.05;

    const light1 = new HemisphericLight("light1", new Vector3(1, 1, 0), this.scene);

    this.particleSystem = new SolidParticleSystem("mpmParticleSystem", this.scene);
    this.mpm.addParticles(new THREE.Vector3(-1.6, -1.6, 0), new THREE.Vector3(1.6, 1.6, 0), 0.1, 1);
    const particleMesh = MeshBuilder.CreateSphere("particle", { diameter: 0.1, segments: 8}, this.scene);
    this.particleSystem.addShape(particleMesh, this.mpm.particles.length);
    this.particleSystem.buildMesh();
    particleMesh.dispose();

    this.particleSystem.initParticles = () => {
      for (let i = 0; i < this.mpm.particles.length; i++) {
        const mpmParticle = this.mpm.particles[i];
        const spsParticle = this.particleSystem.particles[i];
        const pos = mpmParticle.pos;
        spsParticle.position.set(pos.x, pos.y, pos.z);
      }
    };
    this.particleSystem.initParticles();
    this.particleSystem.computeParticleRotation = false;
    this.particleSystem.computeParticleColor = false;
    this.particleSystem.computeParticleTexture = false;
    this.particleSystem.setParticles();

    // hide/show the Inspector
    window.addEventListener("keydown", (ev) => {
      // Shift+Ctrl+Alt+I
      if (ev.key === 'i') {
        if (this.scene.debugLayer.isVisible()) {
          this.scene.debugLayer.hide();
        } else {
          this.scene.debugLayer.show();
        }
        this.handle_resize();
      }
    });

    window.addEventListener("resize", () => this.handle_resize());
    this.handle_resize();

    const _this = this;
    this.scene.onPointerObservable.add((kbInfo) => {
      switch (kbInfo.type) {
        case PointerEventTypes.POINTERWHEEL:
          const event = kbInfo.event as WheelEvent;
          // NOTE: Negative values of deltaY will be a swipe up (scroll up)
          const delta = -(Math.max(-1, Math.min(1, (-event.detail || event.deltaY)))) * 0.2;
          _this.zoom2DView(_this.camera, delta);

          break;

        case PointerEventTypes.POINTERMOVE:
          _this.zoomTarget = Vector3.Unproject(
            new Vector3(_this.scene.pointerX, _this.scene.pointerY, 0),
            _this.engine.getRenderWidth(),
            _this.engine.getRenderHeight(),
            _this.camera.getWorldMatrix(),
            _this.camera.getViewMatrix(),
            _this.camera.getProjectionMatrix()
          );
          break;

        default:
          break;
      }

    });

    // run the main render loop
    this.engine.runRenderLoop(() => {
      const dt = 0.01;//this.engine.getDeltaTime() / 1000.0;
      this.mpm.step(dt);
      for (let i = 0; i < this.mpm.particles.length; i++) {
        const mpmParticle = this.mpm.particles[i];
        const spsParticle = this.particleSystem.particles[i];
        const pos = mpmParticle.pos;
        spsParticle.position.set(pos.x, pos.y, pos.z);
        this.particleSystem.updateParticle(spsParticle);
      }
      this.particleSystem.setParticles();
      this.scene.render();
    });

  }

  handle_resize() {
    this.engine.resize();
    const canvasRect = this.engine.getRenderingCanvasClientRect();
    if (canvasRect != null) {
      this.aspectRatio = canvasRect.width / canvasRect.height;
      this.camera.orthoRight = (this.camera.orthoTop || 1) * this.aspectRatio;
      this.camera.orthoLeft  = (this.camera.orthoBottom || -1) * this.aspectRatio;
      this.updateCameraSensitivity();
    }
  }

  updateCameraSensitivity() {
    const orthoLeft = this.camera.orthoLeft || 0;
    const orthoRight = this.camera.orthoRight || 0;
    // Decrease pan sensitivity the closer the zoom level.
    this.camera.panningSensibility = 6000 / Math.abs(orthoLeft - orthoRight);
  }

  async zoom2DView(camera, delta: number = 0.0) {
    if (this.zoomTarget) {
      const totalX = Math.abs(camera.orthoLeft - camera.orthoRight);
      const totalY = Math.abs(camera.orthoTop - camera.orthoBottom);
      let newOrthoLeft = camera.orthoLeft;
      let newOrthoRight = camera.orthoRight;
      let newOrthoTop = camera.orthoTop;
      let newOrthoBottom = camera.orthoBottom;
      {
        const fromCoord = camera.orthoLeft - this.zoomTarget.x;
        const ratio = fromCoord / totalX;
        newOrthoLeft -= ratio * delta * this.aspectRatio;
      }
      {
        const fromCoord = camera.orthoRight - this.zoomTarget.x;
        const ratio = fromCoord / totalX;
        newOrthoRight -= ratio * delta * this.aspectRatio;
      }

      {
        const fromCoord = camera.orthoTop - this.zoomTarget.y;
        const ratio = fromCoord / totalY;
        newOrthoTop -= ratio * delta;
      }

      {
        const fromCoord = camera.orthoBottom - this.zoomTarget.y;
        const ratio = fromCoord / totalY;
        newOrthoBottom -= ratio * delta;
      }
      if (newOrthoLeft < newOrthoRight && newOrthoBottom < newOrthoTop &&
          newOrthoRight-newOrthoLeft > 2 && newOrthoTop-newOrthoBottom > 2
      ) {
        camera.orthoLeft = newOrthoLeft;
        camera.orthoRight = newOrthoRight;
        camera.orthoTop = newOrthoTop;
        camera.orthoBottom = newOrthoBottom;
        this.updateCameraSensitivity();
      }
    }
  }

}
new App();