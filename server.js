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
        if (!tgSettings || tgSettings.is_active === false) return; 
        if (!tgSettings.bot_token || !tgSettings.chat_id) return;

        let rawMsg = "";
        if (msgType === "SIGNAL") rawMsg = tgSettings.msg_signal;
        else if (msgType === "WIN") rawMsg = tgSettings.msg_win;
        else if (msgType === "LOSS") rawMsg = tgSettings.msg_loss;

        if (!rawMsg) return;

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
let pendingPrediction = null;

async function syncServer() {
    try {
        // 403 Forbidden বাইপাস করার জন্য ফেইক ব্রাউজার হেডার্স
        const config = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
                'Referer': 'https://ar-lottery01.com/',
                'Origin': 'https://ar-lottery01.com',
                'Connection': 'keep-alive',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-site',
                'Cache-Control': 'no-cache'
            },
            timeout: 10000 // রিকোয়েস্ট আটকে গেলে ক্র্যাশ ঠেকানোর জন্য টাইমআউট
        };

        const response = await axios.get(`${API_30S}?v=${Date.now()}`, config);
        const list = response.data?.data?.list;
        
        if (!list || list.length < 5) return;

        const latestIssue = list[0].issueNumber;
        const actualNumber = parseInt(list[0].number);
        const actualSize = actualNumber >= 5 ? 'BIG' : 'SMALL';
        const nextPrd = (BigInt(latestIssue) + 1n).toString();

        // 🟢 CHECK PREVIOUS PENDING RESULT (Win/Loss Check)
        if (pendingPrediction && pendingPrediction.period === latestIssue) {
            const isWin = (pendingPrediction.size === actualSize);
            await sendTelegramMsg(isWin ? 'WIN' : 'LOSS', latestIssue.slice(-4));
            pendingPrediction = null; 
        }

        // 🔵 NEW PERIOD DETECTED (Signal Generation)
        if (currentPeriod !== nextPrd) {
            currentPeriod = nextPrd;
            console.log(`\n⚡ New Cycle Started: ${nextPrd}`);
            
            const predictionSize = getMathPrediction(list, nextPrd);
            pendingPrediction = { period: nextPrd, size: predictionSize };
            
            setTimeout(async () => { 
                await sendTelegramMsg('SIGNAL', nextPrd.slice(-4), predictionSize); 
            }, 1000);
        }

    } catch (error) {
        if (error.response) {
            // যদি ওয়েবসাইট ব্লক করে
            console.error(`⚠️ API Error (Status ${error.response.status}): Website is blocking or down.`);
        } else if (error.code === 'ECONNABORTED') {
            console.error("⚠️ API Timeout: Website took too long to respond.");
        } else {
            console.error("⚠️ API Sync Error:", error.message);
        }
    }
}

// লুপ চালানো হচ্ছে প্রতি ৩ সেকেন্ডে (3000 ms) যেন সার্ভার ব্লক না করে
setInterval(syncServer, 3000);
console.log("🚀 Engine Started! Waiting for API sync...");
