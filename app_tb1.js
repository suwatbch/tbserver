const puppeteer = require('puppeteer');
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());

// ตัวแปรควบคุม Protocol
const HTTP = 'http';                // Protocol สำหรับ HTTP
const HTTPS = 'https';              // Protocol สำหรับ HTTPS

// ตัวแปรควบคุม Server
const SERVER_PORT = 4000;                    // พอร์ตที่ใช้สำหรับ Express server
const SERVER_HOST = 'localhost';             // host ที่ใช้สำหรับ Express server
const CHROME_DEBUG_URL = `${HTTP}://127.0.0.1:9222`;  // URL สำหรับเชื่อมต่อกับ Chrome debugger

// ตัวแปรควบคุม URL และชื่อเว็บ
const BASE_URL = `${HTTPS}://th.turboroute.ai`;     // URL หลักของเว็บไซต์
const WORKDAY_URL = `${BASE_URL}/#/grab-single/single-hall`;    // URL ของหน้า single-hall
const WEBSITE_NAME = 'Turbo Route';                   // ชื่อเว็บไซต์ (ใช้สำหรับแสดงผล)
const MODULE_NAME = 'Single Hall';                         // ชื่อโมดูลที่ใช้งาน

// ตัวแปรควบคุมข้อความแสดงผล
const MESSAGES = {
    ALREADY_RUNNING: 'โปรแกรมกำลังทำงานอยู่แล้ว',
    ALREADY_STOPPED: 'โปรแกรมหยุดทำงานอยู่แล้ว',
    STARTED: 'บอทเริ่มการทำงานแล้ว',
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
        return res.json({ status: 'success', message: MESSAGES.ALREADY_RUNNING });
    }
    isRunning = true;
    roundCount = 0;
    runLoop();
    res.json({ status: 'success', message: MESSAGES.STARTED });
});

// API สำหรับหยุดการทำงาน
app.get('/stop', async (req, res) => {
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
                    
                    // รอให้ตารางและ pagination พร้อม
                    await targetPage.waitForSelector('table.el-table__body tbody tr', { timeout: 10000 });
                    await targetPage.waitForSelector('.el-pagination .el-pager li.number', { timeout: 10000 });

                    // อ่านจำนวนหน้าทั้งหมด
                    const totalPages = await targetPage.evaluate(() => {
                        const allNumberElements = document.querySelectorAll('.el-pager li.number');
                        return parseInt(allNumberElements[allNumberElements.length - 1]?.textContent || '1');
                    });

                    let currentPage = 1;
                    while (currentPage <= totalPages && isRunning) {

                        // อ่านข้อมูลในตาราง
                        const tableData = await targetPage.evaluate(() => {
                            const rows = document.querySelectorAll('table.el-table__body tbody tr');
                            return Array.from(rows, row => {
                                const cells = row.querySelectorAll('td');
                                return {
                                    routeId: cells[1]?.querySelector('button')?.textContent?.trim() || '',
                                    type: cells[2]?.textContent?.trim() || '',
                                    route: cells[3]?.textContent?.trim() || '',
                                    distance: cells[4]?.textContent?.trim() || '',
                                    startTime: cells[5]?.querySelector('span')?.textContent?.trim() || '',
                                    duration: cells[6]?.textContent?.trim() || '',
                                    endTime: cells[7]?.querySelector('span')?.textContent?.trim() || '',
                                    amount: cells[8]?.querySelector('span')?.textContent?.trim() || '',
                                    status: cells[9]?.querySelector('span')?.textContent?.trim() || ''
                                };
                            });
                        });

                        // แสดงข้อมูล
                        console.log(`\nหน้าที่ ${currentPage} จาก ${totalPages} หน้า:`);
                        tableData.forEach((row, index) => {
                            console.log(`${index + 1}. ${row.routeId} | ${row.type} | ${row.route} | ${row.distance} | ${row.startTime} | ${row.duration} | ${row.endTime} | ${row.amount} | ${row.status}`);
                        });

                        // ถ้ายังไม่ถึงหน้าสุดท้าย ให้กดปุ่มหน้าถัดไป
                        if (currentPage < totalPages) {
                            const nextPage = currentPage + 1;
                            await targetPage.evaluate((page) => {
                                const pageButtons = document.querySelectorAll('.el-pager li.number');
                                const nextButton = Array.from(pageButtons).find(btn => btn.textContent.trim() === String(page));
                                if (nextButton) nextButton.click();
                            }, nextPage);
                            
                            // รอให้ข้อมูลในตารางเปลี่ยน
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
                            // รอให้ปุ่มหน้าถัดไปเป็น active
                            await targetPage.waitForFunction(
                                (page) => {
                                    const activeButton = document.querySelector('.el-pager li.active');
                                    return activeButton && activeButton.textContent.trim() === String(page);
                                },
                                { timeout: 10000 },
                                nextPage
                            );
                        }

                        currentPage++;
                    }

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