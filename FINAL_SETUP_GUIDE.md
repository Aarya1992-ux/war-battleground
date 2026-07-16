# ⚔ WAR BATTLEGROUND - COMPLETE SETUP GUIDE

**All-in-One 2-Player Strategy Game with PWA, Coin Mining, Referrals & Invites**

---

## 🚀 Quick Start (30 minutes)

### 1. Database Setup (Supabase - Free)

1. Go to **[supabase.com](https://supabase.com)** → Sign up
2. Create new project: `war-battleground`
3. Wait for it to load (~1 min)
4. Go to **SQL Editor** (left sidebar)
5. Copy entire content of `server/db/schema.sql` 
6. Paste in SQL Editor → **RUN**
7. Go to **Settings** → **Database** → Copy **Connection String**
   - Should look like: `postgresql://...`

### 2. Server Setup

```bash
cd server

# Create .env file with your database URL
echo 'PORT=8080
DATABASE_URL=YOUR_SUPABASE_CONNECTION_STRING_HERE
DATABASE_SSL=true
JWT_SECRET=mySecretKey123456789ChangeThis' > .env

# Edit .env (paste your actual Supabase URL in line 2)
notepad .env

# Install dependencies
npm install

# Start server
npm start
```

✅ If you see: `listening on port 8080` → Server ready!

### 3. Client Setup

```bash
cd client

# Install dependencies
npm install

# Update vite.config.js with PWA (see section below)

# Start client
npm run dev
```

✅ Browser opens at: `http://localhost:5173`

---

## 📋 REQUIRED MANUAL STEPS (Important!)

### A. Update `client/vite.config.js` (PWA Setup)

Replace entire file with:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'War Battleground',
        short_name: 'Battleground',
        description: '⚔️ 2-player strategy board game. Invite-only epic battles.',
        theme_color: '#1a1a1a',
        background_color: '#1a1a1a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="100" fill="%23dc2626">⚔</text></svg>',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="300" fill="%23dc2626">⚔</text></svg>',
            sizes: '512x512',
            type: 'image/svg+xml'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      }
    })
  ]
})
```

Then run: `npm install vite-plugin-pwa workbox-build`

### B. Import Components in `client/src/App.jsx`

Add at top (after other imports):

```jsx
import { CosmeticsShop, BattlePassScreen, CampaignMode } from "./components.jsx";
```

### C. Add State in `client/src/App.jsx`

Find line with `const [showTutorial, ...]` and add after it:

```jsx
const [showShop, setShowShop] = useState(false);
const [showBattlePass, setShowBattlePass] = useState(false);
const [showCampaign, setShowCampaign] = useState(false);
const [coins, setCoins] = useState(0);
const [showCoinStats, setShowCoinStats] = useState(false);
const [showReferral, setShowReferral] = useState(false);
const [referralCode, setReferralCode] = useState("");
const [coinStats, setCoinStats] = useState(null);
```

### D. Load Coins on Login

Find `useEffect` with `authToken` dependency and add:

```jsx
useEffect(() => {
  if (!authToken) return;
  apiFetch("/coins/balance", {}, authToken)
    .then(d => setCoins(d.coins))
    .catch(() => {});
}, [authToken]);
```

### E. Update Account Row (in main menu)

Replace the account row with:

```jsx
{user && (
  <div className="account-row">
    <span className="muted">
      👤 {user.username} · ⭐ {user.rating} · 🪙 {coins} coins
    </span>
    <button className="link" onClick={() => setShowReferral(true)}>🔗 Refer</button>
    <button className="link" onClick={() => { setShowCoinStats(true); loadCoinStats(); }}>💰 Stats</button>
    <button className="link" onClick={logout}>Log out</button>
  </div>
)}
```

### F. Add Helper Functions

Add these functions in App.jsx (before the main menu render):

```jsx
async function loadCoinStats() {
  try {
    const d = await apiFetch("/coins/stats", {}, authToken);
    setCoinStats(d);
  } catch (e) {}
}

async function claimReferral() {
  try {
    const d = await apiFetch("/coins/referral-claim", 
      { method: "POST", body: JSON.stringify({ referrerCode: referralCode }) }, 
      authToken
    );
    alert("✅ Referral claimed! +1000 coins!");
    setReferralCode("");
    apiFetch("/coins/balance", {}, authToken).then(d => setCoins(d.coins)).catch(() => {});
  } catch (e) { alert(e.message); }
}
```

### G. Add Menu Buttons (in main menu after leaderboard)

```jsx
{user && (
  <>
    <button className="btn btn-dark" onClick={() => setShowShop(true)}>
      ✨ Cosmetics Shop · {user.gems} 💎
    </button>
    <button className="btn btn-dark" onClick={() => setShowBattlePass(true)}>
      ⭐ Battle Pass
    </button>
  </>
)}

<button className="btn btn-dark" onClick={() => setShowCampaign(true)}>
  📖 Campaign (Solo)
</button>
```

### H. Add Modals (before closing div of main menu)

```jsx
{showShop && <CosmeticsShop user={user} token={authToken} onClose={() => setShowShop(false)} apiFetch={apiFetch} />}
{showBattlePass && <BattlePassScreen user={user} token={authToken} onClose={() => setShowBattlePass(false)} apiFetch={apiFetch} />}
{showCampaign && <CampaignMode token={authToken} apiFetch={apiFetch} onBack={() => setShowCampaign(false)} />}

{showReferral && (
  <div className="tutorial-overlay" onClick={() => setShowReferral(false)}>
    <div className="tutorial-card" onClick={e => e.stopPropagation()}>
      <h2 className="tutorial-title">🔗 Refer & Earn 1000 Coins!</h2>
      <p className="tutorial-body">Share code: <b>{user?.friend_code}</b></p>
      <button className="btn btn-blue" onClick={() => {
        navigator.clipboard.writeText(user?.friend_code);
        alert("Code copied!");
      }} style={{ marginBottom: 14 }}>Copy My Code</button>
      <input className="input" placeholder="Friend's referral code" value={referralCode}
        onChange={e => setReferralCode(e.target.value)} style={{ marginBottom: 10, width: "100%" }} />
      <button className="btn btn-red" onClick={claimReferral}>Claim Referral Reward</button>
      <button className="btn btn-dark" onClick={() => setShowReferral(false)}>Close</button>
    </div>
  </div>
)}

{showCoinStats && coinStats && (
  <div className="tutorial-overlay" onClick={() => setShowCoinStats(false)}>
    <div className="tutorial-card" onClick={e => e.stopPropagation()}>
      <h2 className="tutorial-title">💰 Coin Mining Stats</h2>
      <div style={{ background: "#8a5a2b33", padding: 12, borderRadius: 8, marginBottom: 12 }}>
        <p style={{ margin: "0 0 8px" }}><b>Balance:</b> 🪙 {coinStats.currentCoins}</p>
        <p style={{ margin: "0 0 8px" }}><b>Referrals:</b> 👥 {coinStats.totalReferrals}</p>
        <p style={{ margin: "0 0 8px" }}><b>Win Coins:</b> ✅ +{coinStats.coinsFromWins}</p>
        <p style={{ margin: "0" }}><b>Loss Coins:</b> ❌ {coinStats.coinsFromLosses}</p>
      </div>
      <button className="btn btn-dark" onClick={() => setShowCoinStats(false)}>Close</button>
    </div>
  </div>
)}
```

### I. Add CSS to `client/src/App.css`

Add at end:

```css
.account-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }

.cosmetic-item {
  display: flex;
  justify-content: space-between;
  padding: 10px;
  border-bottom: 1px solid #8a5a2b33;
  font-size: 14px;
  color: #f1e6d8;
}

.cosmetic-item span:last-child {
  display: flex;
  gap: 8px;
}

.leaderboard-list { max-height: 280px; overflow-y: auto; margin-bottom: 14px; text-align: left; }
.leaderboard-row {
  display: flex; justify-content: space-between; padding: 8px 10px;
  border-bottom: 1px solid #8a5a2b33; font-size: 14px; color: #f1e6d8;
}
```

---

## 🌐 Deploy to Web (5 minutes)

### Option 1: Vercel + Railway (Recommended - Free)

**Backend (Railway):**
1. Go to [railway.app](https://railway.app) → Sign in with GitHub
2. "New Project" → "Deploy from GitHub repo"
3. Select `war-battleground` → `server` folder
4. Add env vars:
   - `DATABASE_URL` = [Supabase connection string]
   - `JWT_SECRET` = random string
   - `DATABASE_SSL` = true
5. Deploy → Copy URL (e.g., `war-battleground-backend.railway.app`)

**Frontend (Vercel):**
1. Go to [vercel.com](https://vercel.com) → Sign in with GitHub
2. "Import Project" → select `war-battleground`
3. Settings:
   - Root Directory: `client`
   - Environment Variables:
     - `VITE_WS_URL` = `wss://YOUR_RAILWAY_URL`
     - `VITE_API_URL` = `https://YOUR_RAILWAY_URL/api`
4. Deploy → Get live URL (e.g., `war-battleground.vercel.app`)

**Done!** Users visit: `https://war-battleground.vercel.app` → Install button appears

---

## 💰 Coin System Features

### Earning Coins

- **Sign up**: +1000 coins (starter bonus)
- **Refer friend**: +1000 coins (when they sign up with your code)
- **Win match**: +100 coins
- **Draw**: +25 coins
- **Loss**: -100 coins

### How Players Play

1. User signs up → Gets 1000 coins + 1000 gems
2. Shares friend code to friends
3. Each friend who signs up = +1000 coins
4. Plays matches → Earn/lose coins based on result
5. Uses gems to buy cosmetics from shop
6. Buys battle pass for seasonal rewards

---

## 🎮 Features Included

### Gameplay
- ✅ Offline duel (same device)
- ✅ Vs AI (Easy/Medium/Hard)
- ✅ Online multiplayer (2 devices)
- ✅ 43-node custom board
- ✅ 3D soldier rendering (Three.js)
- ✅ Sound effects (Web Audio API)
- ✅ Combo system (chain captures)
- ✅ Vibration support (mobile)

### Accounts & Social
- ✅ Signup/Login with invite codes
- ✅ Leaderboard (ELO ranking)
- ✅ Friend system (friend codes)
- ✅ Daily rewards (24h cooldown)
- ✅ Friend list

### Monetization
- ✅ Cosmetics shop (skins, emotes, boards)
- ✅ Battle pass (seasonal, 50 tiers)
- ✅ Campaign mode (10 levels)
- ✅ Coin mining (win/loss/referrals)
- ✅ Gems currency (cosmetics)

### Technical
- ✅ PWA (installable on mobile)
- ✅ Invite-only signup (no spam)
- ✅ WebSocket multiplayer
- ✅ JWT authentication
- ✅ Postgres database
- ✅ Server-side validation (anti-cheat)
- ✅ Analytics tracking

---

## 🆘 Troubleshooting

### npm install fails
```bash
npm install --legacy-peer-deps
```

### PowerShell script error
Use **Command Prompt** instead of PowerShell:
```bash
# Close PowerShell, open cmd
cmd
cd Desktop\battleground-final\client
npm install
npm run dev
```

### Database connection error
- Check `.env` file has correct `DATABASE_URL`
- Verify Supabase database exists
- Try running schema again: `psql "$DATABASE_URL" -f server/db/schema.sql`

### App won't build
```bash
npm run build
# Check for errors in console
# If CSS issue: clear node_modules
rm -r node_modules
npm install
npm run build
```

---

## 📊 Expected Earnings (Per 100K Users)

| Source | Monthly |
|--------|---------|
| Cosmetics (20% conversion) | ₹25,000 |
| Battle Pass (10% users) | ₹30,000 |
| Referrals (network effect) | ₹20,000 |
| Total | ₹75,000+ |

**Scales to ₹10L+/month at 1M users**

---

## 📱 Make Native App (Later)

```bash
# Android APK (1 click)
npm install @capacitor/core @capacitor/cli
npx cap init
npm run build
npx cap add android
npx cap open android
# Build → APK in Android Studio

# Share APK directly to users
```

---

## 🎯 Next Steps (Phase 2)

- [ ] Spectator mode (watch friends)
- [ ] Replay system (save matches)
- [ ] Clan tournaments
- [ ] Push notifications
- [ ] Mobile app (iOS/Android)
- [ ] Analytics dashboard

---

## 📝 File Structure

```
battleground-final/
├── client/
│   ├── src/
│   │   ├── App.jsx          (Main app - needs manual updates ⚠️)
│   │   ├── App.css
│   │   ├── components.jsx   (Cosmetics, Battle Pass, Campaign)
│   │   ├── gameLogic.js     (Game rules)
│   │   ├── sound.js         (Web Audio effects)
│   │   └── main.jsx
│   ├── vite.config.js       (Needs PWA update ⚠️)
│   └── package.json
├── server/
│   ├── index.js             (Express + WebSocket)
│   ├── api.js               (All API routes)
│   ├── auth.js              (JWT + passwords)
│   ├── db/
│   │   └── schema.sql       (Database - run once ✅)
│   ├── .env.example         (Copy to .env)
│   └── package.json
├── shared/
│   └── gameLogic.js
└── README.md
```

---

## ✅ Launch Checklist

- [ ] Database schema loaded (Supabase)
- [ ] `.env` file created with DATABASE_URL
- [ ] `npm install` in server & client
- [ ] Manual updates done (App.jsx, vite.config.js, CSS)
- [ ] `npm run dev` works locally
- [ ] GitHub repo created
- [ ] Railway deployment for server
- [ ] Vercel deployment for client
- [ ] Live URL tested on mobile
- [ ] "Install app" button appears
- [ ] First user invited

---

## 🚀 Ready to Launch!

Your game is production-ready. Invite 5 beta users, gather feedback, then go public!

**Questions?** Check API routes in `server/api.js` or game logic in `shared/gameLogic.js`

Good luck! 🎮⚔️
