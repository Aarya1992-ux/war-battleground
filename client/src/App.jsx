import { useState, useEffect, useCallback, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  NODES, NODE_IDS, EDGES,
  initialBoard, getCapturesFor, getMovesFor,
  anyCaptureAvailable, countPieces, applyStep, getAIMove,
} from "./gameLogic.js";
import { unlockAudio, playMoveSound, playCaptureSound, playVictorySound, playErrorSound } from "./sound.js";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8080";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080/api";
const COLORS = { A: 0xdc2626, B: 0x1e3a8a };
const ARMY_NAME = { A: "Crimson Legion", B: "Steel Legion" };

async function apiFetch(path, opts = {}, token) {
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const SCALE = 1 / 60;
function toWorld(node) {
  return { x: (node.x - 300) * SCALE, z: (node.y - 330) * SCALE };
}

export default function App() {
  const [mode, setMode] = useState(null);
  const [aiDifficulty, setAiDifficulty] = useState("medium");
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [comboText, setComboText] = useState(null);
  const [board, setBoard] = useState(initialBoard);
  const [turn, setTurn] = useState("A");
  const [selected, setSelected] = useState(null);
  const [forcedPiece, setForcedPiece] = useState(null);
  const [winner, setWinner] = useState(null);

  const [user, setUser] = useState(null);
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("bg_token") || null);
  const [authScreen, setAuthScreen] = useState(null); // null | 'login' | 'register'
  const [authError, setAuthError] = useState("");
  const [authForm, setAuthForm] = useState({ username: "", password: "" });
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [showFriends, setShowFriends] = useState(false);
  const [friends, setFriends] = useState([]);
  const [myFriendCode, setMyFriendCode] = useState("");
  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [rewardStatus, setRewardStatus] = useState(null);
  const [showRewardPopup, setShowRewardPopup] = useState(null);

  useEffect(() => {
    if (!authToken) return;
    apiFetch("/me", {}, authToken)
      .then(d => setUser(d.user))
      .catch(() => { localStorage.removeItem("bg_token"); setAuthToken(null); });
  }, [authToken]);

  function logout() {
    localStorage.removeItem("bg_token");
    setAuthToken(null);
    setUser(null);
  }

  async function submitAuth(kind) {
    setAuthError("");
    try {
      const d = await apiFetch(`/auth/${kind}`, { method: "POST", body: JSON.stringify(authForm) });
      localStorage.setItem("bg_token", d.token);
      setAuthToken(d.token);
      setUser(d.user);
      setAuthScreen(null);
      setAuthForm({ username: "", password: "" });
    } catch (e) { setAuthError(e.message); }
  }

  async function reportResult(myResult) {
    if (!authToken) return;
    try {
      const d = await apiFetch("/game/result", { method: "POST", body: JSON.stringify({ result: myResult, mode }) }, authToken);
      setUser(u => u ? { ...u, rating: d.newRating } : u);
    } catch (e) {}
  }

  async function openLeaderboard() {
    setShowLeaderboard(true);
    try { const d = await apiFetch("/leaderboard"); setLeaderboard(d.leaderboard); } catch (e) {}
  }

  async function openFriends() {
    setShowFriends(true);
    try { const d = await apiFetch("/friends", {}, authToken); setFriends(d.friends); setMyFriendCode(d.myFriendCode); } catch (e) {}
  }

  async function addFriend() {
    try {
      await apiFetch("/friends/add", { method: "POST", body: JSON.stringify({ friendCode: friendCodeInput }) }, authToken);
      setFriendCodeInput("");
      openFriends();
    } catch (e) { alert(e.message); }
  }

  async function checkRewardStatus() {
    if (!authToken) return;
    try { const d = await apiFetch("/rewards/status", {}, authToken); setRewardStatus(d); } catch (e) {}
  }
  useEffect(() => { if (authToken) checkRewardStatus(); }, [authToken]);

  async function claimReward() {
    try {
      const d = await apiFetch("/rewards/claim", { method: "POST" }, authToken);
      setShowRewardPopup(d);
      setUser(u => u ? { ...u, coins: d.coins } : u);
      checkRewardStatus();
    } catch (e) { alert(e.message); }
  }


  const [roomCode, setRoomCode] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [mySide, setMySide] = useState(null);
  const [status, setStatus] = useState("");
  const wsRef = useRef(null);
  const lastMoveRef = useRef(null);

  const resetLocal = useCallback(() => {
    setBoard(initialBoard());
    setTurn("A");
    setSelected(null);
    setForcedPiece(null);
    setWinner(null);
  }, []);

  const skipNextSyncRef = useRef(false);
  const comboCountRef = useRef(0);
  const comboTimeoutRef = useRef(null);

  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  function showCombo(n) {
    const labels = { 2: "DOUBLE STRIKE!", 3: "TRIPLE STRIKE!", 4: "QUAD STRIKE!" };
    const text = labels[n] || `${n}x MEGA STRIKE!`;
    setComboText(text);
    clearTimeout(comboTimeoutRef.current);
    comboTimeoutRef.current = setTimeout(() => setComboText(null), 1400);
  }

  function commitLocal(r) {
    sceneRef.current.animateStep?.(r);
    skipNextSyncRef.current = true;
    if (r.captured) {
      comboCountRef.current = forcedPiece ? comboCountRef.current + 1 : 1;
      playCaptureSound();
      vibrate(forcedPiece ? [40, 30, 60] : 50);
    } else {
      comboCountRef.current = 0;
      playMoveSound();
    }
    if (!r.forcedPiece && comboCountRef.current >= 2) {
      showCombo(comboCountRef.current);
      comboCountRef.current = 0;
    }
    setBoard(r.board);
    setTurn(r.nextTurn);
    setForcedPiece(r.forcedPiece);
    setWinner(r.winner);
    setSelected(r.forcedPiece || null);
    if (r.winner) { setTimeout(() => playVictorySound(), 350); vibrate([80, 60, 80, 60, 150]); }
  }

  function handleOfflineClick(id) {
    if (winner) return;
    if (mode === "ai" && turn === "B") return; // AI's turn, ignore clicks
    if (forcedPiece && id !== forcedPiece) {
      const r = applyStep(board, turn, forcedPiece, id, forcedPiece);
      if (r.ok) commitLocal(r); else playErrorSound();
      return;
    }
    if (selected) {
      if (id === selected) { setSelected(null); return; }
      if (board[id] === turn) { setSelected(id); return; }
      const r = applyStep(board, turn, selected, id, forcedPiece);
      if (r.ok) commitLocal(r); else { setSelected(null); playErrorSound(); }
      return;
    }
    if (board[id] === turn) setSelected(id);
  }

  // AI turn: compute a full move (including any chain-jump sequence) and play it out step by step
  const aiThinkingRef = useRef(false);
  useEffect(() => {
    if (mode !== "ai" || turn !== "B" || winner || aiThinkingRef.current) return;
    aiThinkingRef.current = true;
    const path = getAIMove(board, "B", aiDifficulty);
    if (!path || path.length === 0) { aiThinkingRef.current = false; return; }
    let i = 0;
    let curBoard = board;
    function playNext() {
      if (i >= path.length) { aiThinkingRef.current = false; return; }
      const step = path[i++];
      const r = applyStep(curBoard, "B", step.from, step.to, i > 1 ? step.from : null);
      if (!r.ok) { aiThinkingRef.current = false; return; }
      curBoard = r.board;
      commitLocal(r);
      setTimeout(playNext, r.captured ? 550 : 450);
    }
    const startDelay = setTimeout(playNext, 500);
    return () => clearTimeout(startDelay);
  }, [mode, turn, winner]);


  function connectWS(onOpenMsg) {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => { setStatus("Connected to server..."); ws.send(JSON.stringify(onOpenMsg)); };
    ws.onclose = () => setStatus("Disconnected. Refresh to reconnect.");
    ws.onerror = () => setStatus("Connection error — check server URL.");
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === "joined") {
        setRoomCode(msg.roomCode);
        setMySide(msg.side);
        setStatus(msg.side === "A" ? `Room created: ${msg.roomCode} — share this code!` : `Joined room ${msg.roomCode}`);
      } else if (msg.type === "state") {
        if (msg.lastMove && (msg.lastMove.from !== lastMoveRef.current?.from || msg.lastMove.to !== lastMoveRef.current?.to || msg.lastMove._seq !== lastMoveRef.current?._seq)) {
          const wasChaining = !!forcedPiece;
          lastMoveRef.current = msg.lastMove;
          sceneRef.current.animateStep?.({ from: msg.lastMove.from, to: msg.lastMove.to, captured: msg.lastMove.captured, board: msg.board });
          skipNextSyncRef.current = true;
          if (msg.lastMove.captured) {
            comboCountRef.current = wasChaining ? comboCountRef.current + 1 : 1;
            playCaptureSound();
            vibrate(wasChaining ? [40, 30, 60] : 50);
          } else {
            comboCountRef.current = 0;
            playMoveSound();
          }
          if (!msg.forcedPiece && comboCountRef.current >= 2) {
            showCombo(comboCountRef.current);
            comboCountRef.current = 0;
          }
        }
        setBoard(msg.board);
        setTurn(msg.turn);
        setForcedPiece(msg.forcedPiece);
        setWinner(msg.winner);
        setSelected(null);
        if (msg.winner) setTimeout(() => playVictorySound(), 350);
      } else if (msg.type === "error") {
        setStatus("⚠ " + msg.error);
        playErrorSound();
      }
    };
  }

  function createRoom() { setMode("online"); connectWS({ type: "create" }); }
  function joinRoom() {
    const code = roomInput.trim().toUpperCase();
    if (!code) return;
    setMode("online"); connectWS({ type: "join", roomCode: code });
  }

  function handleOnlineClick(id) {
    if (winner || mySide !== turn) return;
    if (forcedPiece && id !== forcedPiece) {
      wsRef.current?.send(JSON.stringify({ type: "move", from: forcedPiece, to: id }));
      return;
    }
    if (selected) {
      if (id === selected) { setSelected(null); return; }
      if (board[id] === turn) { setSelected(id); return; }
      wsRef.current?.send(JSON.stringify({ type: "move", from: selected, to: id }));
      return;
    }
    if (board[id] === turn) setSelected(id);
  }

  const handleNodeClickRef = useRef();
  handleNodeClickRef.current = (id) => {
    if (mode === "offline" || mode === "ai") handleOfflineClick(id);
    else handleOnlineClick(id);
  };

  function handleReset() {
    if (mode === "offline" || mode === "ai") resetLocal();
    else wsRef.current?.send(JSON.stringify({ type: "reset" }));
  }

  useEffect(() => () => wsRef.current?.close(), []);

  const captureRequired = !winner && anyCaptureAvailable(board, turn);
  const activeId = forcedPiece || selected;
  const highlightMoves = activeId
    ? (captureRequired || forcedPiece
        ? getCapturesFor(board, activeId, turn).map(c => c.to)
        : [...getMovesFor(board, activeId), ...getCapturesFor(board, activeId, turn).map(c => c.to)])
    : [];
  const counts = countPieces(board);
  const myTurnOnline = mode !== "online" || mySide === turn;

  const mountRef = useRef(null);
  const sceneRef = useRef({});

  useEffect(() => {
    if (mode !== "offline" && mode !== "online" && mode !== "ai") return;
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0704);
    scene.fog = new THREE.Fog(0x0a0704, 9, 22);

    const isMobile = mount.clientWidth < 480;
    const camera = new THREE.PerspectiveCamera(isMobile ? 50 : 42, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(0, isMobile ? 9.5 : 7.5, isMobile ? 11 : 9.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.minDistance = 5;
    controls.maxDistance = 18;
    controls.target.set(0, 0.3, 0);

    scene.add(new THREE.AmbientLight(0x8899bb, 0.35));
    const moon = new THREE.DirectionalLight(0xbfd4ff, 0.7);
    moon.position.set(-6, 11, -4);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1536, 1536);
    moon.shadow.camera.left = -7; moon.shadow.camera.right = 7;
    moon.shadow.camera.top = 7; moon.shadow.camera.bottom = -7;
    scene.add(moon);

    // war-camp torches at the four corners, warm flickering point lights
    const torchPositions = [[-4.3, 0.9, -5.2], [4.3, 0.9, -5.2], [-4.3, 0.9, 5.2], [4.3, 0.9, 5.2]];
    const torches = torchPositions.map(p => {
      const light = new THREE.PointLight(0xff8a3d, 2.2, 6.5, 2);
      light.position.set(...p);
      scene.add(light);
      const flameGeo = new THREE.SphereGeometry(0.08, 8, 8);
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb066 });
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(...p);
      scene.add(flame);
      const poleGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.9, 6);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1008, roughness: 0.9 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(p[0], 0.45, p[2]);
      scene.add(pole);
      return light;
    });

    // procedural battlefield terrain texture (trampled dirt/mud, not a polished board)
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#3a2f1f";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * 512, y = Math.random() * 512, r = 4 + Math.random() * 22;
      const shade = 30 + Math.random() * 60;
      ctx.fillStyle = `rgba(${shade+40},${shade+25},${shade},${0.08 + Math.random()*0.1})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, Math.random()*Math.PI, 0, Math.PI*2); ctx.fill();
    }
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(90,110,50,${0.1 + Math.random()*0.15})`;
      const x = Math.random()*512, y = Math.random()*512;
      ctx.fillRect(x, y, 2 + Math.random()*3, 6 + Math.random()*8);
    }
    const terrainTex = new THREE.CanvasTexture(canvas);
    terrainTex.wrapS = terrainTex.wrapT = THREE.RepeatWrapping;
    terrainTex.repeat.set(3, 3.6);

    const fieldGeo = new THREE.BoxGeometry(9.4, 0.1, 11.4);
    const fieldMat = new THREE.MeshStandardMaterial({ map: terrainTex, roughness: 0.95, metalness: 0 });
    const fieldMesh = new THREE.Mesh(fieldGeo, fieldMat);
    fieldMesh.position.y = -0.06;
    fieldMesh.receiveShadow = true;
    scene.add(fieldMesh);

    // open terrain stretching beyond the battlefield
    const groundTex = terrainTex.clone();
    groundTex.needsUpdate = true;
    groundTex.repeat.set(14, 14);
    const groundGeo = new THREE.PlaneGeometry(70, 70);
    const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, color: 0x1a1712, roughness: 1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
    ground.receiveShadow = true;
    scene.add(ground);

    // distant mountain range surrounding the battlefield
    const mountainMat = new THREE.MeshStandardMaterial({ color: 0x1c1712, roughness: 1 });
    const mountainMat2 = new THREE.MeshStandardMaterial({ color: 0x141009, roughness: 1 });
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2 + Math.random() * 0.15;
      const dist = 20 + Math.random() * 8;
      const h = 3.5 + Math.random() * 4.5;
      const peak = new THREE.Mesh(new THREE.ConeGeometry(2.2 + Math.random() * 2, h, 6), i % 2 ? mountainMat : mountainMat2);
      peak.position.set(Math.cos(ang) * dist, h / 2 - 0.3, Math.sin(ang) * dist);
      peak.rotation.y = Math.random() * Math.PI;
      scene.add(peak);
    }

    // forest ring closer in, between the battlefield and the mountains
    function makeTree() {
      const g = new THREE.Group();
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.9 });
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6), trunkMat);
      trunk.position.y = 0.25;
      trunk.castShadow = true;
      g.add(trunk);
      const foliageMat = new THREE.MeshStandardMaterial({ color: 0x1e2e14, roughness: 0.95 });
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42 - i * 0.09, 0.55, 7), foliageMat);
        cone.position.y = 0.55 + i * 0.32;
        cone.castShadow = true;
        g.add(cone);
      }
      return g;
    }
    for (let i = 0; i < 55; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 7.5 + Math.random() * 8;
      const tree = makeTree();
      const s = 0.7 + Math.random() * 0.8;
      tree.scale.set(s, s, s);
      tree.position.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
      scene.add(tree);
    }

    // camp banners at the two funnel tips (beyond the outermost base nodes)
    function makeBanner(x, z, color, flip) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.6, 8), new THREE.MeshStandardMaterial({ color: 0x1a1008, roughness: 0.8 }));
      pole.position.y = 0.8;
      pole.castShadow = true;
      g.add(pole);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.34), new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.15 }));
      cloth.position.set(flip ? -0.27 : 0.27, 1.35, 0);
      g.add(cloth);
      g.position.set(x, 0, z);
      scene.add(g);
    }
    makeBanner(0, toWorld(NODES[39]).z - 0.7, COLORS.A, false);
    makeBanner(0, toWorld(NODES[43]).z + 0.7, COLORS.B, true);

    const seenEdges = new Set();
    const lineMat = new THREE.MeshStandardMaterial({ color: 0x8a7550, roughness: 0.85, metalness: 0.05 });
    for (const e of EDGES) {
      const [a, b] = e.split("|").map(Number);
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      const A = toWorld(NODES[a]), B = toWorld(NODES[b]);
      const dx = B.x - A.x, dz = B.z - A.z;
      const len = Math.hypot(dx, dz);
      const geo = new THREE.CylinderGeometry(0.03, 0.03, len, 6);
      const mesh = new THREE.Mesh(geo, lineMat);
      mesh.position.set((A.x + B.x) / 2, 0.008, (A.z + B.z) / 2);
      mesh.rotation.set(0, -Math.atan2(dz, dx), Math.PI / 2);
      scene.add(mesh);
    }

    const nodeMatBase = new THREE.MeshStandardMaterial({ color: 0xc9955a, roughness: 0.3, metalness: 0.6 });
    const hitMeshes = {};
    for (const id of NODE_IDS) {
      const w = toWorld(NODES[id]);
      const geo = new THREE.CylinderGeometry(0.09, 0.1, 0.035, 14);
      const mesh = new THREE.Mesh(geo, nodeMatBase.clone());
      mesh.position.set(w.x, 0.025, w.z);
      mesh.castShadow = true;
      scene.add(mesh);

      const hitGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.6, 8);
      const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
      hitMesh.position.set(w.x, 0.2, w.z);
      hitMesh.userData.nodeId = id;
      scene.add(hitMesh);
      hitMeshes[id] = hitMesh;
    }

    function makeSoldier(army) {
      const g = new THREE.Group();
      const color = COLORS[army];
      const trim = army === "A" ? 0xffd27a : 0xc9d8ff;
      const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.3 });
      const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.25, metalness: 0.8 });

      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.04, 14), trimMat);
      base.position.y = 0.02;
      base.castShadow = true;
      g.add(base);

      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.3, 10), mat);
      body.position.y = 0.19;
      body.castShadow = true;
      g.add(body);

      const cape = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 8, 1, true), new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide }));
      cape.position.set(0, 0.2, -0.03);
      cape.rotation.x = Math.PI;
      g.add(cape);

      const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 10), trimMat);
      shoulder.position.y = 0.34;
      shoulder.castShadow = true;
      g.add(shoulder);
      const shL = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), mat);
      shL.position.set(-0.19, 0.345, 0);
      g.add(shL);
      const shR = shL.clone();
      shR.position.x = 0.19;
      g.add(shR);

      const armGeo = new THREE.CylinderGeometry(0.035, 0.03, 0.22, 8);
      const armL = new THREE.Mesh(armGeo, mat);
      armL.position.set(-0.2, 0.2, 0);
      armL.rotation.z = 0.15;
      armL.castShadow = true;
      g.add(armL);
      const armR = armL.clone();
      armR.position.x = 0.2;
      armR.rotation.z = -0.15;
      g.add(armR);

      const headMat = new THREE.MeshStandardMaterial({ color: 0xe8c9a0, roughness: 0.5 });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 12), headMat);
      head.position.y = 0.47;
      head.castShadow = true;
      g.add(head);

      const helm = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.09, 12), trimMat);
      helm.position.y = 0.55;
      g.add(helm);
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
      plume.position.y = 0.68;
      g.add(plume);

      const swordMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.2, metalness: 0.9 });
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.4, 0.05), swordMat);
      blade.position.set(0.22, 0.28, 0.05);
      blade.rotation.z = -0.35;
      g.add(blade);
      const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.03), trimMat);
      hilt.position.set(0.17, 0.1, 0.05);
      hilt.rotation.z = -0.35;
      g.add(hilt);

      return g;
    }

    const pieceGroups = {};
    const activeAnims = [];
    let shakeUntil = 0;

    function syncPieces(currentBoard) {
      for (const id of NODE_IDS) {
        const owner = currentBoard[id];
        const existing = pieceGroups[id];
        if (owner && !existing) {
          const w = toWorld(NODES[id]);
          const g = makeSoldier(owner);
          g.position.set(w.x, 0.015, w.z);
          scene.add(g);
          pieceGroups[id] = { group: g, army: owner };
        } else if (!owner && existing) {
          scene.remove(existing.group);
          delete pieceGroups[id];
        } else if (owner && existing && existing.army !== owner) {
          scene.remove(existing.group);
          const w = toWorld(NODES[id]);
          const g = makeSoldier(owner);
          g.position.set(w.x, 0.015, w.z);
          scene.add(g);
          pieceGroups[id] = { group: g, army: owner };
        }
      }
    }

    // Animate one move/capture step: slide the moving piece, knock back + fall the captured piece.
    function animateStep({ from, to, captured }) {
      const moving = pieceGroups[from];
      if (moving) {
        const wTo = toWorld(NODES[to]);
        const start = { x: moving.group.position.x, z: moving.group.position.z };
        activeAnims.push({
          t0: performance.now(), duration: 320,
          update: (p) => {
            moving.group.position.x = start.x + (wTo.x - start.x) * p;
            moving.group.position.z = start.z + (wTo.z - start.z) * p;
            moving.group.position.y = 0.015 + Math.sin(p * Math.PI) * 0.18;
            moving.group.rotation.y = p * Math.PI * 0.3;
          },
          done: () => { moving.group.rotation.y = 0; },
        });
        delete pieceGroups[from];
        pieceGroups[to] = moving;
      }
      if (captured && pieceGroups[captured]) {
        const dead = pieceGroups[captured];
        delete pieceGroups[captured];
        const dir = Math.random() > 0.5 ? 1 : -1;
        activeAnims.push({
          t0: performance.now() + 150, duration: 450,
          update: (p) => {
            dead.group.position.x += dir * 0.004;
            dead.group.rotation.z = p * 1.4 * dir;
            dead.group.position.y = 0.015 - p * 0.25;
            dead.group.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = 1 - p; } });
          },
          done: () => { scene.remove(dead.group); },
        });
        shakeUntil = performance.now() + 260;
      }
    }

    function burstConfetti(color) {
      for (let i = 0; i < 40; i++) {
        const mat = new THREE.MeshBasicMaterial({ color });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), mat);
        mesh.position.set(0, 1.2, 0);
        const vx = (Math.random() - 0.5) * 4, vz = (Math.random() - 0.5) * 4, vy = 2 + Math.random() * 2;
        scene.add(mesh);
        activeAnims.push({
          t0: performance.now(), duration: 1400,
          update: (p) => {
            const t = p * 1.4;
            mesh.position.set(vx * t, 1.2 + vy * t - 4.9 * t * t, vz * t);
            mesh.rotation.x += 0.2; mesh.rotation.y += 0.15;
            mat.transparent = true; mat.opacity = 1 - p;
          },
          done: () => scene.remove(mesh),
        });
      }
    }

    const highlightMeshes = [];
    function syncHighlights(activeNodeId, moveTargets) {
      highlightMeshes.forEach(m => scene.remove(m));
      highlightMeshes.length = 0;
      if (activeNodeId != null) {
        const w = toWorld(NODES[activeNodeId]);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.22, 0.02, 8, 24),
          new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.6 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(w.x, 0.03, w.z);
        scene.add(ring);
        highlightMeshes.push(ring);
      }
      for (const id of moveTargets) {
        const w = toWorld(NODES[id]);
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 10, 10),
          new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 0.5 })
        );
        dot.position.set(w.x, 0.12, w.z);
        scene.add(dot);
        highlightMeshes.push(dot);
      }
    }

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    function onClick(evt) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(Object.values(hitMeshes));
      if (hits.length > 0) {
        handleNodeClickRef.current(hits[0].object.userData.nodeId);
      }
    }
    renderer.domElement.addEventListener("click", onClick);

    let raf;
    function animate() {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      for (let i = activeAnims.length - 1; i >= 0; i--) {
        const anim = activeAnims[i];
        if (now < anim.t0) continue;
        const p = Math.min(1, (now - anim.t0) / anim.duration);
        anim.update(p);
        if (p >= 1) { anim.done?.(); activeAnims.splice(i, 1); }
      }
      const t = now * 0.003;
      torches.forEach((light, i) => {
        light.intensity = 1.9 + Math.sin(t * 3 + i * 7) * 0.3 + Math.random() * 0.15;
      });
      controls.update();
      if (now < shakeUntil) {
        camera.position.x += (Math.random() - 0.5) * 0.05;
        camera.position.y += (Math.random() - 0.5) * 0.03;
      }
      renderer.render(scene, camera);
    }
    animate();

    function onResize() {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    }
    window.addEventListener("resize", onResize);

    sceneRef.current = { syncPieces, syncHighlights, animateStep, burstConfetti };
    syncPieces(board);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      renderer.dispose();
      mount.innerHTML = "";
    };
  }, [mode]);

  useEffect(() => {
    if (skipNextSyncRef.current) { skipNextSyncRef.current = false; return; }
    sceneRef.current.syncPieces?.(board);
  }, [board]);
  useEffect(() => { sceneRef.current.syncHighlights?.(activeId, highlightMoves); }, [activeId, JSON.stringify(highlightMoves)]);
  useEffect(() => {
    if (winner && winner !== "Draw") {
      sceneRef.current.burstConfetti?.(COLORS[winner]);
    }
    if (winner && authToken) {
      if (mode === "ai") {
        reportResult(winner === "A" ? "win" : "loss");
      } else if (mode === "online" && mySide) {
        reportResult(winner === "Draw" ? "draw" : winner === mySide ? "win" : "loss");
      }
    }
  }, [winner]);

  if (!mode) {
    return (
      <div className="screen center">
        <div className="panel">
          <h1 className="title">⚔ WAR BATTLEGROUND</h1>
          <p className="subtitle">Crimson Legion vs Steel Legion — a pure strategy siege</p>

          {user ? (
            <div className="account-row">
              <span className="muted">👤 {user.username} · ⭐ {user.rating} · 🪙 {user.coins}</span>
              <button className="link" onClick={logout}>Log out</button>
            </div>
          ) : (
            <div className="row">
              <button className="btn btn-dark" onClick={() => { setAuthScreen("login"); setAuthError(""); }}>Log in</button>
              <button className="btn btn-dark" onClick={() => { setAuthScreen("register"); setAuthError(""); }}>Sign up</button>
            </div>
          )}

          {user && (
            <div className="row">
              <button className="btn btn-dark" onClick={openLeaderboard}>🏆 Leaderboard</button>
              <button className="btn btn-dark" onClick={openFriends}>👥 Friends</button>
            </div>
          )}
          {user && rewardStatus && (
            <button className={"btn " + (rewardStatus.canClaim ? "btn-red" : "btn-dark")} onClick={claimReward} disabled={!rewardStatus.canClaim}>
              🎁 {rewardStatus.canClaim ? "Claim daily reward!" : `Next reward in ${Math.ceil(rewardStatus.hoursUntilNext)}h`}
            </button>
          )}

          <button className="btn btn-red" onClick={() => { unlockAudio(); setMode("offline"); resetLocal(); }}>⚔ Offline Duel (Same Device)</button>

          <div className="difficulty-row">
            {["easy", "medium", "hard"].map(d => (
              <button key={d} className={"chip-btn" + (aiDifficulty === d ? " chip-btn-active" : "")} onClick={() => setAiDifficulty(d)}>
                {d === "easy" ? "🟢 Easy" : d === "medium" ? "🟡 Medium" : "🔴 Hard"}
              </button>
            ))}
          </div>
          <button className="btn btn-dark" onClick={() => { unlockAudio(); setMode("ai"); resetLocal(); }}>🤖 Vs AI (Solo)</button>

          <button className="btn btn-blue" onClick={() => { unlockAudio(); setMode("online-menu"); }}>🌐 Online Siege (Two Devices)</button>
          <button className="link" onClick={() => { setTutorialStep(0); setShowTutorial(true); }}>🎯 How to play (60 sec)</button>
        </div>

        {showTutorial && <Tutorial step={tutorialStep} setStep={setTutorialStep} onClose={() => setShowTutorial(false)} />}

        {authScreen && (
          <div className="tutorial-overlay">
            <div className="tutorial-card">
              <h2 className="tutorial-title">{authScreen === "login" ? "Log in" : "Create account"}</h2>
              <input className="input" placeholder="Username" value={authForm.username}
                onChange={e => setAuthForm({ ...authForm, username: e.target.value })} style={{ marginBottom: 10, width: "100%" }} />
              <input className="input" placeholder="Password" type="password" value={authForm.password}
                onChange={e => setAuthForm({ ...authForm, password: e.target.value })} style={{ marginBottom: 10, width: "100%" }} />
              {authError && <p className="warn" style={{ fontSize: 13 }}>{authError}</p>}
              <div className="tutorial-nav">
                <button className="btn btn-dark" onClick={() => setAuthScreen(null)}>Cancel</button>
                <button className="btn btn-red" onClick={() => submitAuth(authScreen)}>{authScreen === "login" ? "Log in" : "Sign up"}</button>
              </div>
            </div>
          </div>
        )}

        {showLeaderboard && (
          <div className="tutorial-overlay" onClick={() => setShowLeaderboard(false)}>
            <div className="tutorial-card" onClick={e => e.stopPropagation()}>
              <h2 className="tutorial-title">🏆 Leaderboard</h2>
              <div className="leaderboard-list">
                {leaderboard.map((p, i) => (
                  <div key={p.username} className="leaderboard-row">
                    <span>{i + 1}. {p.username}</span>
                    <span>⭐ {p.rating}</span>
                  </div>
                ))}
                {leaderboard.length === 0 && <p className="muted">No players yet.</p>}
              </div>
              <button className="btn btn-dark" onClick={() => setShowLeaderboard(false)}>Close</button>
            </div>
          </div>
        )}

        {showFriends && (
          <div className="tutorial-overlay" onClick={() => setShowFriends(false)}>
            <div className="tutorial-card" onClick={e => e.stopPropagation()}>
              <h2 className="tutorial-title">👥 Friends</h2>
              <p className="muted" style={{ marginBottom: 10 }}>Your code: <b>{myFriendCode}</b> — share it so friends can add you.</p>
              <div className="row" style={{ marginBottom: 14 }}>
                <input className="input" placeholder="Friend's code" value={friendCodeInput} onChange={e => setFriendCodeInput(e.target.value)} />
                <button className="btn btn-red" onClick={addFriend}>Add</button>
              </div>
              <div className="leaderboard-list">
                {friends.map(f => (
                  <div key={f.username} className="leaderboard-row"><span>{f.username}</span><span>⭐ {f.rating}</span></div>
                ))}
                {friends.length === 0 && <p className="muted">No friends added yet.</p>}
              </div>
              <button className="btn btn-dark" onClick={() => setShowFriends(false)}>Close</button>
            </div>
          </div>
        )}

        {showRewardPopup && (
          <div className="tutorial-overlay" onClick={() => setShowRewardPopup(null)}>
            <div className="tutorial-card" onClick={e => e.stopPropagation()}>
              <h2 className="tutorial-title">🎁 +{showRewardPopup.reward} coins!</h2>
              <p className="tutorial-body">Day {showRewardPopup.streak} streak. Come back tomorrow for more.</p>
              <button className="btn btn-red" onClick={() => setShowRewardPopup(null)}>Nice!</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (mode === "online-menu") {
    return (
      <div className="screen center">
        <div className="panel">
          <h1 className="title">⚔ WAR BATTLEGROUND</h1>
          <button className="btn btn-blue" onClick={createRoom}>🌐 Raise Your Banner (Create Room, be Crimson)</button>
          <div className="row">
            <input className="input" placeholder="Enter siege code" maxLength={5} value={roomInput} onChange={e => setRoomInput(e.target.value)} />
            <button className="btn btn-red" onClick={joinRoom}>Join (Steel)</button>
          </div>
          <button className="link" onClick={() => setMode(null)}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1 className="title small">⚔ WAR BATTLEGROUND</h1>
      <div className="scorebar">
        <span className="chip" style={{ background: "#dc2626" }}>🔴 {ARMY_NAME.A}: {counts.a}</span>
        <span className="chip" style={{ background: "#1e3a8a" }}>🔵 {ARMY_NAME.B}: {counts.b}</span>
        {mode === "online" && <span className="muted">Siege Code: {roomCode} | You: {mySide ? ARMY_NAME[mySide] : "…"}</span>}
      </div>

      {winner ? (
        <div className="center-col">
          <p className="winner">{winner === "Draw" ? "⚔ The Battle Ends in a Draw!" : `🏆 ${ARMY_NAME[winner]} Claims Victory!`}</p>
          <button className="btn btn-red" onClick={handleReset}>Rally Again</button>
        </div>
      ) : (
        <p className="turn-line">
          Turn: <b style={{ color: turn === "A" ? "#dc2626" : "#1e3a8a" }}>{ARMY_NAME[turn]}</b>
          {captureRequired && <span className="warn"> — a strike is available, you must attack!</span>}
          {mode === "online" && !myTurnOnline && <span className="muted"> ({status || "awaiting enemy move..."})</span>}
          {mode === "ai" && turn === "B" && <span className="muted"> (AI is thinking...)</span>}
        </p>
      )}
      {mode === "online" && status && <p className="muted small-text">{status}</p>}

      <div className="board-wrap">
        <div ref={mountRef} className="board3d" />
        {comboText && <div className="combo-text">{comboText}</div>}
      </div>

      <div className="row">
        <button className="btn btn-dark" onClick={handleReset}>⟳ Reset</button>
        <button className="btn btn-dark" onClick={() => { setTutorialStep(0); setShowTutorial(true); }}>❓ Help</button>
        <button className="btn btn-dark" onClick={() => { wsRef.current?.close(); setMode(null); }}>☰ Menu</button>
      </div>
      <p className="footnote">Drag to rotate, scroll to zoom. Click your soldier, then a glowing node to march or strike.</p>
      {showTutorial && <Tutorial step={tutorialStep} setStep={setTutorialStep} onClose={() => setShowTutorial(false)} />}
    </div>
  );
}

function Tutorial({ step, setStep, onClose }) {
  const slides = [
    { title: "The board", body: "Soldiers sit on the dots. Lines are the only paths they can move along — no jumping between unconnected points." },
    { title: "Moving", body: "Tap your soldier, then tap a glowing green dot to march it one step along a line into an empty spot." },
    { title: "Striking", body: "If an enemy sits right next to you with an empty spot just beyond them on the same line, tap that empty spot to leap over and capture them." },
    { title: "Chain strikes", body: "If your soldier can strike again after landing, it must keep striking in the same turn — chain as many as you can for a combo!" },
    { title: "Winning", body: "Capture is mandatory when available. The battle ends when a side is wiped out or stuck — most soldiers remaining wins." },
  ];
  const s = slides[step];
  return (
    <div className="tutorial-overlay">
      <div className="tutorial-card">
        <h2 className="tutorial-title">{s.title}</h2>
        <p className="tutorial-body">{s.body}</p>
        <div className="tutorial-dots">
          {slides.map((_, i) => <span key={i} className={"dot" + (i === step ? " dot-active" : "")} />)}
        </div>
        <div className="tutorial-nav">
          <button className="btn btn-dark" onClick={onClose}>Skip</button>
          {step < slides.length - 1
            ? <button className="btn btn-red" onClick={() => setStep(step + 1)}>Next</button>
            : <button className="btn btn-red" onClick={onClose}>Let's fight!</button>}
        </div>
      </div>
    </div>
  );
}
