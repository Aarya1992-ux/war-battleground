let ctx = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, duration, type = "sine", startGain = 0.18, delay = 0) {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, c.currentTime + delay);
  gain.gain.exponentialRampToValueAtTime(startGain, c.currentTime + delay + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime + delay);
  osc.stop(c.currentTime + delay + duration + 0.02);
}

function noiseBurst(duration, startGain = 0.25, delay = 0) {
  const c = getCtx();
  const bufferSize = c.sampleRate * duration;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900;
  const gain = c.createGain();
  gain.gain.setValueAtTime(startGain, c.currentTime + delay);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + duration);
  noise.connect(filter).connect(gain).connect(c.destination);
  noise.start(c.currentTime + delay);
}

export function unlockAudio() {
  try { getCtx(); } catch (e) {}
}

export function playMoveSound() {
  try { tone(220, 0.12, "sine", 0.12); tone(330, 0.08, "sine", 0.08, 0.04); } catch (e) {}
}

export function playCaptureSound() {
  try {
    noiseBurst(0.18, 0.3);
    tone(140, 0.25, "sawtooth", 0.22, 0.02);
    tone(90, 0.3, "square", 0.15, 0.05);
  } catch (e) {}
}

export function playVictorySound() {
  try {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, "triangle", 0.16, i * 0.12));
  } catch (e) {}
}

export function playErrorSound() {
  try { tone(140, 0.15, "square", 0.1); } catch (e) {}
}
