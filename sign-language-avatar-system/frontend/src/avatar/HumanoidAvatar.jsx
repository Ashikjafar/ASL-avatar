import * as THREE from "three";
import { DEFAULT_IDLE_POSE, lerpRotation, lerpFingers } from "./poses.js";

/**
 * High-Definition 3D Humanoid Avatar & Sign Articulation Engine
 * 
 * Features:
 * - 3-Segment Articulated Fingers (MCP, PIP, DIP) with biomechanical abduction/splay.
 * - Multi-joint Opposable Thumb for clear ASL letter shapes (A, B, C, D, E, S, T, etc.).
 * - High-Contrast Hand Visibility Modes (ASL Pro, Realistic Human, Cyber Assistant, High-Contrast).
 * - Articulated upper body, expressive facial features, smooth Euler keyframe easing.
 */
// Human avatar presets: skin tone, hair, clothing (solid, contrasting with skin for hand legibility)
export const HUMAN_PRESETS = {
  "human-light": { skin: 0xf1c9a5, nail: 0xf6d8c4, hair: 0x4a2c17, cloth: 0x2b4a6f },
  "human-tan":   { skin: 0xd9a066, nail: 0xe6b88a, hair: 0x1b1210, cloth: 0x1f5c4d },
  "human-brown": { skin: 0xa56a43, nail: 0xbd8a68, hair: 0x120c0a, cloth: 0x7a2e3a },
  "human-deep":  { skin: 0x6b4226, nail: 0x84583a, hair: 0x0b0706, cloth: 0x3b3f8c },
};

// Fingers curl towards the palm. The palm is on the hand's +z side (nails on -z), so a positive
// curl value from the pose library has to be a NEGATIVE x rotation in three.js. (Arm joints need
// no flip: the skeleton is modelled facing -z, where a positive x swings the arm forward.)
const FINGER_FLEX = -1;

// Facial expression targets: brow tilt (inner-end down is +), brow lift, mouth curve
// (+smile / -frown), mouth open, eye squint. Used by _updateFace().
const EXPRESSIONS = {
  neutral:  { tilt: 0.0,   lift: 0.0,    curve: 0.12, open: 0.0,  squint: 0.0 },
  smile:    { tilt: -0.10, lift: 0.004,  curve: 0.95, open: 0.0,  squint: 0.18 },
  serious:  { tilt: 0.28,  lift: -0.004, curve: -0.10, open: 0.0, squint: 0.05 },
  focused:  { tilt: 0.14,  lift: -0.002, curve: 0.0,  open: 0.0,  squint: 0.10 },
  question: { tilt: -0.22, lift: 0.014,  curve: 0.0,  open: 0.22, squint: 0.0 },
};

export class HumanoidAvatar {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    // The skeleton (and the pose library) is modelled facing -z; turn the whole figure around so
    // it faces the camera. Rotating (not mirroring) keeps left/right hands anatomically correct.
    this.group.rotation.y = Math.PI;
    this.scene.add(this.group);

    this.currentStyle = options.style || "human-tan"; // human-*, "pro-hands", "natural", "cyber", "high-contrast"

    // State & Pose
    this.currentPose = JSON.parse(JSON.stringify(DEFAULT_IDLE_POSE));
    this.targetPose = JSON.parse(JSON.stringify(DEFAULT_IDLE_POSE));
    this.transitionTime = 0.32;
    this.transitionProgress = 1.0;
    this.previousPose = JSON.parse(JSON.stringify(DEFAULT_IDLE_POSE));

    // Animation & Emotion
    this.clock = new THREE.Clock();
    this.idleTime = 0;
    this.blinkTimer = 0;
    this.isBlinking = false;
    this.expression = "neutral";
    this.mouthOpening = 0;

    // Materials dictionary for dynamic style switching
    this.materials = {};

    // Build Avatar Meshes and Skeleton Joints
    this._buildMaterials();
    this._buildSkeleton();
    this.setStyle(this.currentStyle);
  }

  _buildMaterials() {
    // 1. Mannequin Chassis (Matte White/Grey)
    this.materials.skin = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.2,
      metalness: 0.1,
    });

    // 2. High-Visibility Hand Plate (Bright White)
    this.materials.handSkin = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.15,
      metalness: 0.2,
    });

    // 3. Fingernail / Sensor plates
    this.materials.fingernail = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      roughness: 0.1,
      metalness: 0.8,
    });

    // 4. Knuckle Joints / Actuators (Glowing Cyan)
    this.materials.knuckleAccent = new THREE.MeshStandardMaterial({
      color: 0x00f2fe,
      emissive: 0x00b4d8,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.7,
    });

    // 5. Suit / Core Chassis (Dark Carbon)
    this.materials.suit = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.6,
      metalness: 0.5,
    });

    // 6. Suit Glowing Accent Trim
    this.materials.suitAccent = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: 0x2563eb,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.8,
    });

    // 8. Face materials (used by human styles)
    this.materials.eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    this.materials.pupil = new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 0.2 });
    this.materials.iris = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.3 });
    this.materials.hair = new THREE.MeshStandardMaterial({ color: 0x1b1210, roughness: 0.85 });
    this.materials.mouth = new THREE.MeshStandardMaterial({ color: 0x9b3d45, roughness: 0.5 });
    this.materials.mouthInside = new THREE.MeshStandardMaterial({ color: 0x3a0f14, roughness: 0.8 });

    // 7. Core Joint Ball Material (Dark Metallic)
    this.materials.joint = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
      metalness: 0.8,
    });
  }

  /**
   * Switch avatar appearance. Human presets (human-light/tan/brown/deep) show a real face,
   * hair and clothing; the older styles keep the mannequin / android look.
   */
  setStyle(styleName) {
    this.currentStyle = styleName;
    const m = this.materials;

    // Reset everything first so styles never leak into each other
    // (e.g. "cyber" used to leave metalness=0.9 on the hands forever).
    m.skin.color.setHex(0xe2e8f0); m.skin.roughness = 0.2; m.skin.metalness = 0.1;
    m.handSkin.color.setHex(0xffffff); m.handSkin.roughness = 0.15; m.handSkin.metalness = 0.2;
    m.fingernail.color.setHex(0x3b82f6); m.fingernail.roughness = 0.1; m.fingernail.metalness = 0.8;
    m.knuckleAccent.emissiveIntensity = 0.6; m.knuckleAccent.roughness = 0.2; m.knuckleAccent.metalness = 0.7;
    m.suit.color.setHex(0x0f172a); m.suit.roughness = 0.6; m.suit.metalness = 0.5;
    m.joint.color.setHex(0x1e293b); m.joint.roughness = 0.4; m.joint.metalness = 0.8;

    const preset = HUMAN_PRESETS[styleName];
    const isHuman = !!preset;
    this.techParts?.forEach((o) => (o.visible = !isHuman));
    if (this.face) this.face.group.visible = isHuman;

    if (isHuman) {
      m.skin.color.setHex(preset.skin); m.skin.roughness = 0.65; m.skin.metalness = 0;
      m.handSkin.color.setHex(preset.skin); m.handSkin.roughness = 0.55; m.handSkin.metalness = 0;
      m.knuckleAccent.color.setHex(preset.skin); m.knuckleAccent.emissive.setHex(0x000000);
      m.knuckleAccent.emissiveIntensity = 0; m.knuckleAccent.roughness = 0.6; m.knuckleAccent.metalness = 0;
      m.fingernail.color.setHex(preset.nail); m.fingernail.roughness = 0.35; m.fingernail.metalness = 0;
      m.suit.color.setHex(preset.cloth); m.suit.roughness = 0.85; m.suit.metalness = 0;
      m.joint.color.setHex(preset.cloth); m.joint.roughness = 0.85; m.joint.metalness = 0;
      m.hair.color.setHex(preset.hair);
      return;
    }

    if (styleName === "pro-hands") {
      m.knuckleAccent.color.setHex(0x3b82f6);
      m.knuckleAccent.emissive.setHex(0x2563eb);
    } else if (styleName === "natural") {
      m.handSkin.color.setHex(0xe2e8f0);
      m.knuckleAccent.color.setHex(0x94a3b8);
      m.knuckleAccent.emissive.setHex(0x000000);
    } else if (styleName === "cyber") {
      m.handSkin.color.setHex(0x0f172a);
      m.handSkin.metalness = 0.9;
      m.knuckleAccent.color.setHex(0x00f2fe);
      m.knuckleAccent.emissive.setHex(0x00f2fe);
    } else if (styleName === "high-contrast") {
      m.handSkin.roughness = 0.2;
      m.fingernail.color.setHex(0x000000);
      m.knuckleAccent.color.setHex(0xf59e0b);
      m.knuckleAccent.emissive.setHex(0xf59e0b);
      m.suit.color.setHex(0x050508);
      m.skin.color.setHex(0xffffff);
    }
  }

  _buildSkeleton() {
    // 1. Root / Lower Torso
    this.rootJoint = new THREE.Group();
    this.rootJoint.position.set(0, -0.32, 0);
    this.group.add(this.rootJoint);

    const torsoMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.20, 0.44, 20),
      this.materials.suit
    );
    torsoMesh.position.y = 0.22;
    torsoMesh.castShadow = true;
    torsoMesh.receiveShadow = true;
    this.rootJoint.add(torsoMesh);

    // Torso side glowing accent stripes
    const stripeGeo = new THREE.BoxGeometry(0.015, 0.42, 0.18);
    const leftStripe = new THREE.Mesh(stripeGeo, this.materials.suitAccent);
    leftStripe.position.set(-0.225, 0.22, 0);
    this.rootJoint.add(leftStripe);

    const rightStripe = new THREE.Mesh(stripeGeo, this.materials.suitAccent);
    rightStripe.position.set(0.225, 0.22, 0);
    this.rootJoint.add(rightStripe);

    // 2. Chest / Upper Torso
    this.chestJoint = new THREE.Group();
    this.chestJoint.position.set(0, 0.44, 0);
    this.rootJoint.add(this.chestJoint);

    const chestMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.27, 0.23, 0.36, 20),
      this.materials.suit
    );
    chestMesh.position.y = 0.18;
    chestMesh.castShadow = true;
    this.chestJoint.add(chestMesh);

    // Chest Emblem / ASL Studio Badge
    const badge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.015, 16),
      this.materials.suitAccent
    );
    badge.rotation.x = Math.PI / 2;
    badge.position.set(0, 0.22, -0.26);
    this.chestJoint.add(badge);

    // 3. Neck & Head
    this.neckJoint = new THREE.Group();
    this.neckJoint.position.set(0, 0.36, 0);
    this.chestJoint.add(this.neckJoint);

    const neckMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.105, 0.18, 16),
      this.materials.skin
    );
    neckMesh.position.y = 0.09;
    this.neckJoint.add(neckMesh);

    this.headJoint = new THREE.Group();
    this.headJoint.position.set(0, 0.18, 0);
    this.neckJoint.add(this.headJoint);

    // The head's features (face, visor) are modelled on +z; this wrapper turns them to the
    // skeleton's front (-z) so the head can be posed in plain "facing forward" terms.
    this.headFront = new THREE.Group();
    this.headFront.rotation.y = Math.PI;
    this.headJoint.add(this.headFront);

    // Head Base Shape (Smooth stylized faceless mannequin head)
    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 28, 28),
      this.materials.skin
    );
    headMesh.scale.set(1.0, 1.14, 1.05);
    headMesh.position.y = 0.2;
    headMesh.castShadow = true;
    this.headJoint.add(headMesh);

    // Glowing Visor / Sensor array (Robotic feature)
    const visorGeo = new THREE.BoxGeometry(0.26, 0.06, 0.18);
    const visor = new THREE.Mesh(visorGeo, this.materials.suitAccent);
    visor.position.set(0, 0.22, 0.14);
    visor.rotation.x = -0.1;
    this.headFront.add(visor);
    this.techParts = [leftStripe, rightStripe, badge, visor]; // hidden for human styles
    this._buildFace();

    // 4. Arms & High-Definition Articulated Hands (Left and Right)
    this.leftArm = this._buildArm("left");
    this.chestJoint.add(this.leftArm.shoulderJoint);

    this.rightArm = this._buildArm("right");
    this.chestJoint.add(this.rightArm.shoulderJoint);
  }

  /**
   * Builds the human face (eyes, brows, nose, mouth, ears, hair) on the head ellipsoid.
   * Head surface: centre (0,0.2,0), radii (0.22, 0.25, 0.231). Everything sits on that surface.
   */
  _buildFace() {
    const M = this.materials;
    const group = new THREE.Group();
    this.headFront.add(group);

    // Eyes (blink by squashing scale.y)
    const makeEye = (x) => {
      const eye = new THREE.Group();
      eye.position.set(x, 0.225, 0.192);
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.031, 18, 14), M.eyeWhite);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.019, 16, 12), M.iris);
      iris.position.z = 0.026; iris.scale.z = 0.5;
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 12, 10), M.pupil);
      pupil.position.z = 0.033; pupil.scale.z = 0.4;
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 8, 6), M.eyeWhite);
      glint.position.set(0.006, 0.007, 0.039);
      eye.add(white, iris, pupil, glint);
      group.add(eye);
      return eye;
    };
    const eyeL = makeEye(-0.075), eyeR = makeEye(0.075);

    // Brows
    const browGeo = new THREE.BoxGeometry(0.062, 0.011, 0.012);
    const browL = new THREE.Mesh(browGeo, M.hair), browR = new THREE.Mesh(browGeo, M.hair);
    browL.position.set(-0.075, 0.275, 0.208); browR.position.set(0.075, 0.275, 0.208);
    group.add(browL, browR);

    // Nose, ears
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.021, 14, 12), M.skin);
    nose.position.set(0, 0.162, 0.224); nose.scale.set(0.9, 1.2, 0.9);
    group.add(nose);
    const earGeo = new THREE.SphereGeometry(0.032, 12, 10);
    const earL = new THREE.Mesh(earGeo, M.skin), earR = new THREE.Mesh(earGeo, M.skin);
    earL.position.set(-0.216, 0.19, -0.01); earR.position.set(0.216, 0.19, -0.01);
    earL.scale.set(0.45, 1, 0.8); earR.scale.set(0.45, 1, 0.8);
    group.add(earL, earR);

    // Mouth: dark opening + lip arc (arc flips between smile and frown)
    const mouth = new THREE.Group();
    mouth.position.set(0, 0.105, 0.2135);
    const inside = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), M.mouthInside);
    inside.scale.set(1, 0.05, 0.25);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.005, 8, 24, Math.PI), M.mouth);
    lip.position.y = 0.012;
    mouth.add(inside, lip);
    group.add(mouth);

    // Hair cap: tilted back so the forehead and brows stay visible
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.5),
      M.hair
    );
    hair.scale.set(1.0, 1.14, 1.05);
    hair.position.set(0, 0.22, -0.01);
    hair.rotation.x = -0.5;
    hair.castShadow = true;
    group.add(hair);

    this.face = { group, eyeL, eyeR, browL, browR, mouth, lip, inside };
    this.faceState = { tilt: 0, lift: 0, curve: 0.12, open: 0, squint: 0 };
    this.blink = { timer: 2 + Math.random() * 2, phase: 0 };
    group.visible = false; // shown by setStyle() for human styles
  }

  /** Eases the face toward the current expression, plus natural blinking. */
  _updateFace(dt) {
    if (!this.face || !this.face.group.visible) return;
    const f = this.face, st = this.faceState;
    const target = EXPRESSIONS[this.expression] || EXPRESSIONS.neutral;
    const k = 1 - Math.exp(-dt * 10);
    for (const key of Object.keys(st)) st[key] += (target[key] - st[key]) * k;
    if (typeof this.currentPose.mouthOpen === "number") st.open = Math.max(st.open, this.currentPose.mouthOpen);

    // Blink every 2.5-5.5s, 0.16s long
    const b = this.blink;
    b.timer -= dt;
    if (b.timer <= 0 && b.phase === 0) b.phase = 0.0001;
    if (b.phase > 0) {
      b.phase += dt / 0.16;
      if (b.phase >= 1) { b.phase = 0; b.timer = 2.5 + Math.random() * 3; }
    }
    const blinkAmt = b.phase > 0 ? Math.sin(b.phase * Math.PI) : 0;
    const eyeScale = Math.max(0.08, 1 - st.squint - blinkAmt * 0.92);
    f.eyeL.scale.y = f.eyeR.scale.y = eyeScale;

    f.browL.rotation.z = -st.tilt; f.browR.rotation.z = st.tilt;
    f.browL.position.y = f.browR.position.y = 0.275 + st.lift;

    f.lip.rotation.z = st.curve >= 0 ? Math.PI : 0;
    f.lip.scale.y = Math.max(0.08, Math.abs(st.curve));
    f.inside.visible = st.open > 0.04;
    f.inside.scale.y = 0.05 + st.open * 0.9;
    f.lip.position.y = st.curve >= 0 ? 0.012 + st.open * 0.01 : -0.004;
  }

  /**
   * Builds Arm with High-Precision 3-Segment Hand
   */
  _buildArm(side = "right") {
    const isLeft = side === "left";
    const sign = isLeft ? -1 : 1;

    // 1. Shoulder Joint
    const shoulderJoint = new THREE.Group();
    shoulderJoint.position.set(sign * 0.29, 0.27, 0);

    const shoulderMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 16, 16),
      this.materials.joint
    );
    shoulderJoint.add(shoulderMesh);

    // 2. Upper Arm
    const upperArmJoint = new THREE.Group();
    shoulderJoint.add(upperArmJoint);

    const upperArmMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.062, 0.054, 0.34, 16),
      this.materials.suit
    );
    upperArmMesh.position.y = -0.17;
    upperArmMesh.castShadow = true;
    upperArmJoint.add(upperArmMesh);

    // 3. Elbow Joint
    const elbowJoint = new THREE.Group();
    elbowJoint.position.set(0, -0.34, 0);
    upperArmJoint.add(elbowJoint);

    const elbowMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.058, 16, 16),
      this.materials.joint
    );
    elbowJoint.add(elbowMesh);

    // 4. Forearm
    const forearmMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.054, 0.046, 0.32, 16),
      this.materials.suit
    );
    forearmMesh.position.y = -0.16;
    forearmMesh.castShadow = true;
    elbowJoint.add(forearmMesh);

    // 5. Wrist Joint
    const wristJoint = new THREE.Group();
    wristJoint.position.set(0, -0.32, 0);
    elbowJoint.add(wristJoint);

    const wristMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.046, 0.044, 0.04, 16),
      this.materials.joint
    );
    wristJoint.add(wristMesh);

    // 6. Anatomical Palm Mesh (Slightly tapered, curved with thumb mount)
    const palmGroup = new THREE.Group();
    wristJoint.add(palmGroup);

    // Main central palm
    const palmMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.088, 0.105, 0.034),
      this.materials.handSkin
    );
    palmMesh.position.set(0, -0.058, 0);
    palmMesh.castShadow = true;
    palmGroup.add(palmMesh);

    // Thenar eminence (Thumb base muscle pad for realistic hand volume)
    const thenarMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 12, 12),
      this.materials.handSkin
    );
    thenarMesh.scale.set(1.0, 1.4, 0.85);
    thenarMesh.position.set(isLeft ? 0.042 : -0.042, -0.042, 0.01);
    palmGroup.add(thenarMesh);

    // 7. High-Definition 3-Segment Articulated Fingers
    const fingers = this._buildPrecisionFingers(wristJoint, isLeft);

    return {
      shoulderJoint,
      upperArmJoint,
      elbowJoint,
      wristJoint,
      fingers,
    };
  }

  /**
   * Builds High-Precision 3-Segment Fingers (MCP, PIP, DIP) + Multi-joint Thumb
   */
  _buildPrecisionFingers(wristJoint, isLeft) {
    const fingers = {};

    // Anatomically calibrated finger positions and lengths
    const fingerConfigs = [
      {
        name: "index",
        x: isLeft ? 0.031 : -0.031,
        y: -0.11,
        len1: 0.036,
        len2: 0.026,
        len3: 0.022,
        w: 0.015,
        splay: isLeft ? 0.08 : -0.08,
      },
      {
        name: "middle",
        x: isLeft ? 0.010 : -0.010,
        y: -0.114,
        len1: 0.040,
        len2: 0.028,
        len3: 0.024,
        w: 0.015,
        splay: 0.0,
      },
      {
        name: "ring",
        x: isLeft ? -0.011 : 0.011,
        y: -0.11,
        len1: 0.036,
        len2: 0.025,
        len3: 0.022,
        w: 0.014,
        splay: isLeft ? -0.06 : 0.06,
      },
      {
        name: "pinky",
        x: isLeft ? -0.031 : 0.031,
        y: -0.102,
        len1: 0.028,
        len2: 0.020,
        len3: 0.018,
        w: 0.013,
        splay: isLeft ? -0.14 : 0.14,
      },
    ];

    // Build 4 Fingers (Index, Middle, Ring, Pinky)
    fingerConfigs.forEach((cfg) => {
      // 1. Base / MCP Knuckle Joint
      const baseJoint = new THREE.Group();
      baseJoint.position.set(cfg.x, cfg.y, 0);
      baseJoint.rotation.z = cfg.splay;
      wristJoint.add(baseJoint);

      // Knuckle sphere
      const knuckleSphere = new THREE.Mesh(
        new THREE.SphereGeometry(cfg.w * 1.1, 10, 10),
        this.materials.knuckleAccent
      );
      baseJoint.add(knuckleSphere);

      // Proximal Phalanx (Segment 1)
      const seg1Mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(cfg.w * 0.95, cfg.w * 0.88, cfg.len1, 12),
        this.materials.handSkin
      );
      seg1Mesh.position.y = -cfg.len1 * 0.5;
      seg1Mesh.castShadow = true;
      baseJoint.add(seg1Mesh);

      // 2. Middle / PIP Joint
      const midJoint = new THREE.Group();
      midJoint.position.set(0, -cfg.len1, 0);
      baseJoint.add(midJoint);

      const midKnuckle = new THREE.Mesh(
        new THREE.SphereGeometry(cfg.w * 0.9, 10, 10),
        this.materials.handSkin
      );
      midJoint.add(midKnuckle);

      // Intermediate Phalanx (Segment 2)
      const seg2Mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(cfg.w * 0.85, cfg.w * 0.78, cfg.len2, 12),
        this.materials.handSkin
      );
      seg2Mesh.position.y = -cfg.len2 * 0.5;
      seg2Mesh.castShadow = true;
      midJoint.add(seg2Mesh);

      // 3. Tip / DIP Joint
      const tipJoint = new THREE.Group();
      tipJoint.position.set(0, -cfg.len2, 0);
      midJoint.add(tipJoint);

      // Distal Phalanx (Segment 3)
      const seg3Mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(cfg.w * 0.78, cfg.w * 0.60, cfg.len3, 12),
        this.materials.handSkin
      );
      seg3Mesh.position.y = -cfg.len3 * 0.5;
      seg3Mesh.castShadow = true;
      tipJoint.add(seg3Mesh);

      // Fingernail Contrast Plate (Provides visual orientation cues for signers)
      const nailMesh = new THREE.Mesh(
        new THREE.BoxGeometry(cfg.w * 0.7, cfg.len3 * 0.45, 0.005),
        this.materials.fingernail
      );
      nailMesh.position.set(0, -cfg.len3 * 0.6, -cfg.w * 0.45);
      tipJoint.add(nailMesh);

      fingers[cfg.name] = {
        base: baseJoint,
        mid: midJoint,
        tip: tipJoint,
        defaultSplay: cfg.splay,
      };
    });

    // 8. Fully Opposable Multi-Joint Thumb
    const thumbX = isLeft ? 0.048 : -0.048;
    const thumbBase = new THREE.Group();
    thumbBase.position.set(thumbX, -0.045, 0.015);
    thumbBase.rotation.z = isLeft ? -0.55 : 0.55;
    thumbBase.rotation.y = isLeft ? 0.35 : -0.35;
    wristJoint.add(thumbBase);

    // Thumb Metacarpal Ball
    const thumbKnuckle = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 10, 10),
      this.materials.knuckleAccent
    );
    thumbBase.add(thumbKnuckle);

    // Thumb Proximal Segment
    const thumbSeg1 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.017, 0.015, 0.034, 12),
      this.materials.handSkin
    );
    thumbSeg1.position.y = -0.017;
    thumbSeg1.castShadow = true;
    thumbBase.add(thumbSeg1);

    // Thumb Interphalangeal Joint
    const thumbTip = new THREE.Group();
    thumbTip.position.set(0, -0.034, 0);
    thumbBase.add(thumbTip);

    // Thumb Distal Segment
    const thumbSeg2 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.012, 0.030, 12),
      this.materials.handSkin
    );
    thumbSeg2.position.y = -0.015;
    thumbSeg2.castShadow = true;
    thumbTip.add(thumbSeg2);

    // Thumb Nail
    const thumbNail = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.014, 0.005),
      this.materials.fingernail
    );
    thumbNail.position.set(0, -0.018, -0.008);
    thumbTip.add(thumbNail);

    fingers.thumb = {
      base: thumbBase,
      mid: thumbTip,
      tip: thumbTip,
      defaultSplay: isLeft ? -0.55 : 0.55,
    };

    return fingers;
  }

  /**
   * Set target pose for smooth interpolation.
   *
   * Poses may be partial (e.g. a keyframe that only moves the right forearm). Joints a pose
   * leaves out are taken from a base pose so nothing gets stuck from a previous sign:
   *  - fromIdle = true  (first keyframe of a sign / a fingerspelled letter): base is the idle
   *    pose, so the other arm and head return to rest.
   *  - fromIdle = false (later keyframes of the same sign): base is the previous target.
   */
  setPose(targetPose, transitionTime = 0.3, { fromIdle = true } = {}) {
    const base = fromIdle ? DEFAULT_IDLE_POSE : this.targetPose;
    this.previousPose = JSON.parse(JSON.stringify(this.currentPose));
    this.targetPose = JSON.parse(JSON.stringify({ ...base, ...targetPose }));
    this.transitionTime = Math.max(0.08, transitionTime);
    this.transitionProgress = 0.0;
  }

  /**
   * Return to natural resting idle pose
   */
  resetToIdle(transitionTime = 0.35) {
    this.setPose(DEFAULT_IDLE_POSE, transitionTime, { fromIdle: true });
  }

  /**
   * Main per-frame update cycle
   */
  update(deltaTime) {
    this.idleTime += deltaTime;

    // 1. Pose Interpolation (Ease In-Out)
    if (this.transitionProgress < 1.0) {
      this.transitionProgress += deltaTime / this.transitionTime;
      if (this.transitionProgress > 1.0) this.transitionProgress = 1.0;
    }

    // Smoothstep Easing
    const t = this.transitionProgress;
    const smoothT = t * t * (3 - 2 * t);

    // Interpolate joint rotations
    this.currentPose.head = lerpRotation(this.previousPose.head, this.targetPose.head, smoothT);
    this.currentPose.neck = lerpRotation(this.previousPose.neck, this.targetPose.neck, smoothT);
    this.currentPose.chest = lerpRotation(this.previousPose.chest, this.targetPose.chest, smoothT);
    this.currentPose.leftShoulder = lerpRotation(this.previousPose.leftShoulder, this.targetPose.leftShoulder, smoothT);
    this.currentPose.leftArm = lerpRotation(this.previousPose.leftArm, this.targetPose.leftArm, smoothT);
    this.currentPose.leftForearm = lerpRotation(this.previousPose.leftForearm, this.targetPose.leftForearm, smoothT);
    this.currentPose.leftHand = lerpRotation(this.previousPose.leftHand, this.targetPose.leftHand, smoothT);
    this.currentPose.leftFingers = lerpFingers(this.previousPose.leftFingers, this.targetPose.leftFingers, smoothT);

    this.currentPose.rightShoulder = lerpRotation(this.previousPose.rightShoulder, this.targetPose.rightShoulder, smoothT);
    this.currentPose.rightArm = lerpRotation(this.previousPose.rightArm, this.targetPose.rightArm, smoothT);
    this.currentPose.rightForearm = lerpRotation(this.previousPose.rightForearm, this.targetPose.rightForearm, smoothT);
    this.currentPose.rightHand = lerpRotation(this.previousPose.rightHand, this.targetPose.rightHand, smoothT);
    this.currentPose.rightFingers = lerpFingers(this.previousPose.rightFingers, this.targetPose.rightFingers, smoothT);

    if (this.targetPose.expression) {
      this.expression = this.targetPose.expression;
    }

    // 2. Natural Idle Breathing & Dynamic Sway
    const breath = Math.sin(this.idleTime * 2.0) * 0.018;
    const sway = Math.sin(this.idleTime * 1.2) * 0.008;

    // Apply rotations to 3D skeletal hierarchy
    if (this.chestJoint && this.currentPose.chest) {
      this.chestJoint.rotation.set(
        this.currentPose.chest.x + breath,
        this.currentPose.chest.y + sway,
        this.currentPose.chest.z
      );
    }

    if (this.headJoint && this.currentPose.head) {
      // Head angles are authored for a figure facing +z; the skeleton faces -z, so nod (x) and
      // tilt (z) change sign (a turn about the vertical axis keeps its sign).
      this.headJoint.rotation.set(
        -(this.currentPose.head.x + breath * 0.5),
        this.currentPose.head.y,
        -this.currentPose.head.z
      );
    }

    // Arms (shoulder -> upper arm -> elbow -> wrist -> fingers)
    this._applyArm(this.leftArm, "left", true);
    this._applyArm(this.rightArm, "right", false);

    // 3. Facial expression, blinking (human styles)
    this._updateFace(deltaTime);
  }

  /**
   * Applies the current pose to one arm (shoulder -> upper arm -> elbow -> wrist -> fingers).
   */
  _applyArm(arm, side, isLeft) {
    if (!arm) return;
    const p = this.currentPose;
    const set = (joint, r) => {
      if (r) joint.rotation.set(r.x, r.y, r.z);
    };
    set(arm.shoulderJoint, p[`${side}Shoulder`]);
    set(arm.upperArmJoint, p[`${side}Arm`]);
    set(arm.elbowJoint, p[`${side}Forearm`]);
    set(arm.wristJoint, p[`${side}Hand`]);
    this._applyPrecisionFingerRotations(arm.fingers, p[`${side}Fingers`], isLeft);
  }

  /**
   * Applies Biomechanically Realistic 3-Segment Finger Rotations
   */
  _applyPrecisionFingerRotations(fingers, fingerAngles, isLeft) {
    if (!fingers || !fingerAngles) return;

    for (const [name, angles] of Object.entries(fingerAngles)) {
      const f = fingers[name];
      if (!f) continue;

      const curl1 = angles[0] || 0; // MCP base curl
      const curl2 = angles[1] || 0; // PIP mid curl
      const splay = angles[2] !== undefined ? angles[2] : f.defaultSplay; // Splay/Spread

      if (name === "thumb") {
        // Thumb Opposability & Flexion
        // angles[2] = how far the thumb is swung out from the palm (L, Y, thumbs-up ...)
        const out = angles[2] || 0;
        f.base.rotation.x = FINGER_FLEX * curl1;
        f.base.rotation.z = (isLeft ? -0.55 : 0.55) + curl1 * 0.3 + (isLeft ? out : -out);
        f.tip.rotation.x = FINGER_FLEX * curl2;
      } else {
        // 4 Fingers (Index, Middle, Ring, Pinky)
        // MCP Knuckle flexion + abduction spread
        f.base.rotation.x = FINGER_FLEX * curl1;
        f.base.rotation.z = splay;

        // PIP middle joint flexion
        if (f.mid) {
          f.mid.rotation.x = FINGER_FLEX * curl2;
        }

        // DIP fingertip joint flexion (coupled with PIP for natural curve)
        if (f.tip && f.tip !== f.mid) {
          f.tip.rotation.x = FINGER_FLEX * curl2 * 0.75;
        }
      }
    }
  }
  // End of precision finger rotations

  destroy() {
    this.scene.remove(this.group);
  }
}
