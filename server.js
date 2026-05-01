const express = require('express');
const axios = require('axios');
const firebase = require('firebase/app');
require('firebase/database');

// --- 1. EXPRESS SERVER ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('✅ DK WIN Backend is Running with Multi-Proxy Bypass!');
});

app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
});

// --- 2. FIREBASE CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyByZ6BElQgRFqc8lT_th7_zVC90bd-ojTA",
  authDomain: "prido-dfae3.firebaseapp.com",
  databaseURL: "https://prido-dfae3-default-rtdb.firebaseio.com",
  projectId: "prido-dfae3",
  storageBucket: "prido-dfae3.firebasestorage.app",
  messagingSenderId: "473296982048",
  appId: "1:473296982048:web:b56e19bdbb94a5a5442c45"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let tgSettings = null;
db.ref('telegram_settings_30s').on('value', (snap) => {
    tgSettings = snap.val();
});

// --- 3. TELEGRAM SENDER ---
async function sendTelegramMsg(msgType, period, signal = "") {
    try {
        if (!tgSettings || !tgSettings.is_active || !tgSettings.bot_token || !tgSettings.chat_id) return;

        let rawMsg = msgType === "SIGNAL" ? tgSettings.msg_signal : (msgType === "WIN" ? tgSettings.msg_win : tgSettings.msg_loss);
        if (!rawMsg) return;

        let finalMsg = rawMsg.replace(/{period}/g, period).replace(/{signal}/g, signal);
        await axios.post(`https://api.telegram.org/bot${tgSettings.bot_token}/sendMessage`, {
            chat_id: tgSettings.chat_id,
            text: finalMsg
        });
        console.log(`📨 Sent [${msgType}] for Period: ${period}`);
    } catch (err) {
        // Silent error for TG to prevent console spam
    }
}

// --- 4. MATH LOGIC ---
function getMathPrediction(list, nextPeriodNumber) {
    let sumOfLast5 = 0;
    for(let i = 0; i < 5; i++) sumOfLast5 += parseInt(list[i].number);
    
    let periodLastDigit = parseInt(nextPeriodNumber.toString().slice(-1));
    let totalSum = sumOfLast5 + periodLastDigit;
    let finalDigit = totalSum.toString().split('').reduce((a, b) => parseInt(a) + parseInt(b), 0);
    return finalDigit >= 5 ? 'BIG' : 'SMALL';
}

// --- 5. ROBUST MULTI-PROXY FETCH SYSTEM ---
const TARGET_URL = 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json';

async function fetchGameData() {
    const timestamp = Date.now();
    const targetWithTime = `${TARGET_URL}?v=${timestamp}`;
    
    // 3টি আলাদা প্রক্সি, একটি ফেইল করলে অন্যটি কাজ করবে
    const proxyList = [
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetWithTime)}`,
        `https://corsproxy.io/?${encodeURIComponent(targetWithTime)}`,
        `https://thingproxy.freeboard.io/fetch/${targetWithTime}`
    ];

    for (let proxy of proxyList) {
        try {
            const response = await axios.get(proxy, { timeout: 8000 });
            if (response.data && response.data.data && response.data.data.list) {
                return response.data.data.list; // সফল হলে ডেটা রিটার্ন করবে
            }
        } catch (e) {
            continue; // ব্লক খেলে বা 500 আসলে পরের প্রক্সিতে যাবে
        }
    }
    throw new Error("All proxies failed to fetch");
}

// --- 6. CORE GAME LOOP ---
let currentPeriod = "";
let pendingPrediction = null;

async function syncServer() {
    try {
        const list = await fetchGameData();
        if (!list || list.length < 5) return;

        const latestIssue = list[0].issueNumber;
        const actualSize = parseInt(list[0].number) >= 5 ? 'BIG' : 'SMALL';
        const nextPrd = (BigInt(latestIssue) + 1n).toString();

        // 🟢 Result Check
        if (pendingPrediction && pendingPrediction.period === latestIssue) {
            const isWin = (pendingPrediction.size === actualSize);
            await sendTelegramMsg(isWin ? 'WIN' : 'LOSS', latestIssue.slice(-4));
            pendingPrediction = null; 
        }

        // 🔵 New Period Signal
        if (currentPeriod !== nextPrd) {
            currentPeriod = nextPrd;
            console.log(`⚡ New Cycle: ${nextPrd}`);
            const predictionSize = getMathPrediction(list, nextPrd);
            pendingPrediction = { period: nextPrd, size: predictionSize };
            
            setTimeout(() => sendTelegramMsg('SIGNAL', nextPrd.slice(-4), predictionSize), 1000);
        }
    } catch (error) {
        console.log("⚠️ Syncing via backup routes...");
    }
}

// প্রতি ৪ সেকেন্ডে ডেটা আনবে (বেশি ফাস্ট করলে প্রক্সি ব্লক করে দেয়)
setInterval(syncServer, 4000);
console.log("🚀 Engine Started! Auto-switching Proxies Enabled...");
