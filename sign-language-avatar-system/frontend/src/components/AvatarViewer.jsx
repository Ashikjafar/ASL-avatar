import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { HumanoidAvatar } from "../avatar/HumanoidAvatar.jsx";
import { POSES, FINGERSPELL_POSES, DEFAULT_IDLE_POSE } from "../avatar/poses.js";

const LIGHTING_THEMES = {
  cyan: { name: "Cyber Teal", rimColor: 0x00f2fe, ringColor: 0x2ec4b6, keyIntensity: 2.2 },
  violet: { name: "Deep Violet", rimColor: 0xc084fc, ringColor: 0x9333ea, keyIntensity: 2.0 },
  amber: { name: "Sunset Gold", rimColor: 0xfbbf24, ringColor: 0xf59e0b, keyIntensity: 2.4 },
  arctic: { name: "Arctic Ice", rimColor: 0x38bdf8, ringColor: 0x0284c7, keyIntensity: 2.2 },
  stealth: { name: "OLED Stealth", rimColor: 0x64748b, ringColor: 0x475569, keyIntensity: 1.8 },
};

const AVATAR_STYLES = [
  { id: "human-light", label: "Light", desc: "Human avatar with face, hair and clothing — light skin tone" },
  { id: "human-tan", label: "Tan", desc: "Human avatar — medium skin tone" },
  { id: "human-brown", label: "Brown", desc: "Human avatar — brown skin tone" },
  { id: "human-deep", label: "Deep", desc: "Human avatar — deep skin tone" },
  { id: "pro-hands", label: "Pro Hands", desc: "High-contrast palms & luminous knuckle accents" },
  { id: "natural", label: "Mannequin", desc: "Neutral mannequin with soft shading" },
  { id: "cyber", label: "Cyber", desc: "Futuristic android with neon accents" },
  { id: "high-contrast", label: "Contrast", desc: "Maximum contrast silhouette for accessibility" },
];

// Camera framing. Avatar space: the head spans y = 0.6 .. 1.15, shoulders ~0.4, hands sign
// between y = 0 and 0.9 and the pedestal is at -0.44. The camera's vertical FOV is 36deg, so a
// camera `radius` shows roughly targetY +/- radius * 0.325 on the avatar's plane.
// (The earlier presets were framed for a smaller avatar and cut the head off.)
const CAMERA_PRESETS = {
  standard: { label: "Signing", phi: 0.0, theta: 0.0, radius: 2.45, targetY: 0.45 }, // head, shoulders and signing space
  hands: { label: "Hands", phi: -0.04, theta: 0.0, radius: 1.7, targetY: 0.45 },
  face: { label: "Face", phi: 0.05, theta: 0.0, radius: 1.3, targetY: 0.85 },
  full: { label: "Full", phi: 0.0, theta: 0.0, radius: 2.9, targetY: 0.4 },
};

const SPEEDS = [0.5, 1, 1.5, 2];

/**
 * Turn a queued token into something the avatar can actually perform.
 * The backend library has 35 glosses but only 18 have hand-authored poses (see poses.js);
 * a "clip" without a pose used to be dropped silently, so the avatar just did nothing.
 * Those now fall back to fingerspelling. Characters that have no A-Z handshape are skipped.
 */
function normalizeTask(task) {
  if (!task) return null;
  if (task.type === "clip" && POSES[task.gloss]?.length) return task;

  const source = task.letters?.length ? task.letters : String(task.gloss || "").split("");
  const letters = source.map((c) => String(c).toUpperCase()).filter((c) => FINGERSPELL_POSES[c]);
  if (letters.length === 0) return null;
  return { ...task, type: "fingerspell", letters, fallback: task.type === "clip" };
}

/**
 * 3D Avatar Studio Stage & Sign Synthesis Viewport
 */
export default function AvatarViewer({ queueRef }) {
  const containerRef = useRef(null);
  const avatarRef = useRef(null);
  const lastSignRef = useRef(null);
  const sceneRef = useRef(null);
  const rimLightRef = useRef(null);
  const ringMatRef = useRef(null);
  const cameraControlRef = useRef(null);
  const signSpotlightRef = useRef(null);

  // Status & HUD State
  const [activeSign, setActiveSign] = useState(null);
  const [activeSignType, setActiveSignType] = useState(null);
  const [activeLetter, setActiveLetter] = useState(null);
  const [fallbackNote, setFallbackNote] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1.0);
  const [isPaused, setIsPaused] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState("Avatar Ready");
  const [activeTheme, setActiveTheme] = useState("cyan");
  const [cameraPreset, setCameraPreset] = useState("standard");
  const [avatarStyle, setAvatarStyle] = useState("human-tan");

  // Keep state accessible to animation loop via refs
  const speedRef = useRef(speedMultiplier);
  speedRef.current = speedMultiplier;

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Three.js Scene, Camera, Renderer
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const width = container.clientWidth || 700;
    const height = container.clientHeight || 520;

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
    camera.position.set(0.1, 0.28, 1.55);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 2. Lighting Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    // Key Light from top-front
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(1.5, 2.8, 2.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 10;
    scene.add(keyLight);

    // Fill Light from left
    const fillLight = new THREE.DirectionalLight(0xa5c4e8, 1.2);
    fillLight.position.set(-2.0, 1.2, 1.8);
    scene.add(fillLight);

    // DEDICATED SIGN-ZONE KEY SPOTLIGHT (Focuses directly on hands and chest sign area)
    const signSpotlight = new THREE.SpotLight(0xfff8ee, 2.6);
    signSpotlight.position.set(0, 0.4, 1.8);
    signSpotlight.target.position.set(0, 0.15, 0);
    signSpotlight.angle = Math.PI / 4;
    signSpotlight.penumbra = 0.5;
    signSpotlight.decay = 1.2;
    scene.add(signSpotlight);
    scene.add(signSpotlight.target);
    signSpotlightRef.current = signSpotlight;

    // Dynamic Neon Rim Light
    const rimLight = new THREE.DirectionalLight(0x00f2fe, 2.4);
    rimLight.position.set(0, 1.6, -2.5);
    scene.add(rimLight);
    rimLightRef.current = rimLight;

    // Pedestal Platform
    const pedestalGeo = new THREE.CylinderGeometry(0.88, 0.96, 0.08, 48);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: 0x0a1018,
      roughness: 0.35,
      metalness: 0.85,
    });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.y = -0.44;
    pedestal.receiveShadow = true;
    scene.add(pedestal);

    // Glowing Neon Ring around pedestal
    const ringGeo = new THREE.TorusGeometry(0.88, 0.012, 16, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.40;
    scene.add(ring);
    ringMatRef.current = ringMat;

    // Background Subtle Particle Grid Effect
    const particleGeo = new THREE.BufferGeometry();
    const particleCount = 60;
    const posArray = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      posArray[i] = (Math.random() - 0.5) * 4;
      posArray[i + 1] = Math.random() * 2 - 0.5;
      posArray[i + 2] = (Math.random() - 0.5) * 3 - 0.5;
    }
    particleGeo.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
    const particleMat = new THREE.PointsMaterial({
      size: 0.02,
      color: 0x4facfe,
      transparent: true,
      opacity: 0.35,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // 3. Create Avatar Instance
    const avatar = new HumanoidAvatar(scene, { style: "human-tan" });
    // (HumanoidAvatar turns itself to face the camera; do not override its rotation here.)
    avatarRef.current = avatar;

    // 4. Interactive Camera Orbit Controls
    let isDragging = false;
    let prevMousePos = { x: 0, y: 0 };
    // Start with hands-focused framing for high sign visibility
    let cameraOrbit = { ...CAMERA_PRESETS.standard };

    const updateCameraPosition = () => {
      const x = cameraOrbit.radius * Math.sin(cameraOrbit.theta) * Math.cos(cameraOrbit.phi);
      const y = cameraOrbit.targetY + 0.1 + cameraOrbit.radius * Math.sin(cameraOrbit.phi);
      const z = cameraOrbit.radius * Math.cos(cameraOrbit.theta) * Math.cos(cameraOrbit.phi);
      camera.position.set(x, y, z);
      camera.lookAt(0, cameraOrbit.targetY, 0);
    };

    cameraControlRef.current = {
      setPreset: (preset) => {
        const p = CAMERA_PRESETS[preset];
        if (!p) return;
        cameraOrbit.phi = p.phi;
        cameraOrbit.theta = p.theta;
        cameraOrbit.radius = p.radius;
        cameraOrbit.targetY = p.targetY;
        updateCameraPosition();
      },
    };

    updateCameraPosition();

    const onMouseDown = (e) => {
      isDragging = true;
      prevMousePos = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - prevMousePos.x;
      const deltaY = e.clientY - prevMousePos.y;
      prevMousePos = { x: e.clientX, y: e.clientY };

      cameraOrbit.theta -= deltaX * 0.008;
      cameraOrbit.phi = Math.max(-0.4, Math.min(0.4, cameraOrbit.phi + deltaY * 0.008));

      updateCameraPosition();
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onWheel = (e) => {
      e.preventDefault();
      cameraOrbit.radius = Math.max(1.1, Math.min(3.2, cameraOrbit.radius + e.deltaY * 0.002));
      updateCameraPosition();
    };

    const domElement = renderer.domElement;
    domElement.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    domElement.addEventListener("wheel", onWheel, { passive: false });

    // Touch Support for mobile / touchpads
    const onTouchStart = (e) => {
      if (e.touches.length === 1) {
        isDragging = true;
        prevMousePos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };
    const onTouchMove = (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - prevMousePos.x;
      const deltaY = e.touches[0].clientY - prevMousePos.y;
      prevMousePos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      cameraOrbit.theta -= deltaX * 0.01;
      cameraOrbit.phi = Math.max(-0.4, Math.min(0.4, cameraOrbit.phi + deltaY * 0.01));
      updateCameraPosition();
    };
    const onTouchEnd = () => {
      isDragging = false;
    };
    domElement.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);

    // 5. Animation Playback Queue Execution State
    let currentTask = null;
    let taskTimer = 0;
    let keyframeIndex = 0;
    let fingerspellIndex = 0;

    const finishTask = () => {
      avatar.resetToIdle(0.35);
      currentTask = null;
      setActiveSign(null);
      setActiveSignType(null);
      setActiveLetter(null);
      setFallbackNote(false);
      setAvatarStatus("Avatar Ready");
    };

    const startTask = (task) => {
      currentTask = task;
      lastSignRef.current = task;
      taskTimer = 0;
      keyframeIndex = 0;
      fingerspellIndex = 0;
      setActiveSign(task.gloss);
      setActiveSignType(task.type);

      if (task.type === "clip") {
        const frameDuration = (task.duration_ms || 900) / 1000 / POSES[task.gloss].length;
        setActiveLetter(null);
        setFallbackNote(false);
        setAvatarStatus(`Signing: ${task.gloss}`);
        avatar.setPose(POSES[task.gloss][0], frameDuration * 0.9, { fromIdle: true });
      } else {
        const first = task.letters[0];
        setActiveLetter(first);
        setFallbackNote(!!task.fallback);
        setAvatarStatus(`Fingerspelling: ${task.gloss}`);
        avatar.setPose(FINGERSPELL_POSES[first], 0.2, { fromIdle: true });
      }
    };

    // 6. Main Animation Loop
    let animationFrameId;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const rawDelta = clock.getDelta();
      const speed = speedRef.current;
      const paused = isPausedRef.current;
      const deltaTime = paused ? 0 : Math.min(rawDelta, 0.1) * speed;

      // Update avatar internal physics and easing
      avatar.update(deltaTime);

      // Subtle particle float
      particles.rotation.y += 0.0005;

      if (paused) {
        renderer.render(scene, camera);
        return;
      }

      // Queue consumer: take the next performable token (unperformable ones are skipped)
      while (!currentTask && queueRef.current.length > 0) {
        const next = normalizeTask(queueRef.current.shift());
        if (next) startTask(next);
      }

      if (currentTask) {
        taskTimer += deltaTime;

        if (currentTask.type === "clip") {
          const keyframes = POSES[currentTask.gloss];
          const frameDuration = (currentTask.duration_ms || 900) / 1000 / keyframes.length;

          if (taskTimer >= (keyframeIndex + 1) * frameDuration) {
            keyframeIndex++;
            if (keyframeIndex < keyframes.length) {
              // later keyframes may be partial: they build on the previous keyframe
              avatar.setPose(keyframes[keyframeIndex], frameDuration * 0.9, { fromIdle: false });
            } else {
              finishTask();
            }
          }
        } else if (currentTask.type === "fingerspell") {
          const letters = currentTask.letters;
          const letterDuration = 0.35; // 350ms per letter

          if (taskTimer >= (fingerspellIndex + 1) * letterDuration) {
            fingerspellIndex++;
            if (fingerspellIndex < letters.length) {
              const char = letters[fingerspellIndex];
              setActiveLetter(char);
              avatar.setPose(FINGERSPELL_POSES[char], 0.2, { fromIdle: true });
            } else {
              finishTask();
            }
          }
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container) return;
      const newW = container.clientWidth;
      const newH = container.clientHeight || 520;
      if (!newW || !newH) return;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
    };

    window.addEventListener("resize", handleResize);
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(handleResize) : null;
    resizeObserver?.observe(container);

    // Cleanup
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
      domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      domElement.removeEventListener("wheel", onWheel);
      domElement.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      cancelAnimationFrame(animationFrameId);
      avatar.destroy();
      renderer.dispose();
      renderer.forceContextLoss(); // avoid "too many WebGL contexts" when React remounts (StrictMode)
      if (domElement.parentNode) {
        domElement.parentNode.removeChild(domElement);
      }
    };
  }, [queueRef]);

  // Handle Avatar Appearance / Hand Visibility Style Switch
  const handleAvatarStyleChange = (styleId) => {
    setAvatarStyle(styleId);
    avatarRef.current?.setStyle(styleId);
  };

  // Handle Theme Change
  const handleThemeChange = (themeKey) => {
    setActiveTheme(themeKey);
    const theme = LIGHTING_THEMES[themeKey];
    if (theme && rimLightRef.current && ringMatRef.current) {
      rimLightRef.current.color.setHex(theme.rimColor);
      ringMatRef.current.color.setHex(theme.ringColor);
    }
  };

  // Handle Camera Preset Selection
  const handleCameraChange = (preset) => {
    setCameraPreset(preset);
    cameraControlRef.current?.setPreset(preset);
  };

  // Toggle between the signing view and the close-up hands view
  const toggleHandZoom = () => handleCameraChange(cameraPreset === "hands" ? "standard" : "hands");

  // Replay Last Sign
  const handleReplay = () => {
    if (lastSignRef.current) {
      queueRef.current.push({ ...lastSignRef.current });
    }
  };

  const isActive = !!activeSign;

  return (
    <div
      className={`avatar-stage theme-${activeTheme}`}
      ref={containerRef}
      style={{ width: "100%", height: "100%", minHeight: "80vh", display: "flex", justifyContent: "center", alignItems: "center" }}
    >
      {/* TOP HUD: live status + playback controls */}
      <div className="avatar-hud-top">
        <div className="avatar-badge-group">
          <div className={`hud-badge ${isActive ? "live-action" : ""}`}>
            <span className={`hud-dot ${isActive ? "active" : ""}`} />
            <span>{isPaused ? "Paused" : avatarStatus}</span>
          </div>
          {isActive && activeSignType === "clip" && (
            <div className="hud-badge sign-gloss-badge">
              <span className="hud-label">SIGN</span>
              <span className="gloss-title">{activeSign}</span>
            </div>
          )}
        </div>

        <div className="hud-controls-group">
          <div className="speed-chips-wrap" title="Playback speed">
            {SPEEDS.map((v) => (
              <button
                key={v}
                type="button"
                className={`speed-chip-btn ${speedMultiplier === v ? "active" : ""}`}
                onClick={() => setSpeedMultiplier(v)}
              >
                {v}x
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`hud-icon-btn ${isPaused ? "active-glow" : ""}`}
            onClick={() => setIsPaused((p) => !p)}
            title={isPaused ? "Resume" : "Pause"}
          >
            {isPaused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button type="button" className="hud-icon-btn" onClick={handleReplay} title="Replay the last sign">
            ↺ Replay
          </button>
          <button
            type="button"
            className={`hud-icon-btn ${cameraPreset === "hands" ? "highlight" : ""}`}
            onClick={toggleHandZoom}
            title="Zoom in on the hands"
          >
            🤲 Hand zoom
          </button>
        </div>
      </div>

      {/* Fingerspelling overlay: current letter */}
      {isActive && activeSignType === "fingerspell" && (
        <div className="fingerspell-overlay-card">
          <div className="fingerspell-label">{fallbackNote ? "NO SIGN YET · SPELLING" : "FINGERSPELLING"}</div>
          <div className="fingerspell-char-box">{activeLetter}</div>
          <div className="fingerspell-word">{activeSign}</div>
        </div>
      )}

      {/* BOTTOM HUD: avatar look, camera framing, lighting */}
      <div className="avatar-hud-bottom">
        <div className="avatar-style-selector-bar">
          <span className="hud-sub-label">Avatar</span>
          {AVATAR_STYLES.map((st) => (
            <button
              key={st.id}
              type="button"
              className={`style-chip-btn ${avatarStyle === st.id ? "active" : ""}`}
              onClick={() => handleAvatarStyleChange(st.id)}
              title={st.desc}
            >
              {st.label}
            </button>
          ))}
        </div>

        <div className="camera-presets-bar">
          <span className="hud-sub-label">View</span>
          {Object.entries(CAMERA_PRESETS).map(([id, p]) => (
            <button
              key={id}
              type="button"
              className={`preset-btn ${cameraPreset === id ? "active" : ""}`}
              onClick={() => handleCameraChange(id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="lighting-theme-bar">
          <span className="hud-sub-label">Light</span>
          {Object.entries(LIGHTING_THEMES).map(([key, theme]) => (
            <button
              key={key}
              type="button"
              className={`theme-dot-btn ${activeTheme === key ? "active" : ""}`}
              onClick={() => handleThemeChange(key)}
              title={theme.name}
            >
              <span className={`dot-color ${key}`} />
            </button>
          ))}
        </div>
      </div>

      <div className="avatar-hint-bar">Drag to rotate · Scroll to zoom</div>
    </div>
  );
}
