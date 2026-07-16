import React from "react";

// Shop and Battle Pass components for War Battleground

export function CosmeticsShop({ user, token, onClose, apiFetch }) {
  const [cosmetics, setCosmetics] = React.useState([]);
  const [owned, setOwned] = React.useState([]);
  const [selectedType, setSelectedType] = React.useState("soldier_skin");
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    apiFetch("/shop/cosmetics")
      .then(d => setCosmetics(d.cosmetics))
      .catch(() => {});
    if (token) {
      apiFetch("/cosmetics/owned", {}, token)
        .then(d => setOwned(d.owned))
        .catch(() => {});
    }
  }, []);

  const filtered = cosmetics.filter(c => c.type === selectedType);
  const isOwned = (id) => owned.some(o => o.id === id);
  const isEquipped = (id) => owned.find(o => o.id === id && o.equipped);

  async function buyCosm(cosmeticId) {
    try {
      const d = await apiFetch("/cosmetics/buy", { method: "POST", body: JSON.stringify({ cosmeticId }) }, token);
      setMessage(`✓ Purchased! ${d.gemsLeft} gems left`);
      apiFetch("/cosmetics/owned", {}, token).then(d => setOwned(d.owned)).catch(() => {});
    } catch (e) { setMessage(`❌ ${e.message}`); }
  }

  async function equipCosm(cosmeticId) {
    try {
      await apiFetch("/cosmetics/equip", { method: "POST", body: JSON.stringify({ cosmeticId, type: selectedType }) }, token);
      apiFetch("/cosmetics/owned", {}, token).then(d => setOwned(d.owned)).catch(() => {});
    } catch (e) { setMessage(`❌ ${e.message}`); }
  }

  return (
    <div className="tutorial-overlay" onClick={onClose}>
      <div className="tutorial-card" onClick={e => e.stopPropagation()}>
        <h2 className="tutorial-title">✨ Cosmetics Shop</h2>
        <div className="row" style={{ marginBottom: 14, gap: 6, justifyContent: "center" }}>
          {["soldier_skin", "board_theme", "emote"].map(t => (
            <button key={t} className={"chip-btn" + (selectedType === t ? " chip-btn-active" : "")}
              onClick={() => setSelectedType(t)}>
              {t === "soldier_skin" ? "👤 Skins" : t === "board_theme" ? "🎨 Boards" : "😊 Emotes"}
            </button>
          ))}
        </div>
        <div className="leaderboard-list" style={{ maxHeight: 350 }}>
          {filtered.map(c => (
            <div key={c.id} className="cosmetic-item">
              <span><b>{c.name}</b> · {c.rarity}</span>
              <span>{c.cost_gems} 💎</span>
              {isOwned(c.id) ? (
                <button className={"btn " + (isEquipped(c.id) ? "btn-red" : "btn-dark")} 
                  onClick={() => equipCosm(c.id)} style={{ fontSize: 12 }}>
                  {isEquipped(c.id) ? "✓ Equipped" : "Equip"}
                </button>
              ) : (
                <button className="btn btn-blue" onClick={() => buyCosm(c.id)} style={{ fontSize: 12 }}>Buy</button>
              )}
            </div>
          ))}
        </div>
        {message && <p className="muted" style={{ fontSize: 13 }}>{message}</p>}
        <button className="btn btn-dark" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function BattlePassScreen({ user, token, onClose, apiFetch }) {
  const [season, setSeason] = React.useState(null);
  const [progress, setProgress] = React.useState(null);
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    apiFetch("/battle-pass/current", {}, token)
      .then(d => { setSeason(d.season); setProgress(d.progress); })
      .catch(() => {});
  }, []);

  async function buyBattlePass() {
    try {
      await apiFetch("/battle-pass/buy", { method: "POST" }, token);
      setMessage("✓ Battle Pass purchased!");
      apiFetch("/battle-pass/current", {}, token).then(d => setProgress(d.progress)).catch(() => {});
    } catch (e) { setMessage(`❌ ${e.message}`); }
  }

  if (!season) return null;

  const xpNeeded = 500;
  const xpPercent = (progress.xp / xpNeeded) * 100;

  return (
    <div className="tutorial-overlay" onClick={onClose}>
      <div className="tutorial-card" onClick={e => e.stopPropagation()}>
        <h2 className="tutorial-title">⭐ Battle Pass — Season {season.season}</h2>
        <p className="tutorial-body">{season.name}</p>

        <div style={{ background: "#8a5a2b33", padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 13 }}>Level {progress.level} / 50</p>
          <div style={{ width: "100%", height: 8, background: "#00000033", borderRadius: 4, overflow: "hidden", marginTop: 6 }}>
            <div style={{ width: xpPercent + "%", height: "100%", background: "#facc15" }}></div>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#d9b98a" }}>{progress.xp} / {xpNeeded} XP</p>
        </div>

        {!progress.is_premium ? (
          <>
            <p className="muted">Unlock exclusive rewards for ₹499</p>
            <button className="btn btn-red" onClick={buyBattlePass}>🔓 Buy Battle Pass</button>
          </>
        ) : (
          <p className="muted">✓ Premium active — earn rewards faster</p>
        )}

        {message && <p className="muted" style={{ fontSize: 13 }}>{message}</p>}
        <button className="btn btn-dark" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function CampaignMode({ token, apiFetch, onBack }) {
  const [progress, setProgress] = React.useState(null);
  const [currentLevel, setCurrentLevel] = React.useState(1);
  const [playing, setPlaying] = React.useState(false);
  const [startTime, setStartTime] = React.useState(null);

  React.useEffect(() => {
    apiFetch("/campaign/progress", {}, token)
      .then(d => { setProgress(d.campaign); setCurrentLevel(d.campaign.level); })
      .catch(() => {});
  }, []);

  async function startLevel(level) {
    setCurrentLevel(level);
    setPlaying(true);
    setStartTime(Date.now());
  }

  async function completeLevel() {
    const durationSec = Math.round((Date.now() - startTime) / 1000);
    try {
      await apiFetch("/campaign/complete", { method: "POST", body: JSON.stringify({ level: currentLevel, durationSec }) }, token);
      setPlaying(false);
      apiFetch("/campaign/progress", {}, token).then(d => setProgress(d.campaign)).catch(() => {});
    } catch (e) { alert(e.message); }
  }

  if (playing) {
    return (
      <div className="screen center">
        <div className="panel">
          <h1 className="title">⚔ Campaign Level {currentLevel}</h1>
          <p className="subtitle">Defeat the AI general to advance</p>
          <p style={{ color: "#f1e6d8", marginBottom: 20 }}>
            Difficulty: {currentLevel <= 3 ? "Easy" : currentLevel <= 6 ? "Medium" : "Hard"}
          </p>
          {/* Game board would render here */}
          <div style={{ height: 200, background: "#00000033", borderRadius: 8, marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <p className="muted">[3D Board Rendering Here]</p>
          </div>
          <button className="btn btn-red" onClick={completeLevel}>✓ Win & Continue</button>
          <button className="btn btn-dark" onClick={() => setPlaying(false)}>Quit</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen center">
      <div className="panel">
        <h1 className="title">⚔ Campaign</h1>
        <p className="subtitle">10 levels of increasing difficulty</p>
        <p className="muted">Current: Level {progress?.level || 1}</p>

        <div className="leaderboard-list" style={{ maxHeight: 400 }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map(level => {
            const unlocked = !progress || level <= progress.level;
            return (
              <div key={level} className="leaderboard-row" style={{ opacity: unlocked ? 1 : 0.5 }}>
                <span>Level {level} · {level <= 3 ? "🟢 Easy" : level <= 6 ? "🟡 Medium" : "🔴 Hard"}</span>
                {unlocked ? (
                  <button className="btn btn-red" onClick={() => startLevel(level)} style={{ fontSize: 12, padding: "4px 8px" }}>
                    {level === progress?.level && !progress?.completed ? "In Progress" : "Play"}
                  </button>
                ) : (
                  <span className="muted" style={{ fontSize: 12 }}>Locked</span>
                )}
              </div>
            );
          })}
        </div>

        <button className="btn btn-dark" onClick={onBack}>Back to Menu</button>
      </div>
    </div>
  );
}
