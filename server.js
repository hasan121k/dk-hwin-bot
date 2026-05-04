const express = require('express');
const axios = require('axios');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, onValue } = require('firebase/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

// ==========================================
// 💥 BACKEND FIREBASE CONFIGURATION 
// (২য় কোডের ফায়ারবেস ডাটাবেস অনুযায়ী)
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyAUZo6Mls52d549yGCPFndgWlD3dGp6jEM",
    authDomain: "sell-2-a3835.firebaseapp.com",
    databaseURL: "https://sell-2-a3835-default-rtdb.firebaseio.com",
    projectId: "sell-2-a3835",
    storageBucket: "sell-2-a3835.firebasestorage.app",
    messagingSenderId: "762480029232",
    appId: "1:762480029232:web:6e9feb792a16a8a9c0c7f5"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const dbRef = ref(db, 'adminSettings');

let config = {
    botToken: "", channelId: "", msgTemplate: "",
    servers: { '30S': false, '1M': false, '3M': false, '5M': false },
    stickers: { bigWin: ["","",""], smallWin: ["","",""], loss: ["","",""] },
    schedules: []
};

// ফায়ারবেস থেকে লাইভ ডাটা সিঙ্ক (Admin Panel থেকে সেভ করলেই এখানে আপডেট হবে)
onValue(dbRef, (snapshot) => {
    const data = snapshot.val();
    if(data) {
        config = data;
        console.log("✅ Firebase Admin Panel Settings Synced to Backend!");
    }
});
// ==========================================

const APIS = {
    '30S': 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json',
    '1M':  'https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json',
    '3M':  'https://draw.ar-lottery01.com/WinGo/WinGo_3M/GetHistoryIssuePage.json',
    '5M':  'https://draw.ar-lottery01.com/WinGo/WinGo_5M/GetHistoryIssuePage.json'
};

const state = {
    '30S': { p: null, nextPStr: null, pred: null, history: [] },
    '1M':  { p: null, nextPStr: null, pred: null, history: [] },
    '3M':  { p: null, nextPStr: null, pred: null, history: [] },
    '5M':  { p: null, nextPStr: null, pred: null, history: [] }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function calculatePrediction(list) {
    const last5 = list.slice(0, 5).map(x => parseInt(x.number) >= 5 ? "BIG" : "SMALL");
    if (last5[0] === last5[1] && last5[1] === last5[2]) return last5[0]; 
    return (last5[0] === "BIG") ? "SMALL" : "BIG";
}

// 💥 BD Time Schedule Check
function isTimeAllowed() {
    if(!config.schedules || config.schedules.length === 0) return true; 
    try {
        const bdDate = new Date().toLocaleString("en-US", {timeZone: "Asia/Dhaka", hour12: false});
        const bdTimeStr = bdDate.split(", ")[1].substring(0, 5); 
        
        let hasValidBoxes = false;
        let matched = false;

        for(let i=0; i<10; i++) {
            let sch = config.schedules[i];
            if(sch && sch.start && sch.end) {
                hasValidBoxes = true;
                if(bdTimeStr >= sch.start && bdTimeStr <= sch.end) {
                    matched = true;
                }
            }
        }
        return hasValidBoxes ? matched : true;
    } catch (e) {
        return true;
    }
}

// Telegram Functions
async function sendMsgToTelegram(text) {
    if(!config.botToken || !config.channelId || !text) return;
    try { await axios.post(`https://api.telegram.org/bot${config.botToken}/sendMessage`, { chat_id: config.channelId, text: text, parse_mode: 'HTML' }); } catch (e) {}
}
async function sendStickerToTelegram(stickerId) {
    if(!config.botToken || !config.channelId || !stickerId || stickerId.trim() === "") return;
    try { await axios.post(`https://api.telegram.org/bot${config.botToken}/sendSticker`, { chat_id: config.channelId, sticker: stickerId.trim() }); } catch (e) {}
}

// 💥 অ্যাডভান্সড মাল্টি-প্রক্সি (Render IP ব্লক বাইপাস)
async function fetchLotteryData(url) {
    const timestamp = Date.now();
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' };
    const targetUrl = `${url}?t=${timestamp}`;

    try {
        const res1 = await axios.get(targetUrl, { headers, timeout: 4000 });
        if (res1.data && res1.data.data && res1.data.data.list) return res1.data;
    } catch (e) {}

    try {
        const res2 = await axios.get(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`, { timeout: 5000 });
        if (res2.data && res2.data.data && res2.data.data.list) return res2.data;
    } catch (e) {}

    return null;
}

// 💥 Telegram Forwarding Logic (Admin Panel Control)
async function handleTelegramSequence(server, oldPred, isWin, nextPeriodStr, nextPred) {
    if (!config.servers || config.servers[server] !== true) return; // Server OFF check
    if (!isTimeAllowed()) return; // Time Schedule check

    // 1. Send Stickers First
    let stickList = [];
    if (config.stickers) {
        if (isWin && oldPred === "BIG") stickList = config.stickers.bigWin || [];
        else if (isWin && oldPred === "SMALL") stickList = config.stickers.smallWin || [];
        else stickList = config.stickers.loss || [];
        
        stickList = stickList.filter(s => s && s.trim() !== ""); 
        
        for(let i = 0; i < stickList.length; i++) {
            if (!isWin && i >= 1) break; // Loss হলে শুধু ১ম স্টিকার যাবে
            await sendStickerToTelegram(stickList[i]);
            await sleep(600); 
        }
    }

    await sleep(500);

    // 2. Send Next Prediction Message
    let msg = config.msgTemplate || "Period: {period}\nPrediction: {result}";
    msg = msg.replace(/{period}/g, nextPeriodStr).replace(/{result}/g, nextPred);
    msg = `<b>[${server} SERVER]</b>\n` + msg;
    
    await sendMsgToTelegram(msg);
    console.log(`[SUCCESS] Sent Signal for ${server}`);
}

async function fetchServerCoreData(serverType) {
    try {
        const responseData = await fetchLotteryData(APIS[serverType]);
        if (!responseData || !responseData.data || !responseData.data.list) return;
        
        const list = responseData.data.list;
        const latest = list[0];
        const actualPeriod = latest.issueNumber;
        const actualNum = parseInt(latest.number);
        const actualSize = actualNum >= 5 ? "BIG" : "SMALL";

        let sData = state[serverType];

        if (sData.p && sData.p !== actualPeriod) {
            let isWin = false;
            let oldPred = sData.pred;

            if (sData.pred) {
                isWin = (sData.pred === actualSize);
                if(sData.history.length > 0 && sData.history[0].p === sData.nextPStr) {
                    sData.history[0].status = isWin ? 'WIN' : 'LOSS';
                }
            }

            sData.p = actualPeriod;
            sData.pred = calculatePrediction(list);
            const nextPeriodStr = (BigInt(actualPeriod) + 1n).toString();
            sData.nextPStr = nextPeriodStr;
            
            sData.history.unshift({ p: nextPeriodStr, s: sData.pred, status: 'WAIT' });
            if(sData.history.length > 10) sData.history.pop();

            if (oldPred) {
                await handleTelegramSequence(serverType, oldPred, isWin, nextPeriodStr, sData.pred);
            }

        } else if (!sData.p) {
            sData.p = actualPeriod;
            sData.pred = calculatePrediction(list);
            sData.nextPStr = (BigInt(actualPeriod) + 1n).toString();
            sData.history.unshift({ p: sData.nextPStr, s: sData.pred, status: 'WAIT' });
            
            // Send very first signal on start
            if (config.servers && config.servers[serverType] && isTimeAllowed()) {
                let msg = config.msgTemplate || "Period: {period}\nPrediction: {result}";
                msg = msg.replace(/{period}/g, sData.nextPStr).replace(/{result}/g, sData.pred);
                msg = `<b>[${serverType} SERVER] STARTED</b>\n` + msg;
                await sendMsgToTelegram(msg);
            }
        }
    } catch (e) {}
}

setInterval(() => fetchServerCoreData('30S'), 2000);
setInterval(() => fetchServerCoreData('1M'), 3000);
setInterval(() => fetchServerCoreData('3M'), 5000);
setInterval(() => fetchServerCoreData('5M'), 7000);

// API for Frontend UI
app.get('/api/state', (req, res) => { res.json(state); });

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>VIP WINGO PREDICTOR + ADMIN PANEL</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Poppins:wght@400;600;800&display=swap');

        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Poppins', sans-serif; -webkit-tap-highlight-color: transparent; }
        
        body { 
            background: #0b0c10; color: #fff; display: flex; flex-direction: column; align-items: center; 
            min-height: 100vh; overflow-x: hidden; position: relative; padding-bottom: 50px;
        }

        body::before {
            content: ''; position: fixed; top: -50%; left: -50%; width: 200%; height: 200%;
            background: radial-gradient(circle at 50% 50%, rgba(31, 222, 203, 0.05), transparent 60%);
            animation: rotateBg 30s linear infinite; z-index: -1; pointer-events: none;
        }
        @keyframes rotateBg { 100% { transform: rotate(360deg); } }

        .app-container, .admin-container {
            width: 100%; max-width: 450px; padding: 15px; position: relative;
        }
        
        /* User App Styles */
        .tab-wrapper { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 20px; }
        .tab-btn { flex: 1; background: #1f2833; border: 2px solid #45a29e; color: #c5c6c7; border-radius: 30px; padding: 12px 5px; font-weight: 800; font-size: 13px; cursor: pointer; transition: 0.3s; text-align: center; box-shadow: 0 5px 15px rgba(0,0,0,0.5); font-family: 'Orbitron', sans-serif; }
        .tab-btn.active { background: linear-gradient(135deg, #66fcf1, #45a29e); color: #0b0c10; border-color: #66fcf1; box-shadow: 0 0 20px rgba(102, 252, 241, 0.6); transform: scale(1.05); }
        .glass-card { background: rgba(31, 40, 51, 0.8); backdrop-filter: blur(10px); border-radius: 20px; padding: 20px; border: 1px solid rgba(102, 252, 241, 0.2); box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin-bottom: 15px; }
        .header-info { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px dashed #45a29e; padding-bottom: 10px;}
        .server-name { font-size: 14px; font-weight: 800; color: #66fcf1; text-transform: uppercase; font-family: 'Orbitron'; }
        .timer-row { display: flex; justify-content: space-between; align-items: center; }
        .period-box h4 { font-size: 11px; color: #aaa; margin-bottom: 2px; }
        .period-box span { font-size: 18px; font-weight: 800; font-family: 'Orbitron'; color: #fff;}
        .timer-box { background: rgba(0,0,0,0.5); padding: 8px 15px; border-radius: 10px; border: 1px solid #66fcf1; }
        .timer-box span { font-size: 24px; font-weight: 900; color: #66fcf1; font-family: 'Orbitron'; animation: pulseText 1s infinite;}
        @keyframes pulseText { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        .pred-container { text-align: center; position: relative; padding: 15px 0; }
        .pred-text { font-size: 45px; font-weight: 900; font-family: 'Orbitron'; text-transform: uppercase; letter-spacing: 3px; margin: 10px 0; transition: 0.3s;}
        .is-big { color: #ffd700; text-shadow: 0 0 30px rgba(255, 215, 0, 0.8); }
        .is-small { color: #00e5ff; text-shadow: 0 0 30px rgba(0, 229, 255, 0.8); }
        .is-wait { color: #888; }
        table { width: 100%; border-collapse: collapse; text-align: center; margin-top: 5px; }
        th { font-size: 11px; color: #45a29e; padding: 8px; border-bottom: 1px dashed #333; font-family: 'Orbitron'; }
        td { font-size: 13px; font-weight: 700; padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .t-win { color: #00ff41; background: rgba(0,255,65,0.1); padding: 3px 8px; border-radius: 5px; }
        .t-loss { color: #ff003c; background: rgba(255,0,60,0.1); padding: 3px 8px; border-radius: 5px; }
        .t-wait { color: #888; }

        /* Admin Panel Styles */
        .admin-header { background: #ff0055; color: #fff; text-align: center; padding: 10px; border-radius: 10px; font-weight: bold; margin-top: 30px; margin-bottom: 15px;}
        .admin-section { background: rgba(0,0,0,0.6); padding: 15px; border-radius: 10px; border: 1px solid #45a29e; margin-bottom: 15px; }
        .admin-section h3 { font-size: 14px; color: #66fcf1; margin-bottom: 10px; border-bottom: 1px solid #333; padding-bottom: 5px; }
        .input-group { margin-bottom: 10px; }
        .input-group label { display: block; font-size: 11px; color: #aaa; margin-bottom: 4px; }
        .input-group input, .input-group textarea { width: 100%; background: #111; border: 1px solid #444; color: #fff; padding: 8px; border-radius: 5px; font-family: 'Poppins'; outline: none;}
        .input-group input:focus { border-color: #66fcf1; }
        
        .toggle-row { display: flex; justify-content: space-between; margin-bottom: 10px; align-items: center; background: #1a1a1a; padding: 8px; border-radius: 5px;}
        .toggle-row span { font-size: 13px; font-weight: bold; }
        .switch { position: relative; display: inline-block; width: 40px; height: 20px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 34px; }
        .slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 2px; bottom: 2px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: #4cd137; }
        input:checked + .slider:before { transform: translateX(20px); }

        .time-box { display: flex; gap: 10px; margin-bottom: 5px; }
        .time-box input { flex: 1; }

        .save-btn { width: 100%; background: #45a29e; color: #000; font-weight: bold; padding: 12px; border: none; border-radius: 10px; cursor: pointer; font-size: 16px; margin-top: 10px; transition: 0.3s;}
        .save-btn:hover { background: #66fcf1; }

        .note { font-size: 10px; color: #ffaa00; margin-top: 5px; margin-bottom: 10px;}
    </style>
</head>
<body>

    <!-- USER APP AREA -->
    <div class="app-container">
        <div class="tab-wrapper">
            <div class="tab-btn active" onclick="window.switchServer('30S', this)">30s</div>
            <div class="tab-btn" onclick="window.switchServer('1M', this)">1 Min</div>
            <div class="tab-btn" onclick="window.switchServer('3M', this)">3 Min</div>
            <div class="tab-btn" onclick="window.switchServer('5M', this)">5 Min</div>
        </div>

        <div class="glass-card">
            <div class="header-info">
                <div class="server-name" id="serverTitle">WINGO 30 SECONDS</div>
            </div>
            
            <div class="timer-row">
                <div class="period-box">
                    <h4>Current Period</h4>
                    <span id="periodDisplay">Loading...</span>
                </div>
                <div class="timer-box">
                    <span id="timerDisplay">00</span>
                </div>
            </div>

            <div class="pred-container">
                <div class="pred-text is-wait" id="predResult">WAIT</div>
            </div>
        </div>

        <div class="glass-card">
            <table>
                <thead>
                    <tr><th>PERIOD</th><th>SIGNAL</th><th>RESULT</th></tr>
                </thead>
                <tbody id="historyBody">
                    <tr><td colspan="3" style="color:#666;">Waiting...</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <!-- ADMIN PANEL AREA -->
    <div class="admin-container">
        <div class="admin-header"><i class="fas fa-cogs"></i> SECRET ADMIN PANEL</div>
        
        <div class="admin-section">
            <h3><i class="fab fa-telegram"></i> Telegram Config</h3>
            <div class="input-group">
                <label>Bot Token</label>
                <input type="text" id="admin_bot_token" placeholder="7123456:AAH...">
            </div>
            <div class="input-group">
                <label>Channel ID (ex: @mychannel or -100123...)</label>
                <input type="text" id="admin_channel_id" placeholder="-100xxxxxxx">
            </div>
            <div class="input-group">
                <label>Signal Message Template <br><small>Use {period} and {result} as variables</small></label>
                <textarea id="admin_msg_template" rows="4" placeholder="Period: {period}&#10;Result: {result}"></textarea>
            </div>
        </div>

        <div class="admin-section">
            <h3><i class="fas fa-server"></i> Active Servers (Forward to Telegram)</h3>
            <div class="toggle-row"><span>30 Seconds Server</span><label class="switch"><input type="checkbox" id="toggle_30S"><span class="slider"></span></label></div>
            <div class="toggle-row"><span>1 Minute Server</span><label class="switch"><input type="checkbox" id="toggle_1M"><span class="slider"></span></label></div>
            <div class="toggle-row"><span>3 Minute Server</span><label class="switch"><input type="checkbox" id="toggle_3M"><span class="slider"></span></label></div>
            <div class="toggle-row"><span>5 Minute Server</span><label class="switch"><input type="checkbox" id="toggle_5M"><span class="slider"></span></label></div>
        </div>

        <div class="admin-section">
            <h3><i class="fas fa-sticky-note"></i> Win/Loss Stickers (Telegram File ID)</h3>
            <div class="note">Win হলে পরপর ৩টি স্টিকার যাবে। Loss হলে শুধু ১ম স্টিকারটি যাবে।</div>
            
            <label style="color:#ffd700; font-size:12px; font-weight:bold; margin-top:10px; display:block;">BIG WIN Stickers (পরপর ৩টি যাবে)</label>
            <div class="input-group"><input type="text" id="big_win_1" placeholder="1st Sticker ID"></div>
            <div class="input-group"><input type="text" id="big_win_2" placeholder="2nd Sticker ID"></div>
            <div class="input-group"><input type="text" id="big_win_3" placeholder="3rd Sticker ID"></div>

            <label style="color:#00e5ff; font-size:12px; font-weight:bold; margin-top:10px; display:block;">SMALL WIN Stickers (পরপর ৩টি যাবে)</label>
            <div class="input-group"><input type="text" id="small_win_1" placeholder="1st Sticker ID"></div>
            <div class="input-group"><input type="text" id="small_win_2" placeholder="2nd Sticker ID"></div>
            <div class="input-group"><input type="text" id="small_win_3" placeholder="3rd Sticker ID"></div>

            <label style="color:#ff003c; font-size:12px; font-weight:bold; margin-top:10px; display:block;">LOSS Stickers (শুধু ১টি যাবে)</label>
            <div class="input-group"><input type="text" id="loss_1" placeholder="Loss Sticker ID 1"></div>
            <div class="input-group"><input type="text" id="loss_2" placeholder="Optional (রাখতে পারেন)"></div>
            <div class="input-group"><input type="text" id="loss_3" placeholder="Optional (রাখতে পারেন)"></div>
        </div>

        <div class="admin-section">
            <h3><i class="fas fa-clock"></i> Schedule Times (Bangladesh Time)</h3>
            <div class="note">Set format exactly like 14:30 or 09:00. Empty boxes are ignored.</div>
            <div id="schedule_boxes">
                <!-- Javascript will generate 10 boxes here -->
            </div>
        </div>

        <button class="save-btn" id="save_firebase_btn">SAVE TO DATABASE</button>
    </div>

    <!-- Firebase Script (Module) for Admin Panel -->
    <script type="module">
        import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
        import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

        // Firebase Configuration
        const firebaseConfig = {
            apiKey: "AIzaSyAUZo6Mls52d549yGCPFndgWlD3dGp6jEM",
            authDomain: "sell-2-a3835.firebaseapp.com",
            databaseURL: "https://sell-2-a3835-default-rtdb.firebaseio.com",
            projectId: "sell-2-a3835",
            storageBucket: "sell-2-a3835.firebasestorage.app",
            messagingSenderId: "762480029232",
            appId: "1:762480029232:web:6e9feb792a16a8a9c0c7f5"
        };

        const app = initializeApp(firebaseConfig);
        const db = getDatabase(app);
        const dbRef = ref(db, 'adminSettings');

        let config = {};

        // Generate 10 Time Boxes
        let schedHtml = "";
        for(let i=0; i<10; i++) {
            schedHtml += \`<div class="time-box">
                <input type="time" id="sch_start_\${i}" placeholder="Start">
                <input type="time" id="sch_end_\${i}" placeholder="End">
            </div>\`;
        }
        document.getElementById('schedule_boxes').innerHTML = schedHtml;

        // Load settings from Firebase
        onValue(dbRef, (snapshot) => {
            const data = snapshot.val();
            if(data) {
                config = data;
                document.getElementById('admin_bot_token').value = config.botToken || "";
                document.getElementById('admin_channel_id').value = config.channelId || "";
                document.getElementById('admin_msg_template').value = config.msgTemplate || "PERIOD: {period}\\nPREDICTION: {result}";
                
                if(config.servers) {
                    document.getElementById('toggle_30S').checked = config.servers['30S'];
                    document.getElementById('toggle_1M').checked = config.servers['1M'];
                    document.getElementById('toggle_3M').checked = config.servers['3M'];
                    document.getElementById('toggle_5M').checked = config.servers['5M'];
                }

                if(config.stickers) {
                    document.getElementById('big_win_1').value = config.stickers.bigWin[0] || "";
                    document.getElementById('big_win_2').value = config.stickers.bigWin[1] || "";
                    document.getElementById('big_win_3').value = config.stickers.bigWin[2] || "";
                    
                    document.getElementById('small_win_1').value = config.stickers.smallWin[0] || "";
                    document.getElementById('small_win_2').value = config.stickers.smallWin[1] || "";
                    document.getElementById('small_win_3').value = config.stickers.smallWin[2] || "";

                    document.getElementById('loss_1').value = config.stickers.loss[0] || "";
                    document.getElementById('loss_2').value = config.stickers.loss[1] || "";
                    document.getElementById('loss_3').value = config.stickers.loss[2] || "";
                }

                if(config.schedules) {
                    for(let i=0; i<10; i++) {
                        if(config.schedules[i]) {
                            document.getElementById(\`sch_start_\${i}\`).value = config.schedules[i].start || "";
                            document.getElementById(\`sch_end_\${i}\`).value = config.schedules[i].end || "";
                        }
                    }
                }
            }
        });

        // Save to Firebase
        document.getElementById('save_firebase_btn').addEventListener('click', () => {
            let schedules = [];
            for(let i=0; i<10; i++) {
                let s = document.getElementById(\`sch_start_\${i}\`).value;
                let e = document.getElementById(\`sch_end_\${i}\`).value;
                schedules.push({ start: s, end: e });
            }

            const newData = {
                botToken: document.getElementById('admin_bot_token').value,
                channelId: document.getElementById('admin_channel_id').value,
                msgTemplate: document.getElementById('admin_msg_template').value,
                servers: {
                    '30S': document.getElementById('toggle_30S').checked,
                    '1M': document.getElementById('toggle_1M').checked,
                    '3M': document.getElementById('toggle_3M').checked,
                    '5M': document.getElementById('toggle_5M').checked
                },
                stickers: {
                    bigWin: [document.getElementById('big_win_1').value, document.getElementById('big_win_2').value, document.getElementById('big_win_3').value],
                    smallWin: [document.getElementById('small_win_1').value, document.getElementById('small_win_2').value, document.getElementById('small_win_3').value],
                    loss: [document.getElementById('loss_1').value, document.getElementById('loss_2').value, document.getElementById('loss_3').value]
                },
                schedules: schedules
            };

            set(dbRef, newData).then(() => {
                alert("Settings Saved to Firebase Successfully!");
            });
        });
    </script>

    <!-- UI Fetch Data Script -->
    <script>
        let currentServer = '30S';

        // Local Timer
        setInterval(() => {
            const d = new Date();
            const s = d.getSeconds();
            const m = d.getMinutes();
            let rem = 0;
            if(currentServer === '30S') rem = 30 - (s % 30);
            else if(currentServer === '1M') rem = 60 - s;
            else if(currentServer === '3M') rem = 180 - ((m % 3) * 60 + s);
            else if(currentServer === '5M') rem = 300 - ((m % 5) * 60 + s);
            if(rem === 60 || rem === 180 || rem === 300) rem = 0;
            
            let mDisp = Math.floor(rem / 60);
            let sDisp = rem % 60;
            let timeStr = (mDisp > 0 ? (mDisp < 10 ? '0'+mDisp : mDisp) + ':' : '') + (sDisp < 10 ? '0'+sDisp : sDisp);
            
            const timerEl = document.getElementById('timerDisplay');
            timerEl.innerText = timeStr;
            timerEl.style.color = rem <= 5 ? '#ff003c' : '#66fcf1';
        }, 1000);

        // Fetch Live Data from Node.js Backend 
        async function fetchState() {
            try {
                const res = await fetch('/api/state');
                const data = await res.json();
                updateUI(data[currentServer]);
            } catch (e) {}
        }
        setInterval(fetchState, 1500);

        function updateUI(sData) {
            if(!sData || !sData.nextPStr) return;

            document.getElementById('periodDisplay').innerText = sData.nextPStr.slice(-5); // Show last 5 digits
            
            const resEl = document.getElementById('predResult');
            resEl.innerText = sData.pred;
            resEl.className = 'pred-text ' + (sData.pred === 'BIG' ? 'is-big' : 'is-small');

            let html = "";
            let historyToShow = sData.history.slice(0, 5); // Show latest 5
            historyToShow.forEach(item => {
                let sClass = item.status === 'WIN' ? 't-win' : (item.status === 'LOSS' ? 't-loss' : 't-wait');
                let colorClass = item.s === 'BIG' ? 'color:#ffd700;' : 'color:#00e5ff;';
                html += \`<tr>
                    <td>\${item.p.slice(-5)}</td>
                    <td style="\${colorClass}">\${item.s}</td>
                    <td><span class="\${sClass}">\${item.status}</span></td>
                </tr>\`;
            });
            document.getElementById('historyBody').innerHTML = html;
        }

        window.switchServer = (server, btnEl) => {
            currentServer = server;
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            btnEl.classList.add('active');
            let titles = {'30S': 'WINGO 30 SECONDS', '1M': 'WINGO 1 MINUTE', '3M': 'WINGO 3 MINUTES', '5M': 'WINGO 5 MINUTES'};
            document.getElementById('serverTitle').innerText = titles[server];
            fetchState(); 
        };
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
