const express = require('express');
const axios = require('axios');
const firebase = require('firebase/app');
require('firebase/database');

// --- 1. EXPRESS WEB SERVER (For Render.com Port Binding) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('✅ DK WIN DUAL SYSTEM Backend is Running 24/7 successfully!');
});

app.listen(PORT, () => {
    console.log(`🌐 Server is running on port ${PORT}`);
});

// --- 2. FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyByZ6BElQgRFqc8lT_th7_zVC90bd-ojTA",
  authDomain: "prido-dfae3.firebaseapp.com",
  databaseURL: "https://prido-dfae3-default-rtdb.firebaseio.com",
  projectId: "prido-dfae3",
  storageBucket: "prido-dfae3.firebasestorage.app",
  messagingSenderId: "473296982048",
  appId: "1:473296982048:web:b56e19bdbb94a5a5442c45",
  measurementId: "G-5K77JS2BD1"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

// --- 3. FETCH TELEGRAM SETTINGS FROM FIREBASE ---
let tgSettings = null;
db.ref('telegram_settings_30s').on('value', (snap) => {
    tgSettings = snap.val();
    console.log("📲 Firebase Telegram Settings Updated:", tgSettings ? "Active" : "Not Found");
});

// --- 4. TELEGRAM MESSAGE SENDER ---
async function sendTelegramMsg(msgType, period, signal = "") {
    try {
        // Firebase থেকে Admin Control: Auto Forward OFF (is_active = false) থাকলে মেসেজ যাবে না।
        if (!tgSettings || tgSettings.is_active === false) return; 
        if (!tgSettings.bot_token || !tgSettings.chat_id) return;

        let rawMsg = "";
        if (msgType === "SIGNAL") rawMsg = tgSettings.msg_signal;
        else if (msgType === "WIN") rawMsg = tgSettings.msg_win;
        else if (msgType === "LOSS") rawMsg = tgSettings.msg_loss;

        if (!rawMsg) return;

        // Replace placeholders (e.g. {period}, {signal})
        let finalMsg = rawMsg.replace(/{period}/g, period).replace(/{signal}/g, signal);

        const url = `https://api.telegram.org/bot${tgSettings.bot_token}/sendMessage`;
        await axios.post(url, {
            chat_id: tgSettings.chat_id,
            text: finalMsg
        });
        console.log(`📨 Telegram Message Sent: [${msgType}] Period: ${period}`);
    } catch (err) {
        console.error("❌ Telegram Send Error:", err.message);
    }
}

// --- 5. MATH LOGIC PREDICTION ---
function getMathPrediction(list, nextPeriodNumber) {
    let sumOfLast5 = 0;
    for(let i = 0; i < 5; i++) { sumOfLast5 += parseInt(list[i].number); }

    let periodLastDigit = parseInt(nextPeriodNumber.toString().slice(-1));
    let totalSum = sumOfLast5 + periodLastDigit;
    let finalDigit = totalSum.toString().split('').reduce((a, b) => parseInt(a) + parseInt(b), 0);

    let decision = finalDigit >= 5 ? 'BIG' : 'SMALL';
    return decision;
}

// --- 6. CORE GAME LOOP (SYNC 30S API) ---
const API_30S = 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json';
let currentPeriod = "";
let pendingPrediction = null; // { period: "...", size: "..." }

async function syncServer() {
    try {
        const response = await axios.get(API_30S + '?v=' + Date.now());
        const list = response.data?.data?.list;
        
        if (!list || list.length < 5) return;

        const latestIssue = list[0].issueNumber;
        const actualNumber = parseInt(list[0].number);
        const actualSize = actualNumber >= 5 ? 'BIG' : 'SMALL';
        const nextPrd = (BigInt(latestIssue) + 1n).toString();

        // 🟢 CHECK PREVIOUS PENDING RESULT
        if (pendingPrediction && pendingPrediction.period === latestIssue) {
            const isWin = (pendingPrediction.size === actualSize);
            
            // Send Win/Loss to Telegram
            await sendTelegramMsg(isWin ? 'WIN' : 'LOSS', latestIssue.slice(-4));
            
            // Clear pending
            pendingPrediction = null; 
        }

        // 🔵 NEW PERIOD DETECTED
        if (currentPeriod !== nextPrd) {
            currentPeriod = nextPrd;
            console.log(`\n⚡ New Cycle Started: ${nextPrd}`);
            
            const predictionSize = getMathPrediction(list, nextPrd);
            
            // Save as pending for next cycle
            pendingPrediction = { period: nextPrd, size: predictionSize };
            
            // Send Signal to Telegram (Delayed slightly)
            setTimeout(async () => { 
                await sendTelegramMsg('SIGNAL', nextPrd.slice(-4), predictionSize); 
            }, 1000);
        }

    } catch (error) {
        console.error("⚠️ API Sync Error:", error.message);
    }
}

// Run the loop every 2 seconds (Optmized and crash-proof)
setInterval(syncServer, 2000);
console.log("🚀 Engine Started! Waiting for API sync...");
