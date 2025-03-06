const puppeteer = require('puppeteer');
const express = require('express');
const cors = require('cors');
const app = express();

const DEVELOPMENT_URL = 'http://localhost:3000'; 
const PRODUCTION_URL = 'https://tbbot.swmaxnet.com';

app.use(cors({
    origin: [DEVELOPMENT_URL, PRODUCTION_URL],
    methods: ['GET', 'POST'],
    credentials: true
}));

// ตัวแปรควบคุม Protocol
const HTTP = 'http';                // Protocol สำหรับ HTTP
const HTTPS = 'https';              // Protocol สำหรับ HTTPS

// ตัวแปรควบคุม Server
const SERVER_PORT = 5000;                    // พอร์ตที่ใช้สำหรับ Express server
const SERVER_HOST = 'localhost';             // host ที่ใช้สำหรับ Express server
const CHROME_DEBUG_URL = `${HTTP}://127.0.0.1:9222`;  // URL สำหรับเชื่อมต่อกับ Chrome debugger

// ตัวแปรควบคุม URL และชื่อเว็บ
const BASE_URL = `${HTTPS}://leave.swmaxnet.com`;     // URL หลักของเว็บไซต์
const WORKDAY_URL = `${BASE_URL}/#module=workday`;    // URL ของหน้า workday
const WEBSITE_NAME = 'Leave System';                   // ชื่อเว็บไซต์ (ใช้สำหรับแสดงผล)
const MODULE_NAME = 'Workday';                         // ชื่อโมดูลที่ใช้งาน

// ตัวแปรควบคุมข้อความแสดงผล
const MESSAGES = {
    ALREADY_RUNNING: 'โปรแกรมกำลังทำงานอยู่แล้ว',
    ALREADY_STOPPED: 'โปรแกรมหยุดทำงานอยู่แล้ว',
    STARTED: 'เริ่มการทำงานแล้ว',
    STOPPED: 'หยุดการทำงานแล้ว',
    RUNNING: 'โปรแกรมกำลังทำงานอยู่',
    STOPPED_STATUS: 'โปรแกรมหยุดทำงาน',
    CONNECTING: `กำลังเชื่อมต่อกับ ${WEBSITE_NAME}...`,
    NOT_ON_WORKDAY: `ไม่ได้อยู่ที่หน้า ${MODULE_NAME} กำลังนำทาง...`,
    CANNOT_OPEN_TAB: 'ไม่สามารถเปิดแท็บใหม่ได้:',
    ERROR: `เกิดข้อผิดพลาดในการทำงานกับ ${WEBSITE_NAME}:`,
    SERVER_RUNNING: `Server is running at ${HTTP}://${SERVER_HOST}:${SERVER_PORT}`
};

// ตัวแปรควบคุมการทำงาน
let isRunning = false;      // สถานะการทำงานของโปรแกรม (true = กำลังทำงาน, false = หยุดทำงาน)
let browser;               // ตัวแปรเก็บ instance ของ browser ที่เชื่อมต่อ
let roundCount = 0;        // จำนวนรอบที่ทำงานไปแล้ว

// ตัวแปรควบคุมเวลา (มิลลิวินาที)
const REFRESH_DELAY = 1000;  // เวลารอหลังรีเฟรช
const ERROR_DELAY = 2000;    // เวลารอหลังเกิด error

app.use(express.json());

// API สำหรับเริ่มการทำงาน
app.post('/start', async (req, res) => {
    if (isRunning) {
        return res.json({ status: 'already_running', message: MESSAGES.ALREADY_RUNNING });
    }
    isRunning = true;
    roundCount = 0;
    runLoop();
    res.json({ status: 'started', message: MESSAGES.STARTED });
});

// API สำหรับหยุดการทำงาน
app.post('/stop', async (req, res) => {
    if (!isRunning) {
        return res.json({ status: 'already_stopped', message: MESSAGES.ALREADY_STOPPED });
    }
    isRunning = false;
    res.json({ status: 'stopped', message: MESSAGES.STOPPED });
});

// API สำหรับเช็คสถานะ
app.get('/status', (req, res) => {
    res.json({
        status: isRunning ? 'running' : 'stopped',
        currentRound: roundCount,
        message: isRunning ? MESSAGES.RUNNING : MESSAGES.STOPPED_STATUS
    });
});

// ฟังก์ชันหลักที่ทำงานวนลูป
async function runLoop() {
    try {
        if (!browser) {
            console.log(MESSAGES.CONNECTING);
            browser = await puppeteer.connect({
                browserURL: CHROME_DEBUG_URL,
                defaultViewport: null
            });
        }

        while (isRunning) {
            roundCount++;
            const pages = await browser.pages();
            const targetPages = pages.filter(page => page.url().includes(BASE_URL));

            if (targetPages.length > 0) {
                const targetPage = targetPages[0];
                const currentUrl = await targetPage.url();
                
                if (currentUrl === WORKDAY_URL) {
                    console.log(`\nรอบที่ ${roundCount}:`);
                    await targetPage.reload({ waitUntil: 'networkidle0' });
                    await targetPage.waitForSelector('table');

                    const tableData = await targetPage.evaluate(() => {
                        const rows = document.querySelectorAll('table tr');
                        return Array.from(rows, row => {
                            const cells = row.querySelectorAll('td, th');
                            return Array.from(cells, cell => cell.innerText.trim());
                        });
                    });

                    tableData.forEach(row => {
                        if (row.length > 0) {
                            console.log(row.join(' | '));
                        }
                    });

                    if (isRunning) {
                        await new Promise(resolve => setTimeout(resolve, REFRESH_DELAY));
                    }
                } else {
                    console.log(MESSAGES.NOT_ON_WORKDAY);
                    await targetPage.goto(WORKDAY_URL, {
                        waitUntil: 'networkidle0'
                    });
                }
            } else {
                try {
                    const newPage = await browser.newPage();
                    await newPage.goto(WORKDAY_URL, {
                        waitUntil: 'networkidle0'
                    });
                } catch (error) {
                    console.error(MESSAGES.CANNOT_OPEN_TAB, error.message);
                    isRunning = false;
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, ERROR_DELAY));
            }
        }
    } catch (error) {
        console.error(MESSAGES.ERROR, error.message);
        isRunning = false;
    }
}

// เริ่ม server
app.listen(SERVER_PORT, () => {
    console.log(MESSAGES.SERVER_RUNNING);
});