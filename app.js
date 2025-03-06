const puppeteer = require('puppeteer');
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// Middleware ตรวจสอบ Content-Type
const validateContentType = (req, res, next) => {
    if (req.method === 'POST') {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('application/json')) {
            return res.status(400).json({
                status: 'error',
                message: 'Content-Type ต้องเป็น application/json'
            });
        }
    }
    next();
};

app.use(validateContentType);

// ตัวแปรควบคุม Protocol
const HTTP = 'http';                // Protocol สำหรับ HTTP
const HTTPS = 'https';              // Protocol สำหรับ HTTPS

// ตัวแปรควบคุม Server
const SERVER_PORT = 5000;                    // พอร์ตที่ใช้สำหรับ Express server
const SERVER_HOST = 'localhost';             // host ที่ใช้สำหรับ Express server
const CHROME_DEBUG_URL = `${HTTP}://127.0.0.1:9222`;  // URL สำหรับเชื่อมต่อกับ Chrome debugger

// ตัวแปรควบคุม URL และชื่อเว็บ
const BASE_URL = `${HTTPS}://th.turboroute.ai`;     // URL หลักของเว็บไซต์
const WORKDAY_URL = `${BASE_URL}/#/grab-single/single-hall`;    // URL ของหน้า single-hall

// ตัวแปรควบคุมเวลา (มิลลิวินาที)
const REFRESH_DELAY = 500;  // เวลารอก่อนรีเฟรช
const ERROR_DELAY = 2000;    // เวลารอหลังเกิด error
const WAIT_TIMEOUT = 10000;  // เวลารอสูงสุดสำหรับ element
const MAX_RETRIES = 2;      // จำนวนครั้งสูงสุดที่จะลองอ่านซ้ำ

// ตัวแปรควบคุมการทำงาน
let isRunning = false;      // สถานะการทำงานของโปรแกรม
let browser;               // ตัวแปรเก็บ instance ของ browser
let roundCount = 0;        // จำนวนรอบที่ทำงาน
let currentConfig = null;  // ค่า config ปัจจุบัน

// ฟังก์ชันแสดงสรุปผล
function showSummary(isEndSummary = false) {
    if (!currentConfig) return;

    const now = new Date().toLocaleString('th-TH');
    console.log(`\n📅 ${isEndSummary ? 'ผลสรุปสุดท้าย' : 'สรุปผลรายรอบ'}: ${now}`);
    
    console.log("\n🚗 รถว่าง:");
    Object.entries(currentConfig.myCars).forEach(([carType, count]) => {
        if (count > 0) {
            console.log(`   - ${carType} จำนวน ${count} คัน`);
        }
    });

    console.log("\n✅ รับงาน:");
    Object.entries(currentConfig.assignedRoutes).forEach(([carType, routes]) => {
        if (routes.length > 0) {
            console.log(`   - ${carType} จำนวน ${routes.length} คัน 🛣️ เส้นทาง: ${routes.join(', ')}`);
        }
    });
    console.log("\n-----------------------------------------------");
}

// ฟังก์ชันตรวจสอบว่ารับงานครบหรือยัง
function isAllJobsAssigned() {
    if (!currentConfig) return true;
    return Object.values(currentConfig.myCars).every(count => count === 0);
}

// API สำหรับเริ่มการทำงาน
app.post('/start', async (req, res) => {
    const { cars, routes } = req.body;
    
    // ตรวจสอบรูปแบบข้อมูล
    if (!cars || !Array.isArray(cars) || !routes || !Array.isArray(routes)) {
        return res.json({ 
            status: 'error', 
            message: 'รูปแบบข้อมูลไม่ถูกต้อง กรุณาระบุ cars เป็น array ของ object และ routes เป็น array ของ string' 
        });
    }

    if (isRunning) {
        return res.json({ status: 'already_running', message: 'โปรแกรมกำลังทำงานอยู่แล้ว' });
    }

    try {
        // เชื่อมต่อกับ Chrome
        browser = await puppeteer.connect({
            browserURL: CHROME_DEBUG_URL,
            defaultViewport: null
        });
    } catch (error) {
        return res.json({ 
            status: 'error', 
            message: 'ไม่สามารถเชื่อมต่อกับ Chrome ได้ กรุณาตรวจสอบว่า Chrome เปิดอยู่ในโหมด debug' 
        });
    }

    // แปลงข้อมูลรถจาก array เป็น object
    const carsObject = cars.reduce((acc, car) => {
        acc[car.type] = car.quantity;
        return acc;
    }, {});

    // เก็บค่า config ปัจจุบัน
    currentConfig = {
        myCars: carsObject,
        routeDirections: routes,
        assignedCars: Object.fromEntries(Object.keys(carsObject).map(key => [key, 0])),
        assignedRoutes: Object.fromEntries(Object.keys(carsObject).map(key => [key, []]))
    };

    isRunning = true;
    roundCount = 0;
    runLoop();
    res.json({ 
        status: 'started', 
        message: 'บอทเริ่มการทำงานแล้ว',
        config: {
            cars: carsObject,
            routes: routes
        }
    });
});

// API สำหรับหยุดการทำงาน
app.get('/stop', async (req, res) => {
    if (!isRunning) {
        return res.json({ status: 'already_stopped', message: 'โปรแกรมหยุดทำงานอยู่แล้ว' });
    }
    isRunning = false;
    res.json({ status: 'stopped', message: 'หยุดการทำงานแล้ว' });
});

// API สำหรับเช็คสถานะ
app.get('/status', (req, res) => {
    const status = {
        status: isRunning ? 'running' : 'stopped',
        currentRound: roundCount,
        message: isRunning ? 'โปรแกรมกำลังทำงานอยู่' : 'โปรแกรมหยุดทำงาน'
    };

    if (currentConfig) {
        status.config = {
            remainingCars: currentConfig.myCars,
            assignedRoutes: currentConfig.assignedRoutes
        };
    }

    res.json(status);
});

// ฟังก์ชันหลักที่ทำงานวนลูป
async function runLoop() {
    try {
        while (isRunning && !isAllJobsAssigned()) {
            roundCount++;
            const pages = await browser.pages();
            const targetPages = pages.filter(page => page.url().includes(BASE_URL));

            if (targetPages.length > 0) {
                const targetPage = targetPages[0];
                
                // จัดการ popup ที่อาจค้างอยู่
                try {
                    await targetPage.evaluate(() => {
                        const dialogs = document.querySelectorAll('.el-dialog__wrapper');
                        dialogs.forEach(dialog => {
                            if (dialog.style.display !== 'none') {
                                const closeBtn = dialog.querySelector('.el-dialog__close');
                                if (closeBtn) closeBtn.click();
                            }
                        });
                    });
                } catch (error) {
                    console.log('ไม่พบ popup ค้าง');
                }

                const currentUrl = await targetPage.url();
                
                if (currentUrl === WORKDAY_URL) {
                    console.log(`\nรอบที่ ${roundCount}:`);
                    await targetPage.reload({ waitUntil: 'networkidle0' });
                    
                    // รอให้ตารางโหลดเสร็จ
                    await targetPage.waitForSelector('table.el-table__body tbody tr', { timeout: WAIT_TIMEOUT });

                    let retryCount = 0;
                    while (retryCount < MAX_RETRIES && !isAllJobsAssigned()) {
                        // อ่านและประมวลผลข้อมูลในตาราง
                        const results = await targetPage.evaluate((config) => {
                            const table = document.querySelector('table.el-table__body');
                            if (!table) return { success: false, message: 'ไม่พบตาราง' };

                            const tbody = table.querySelector('tbody');
                            if (!tbody) return { success: false, message: 'ไม่พบข้อมูลในตาราง' };

                            const rows = tbody.querySelectorAll('tr');
                            if (!rows || rows.length === 0) return { success: false, message: 'ไม่พบแถวข้อมูล' };

                            const actions = [];
                            rows.forEach((row, index) => {
                                const cells = row.querySelectorAll('td');
                                if (cells.length >= 4) {
                                    const route = cells[1].textContent.trim();
                                    const carType = cells[3].textContent.trim();

                                    if (carType in config.myCars && 
                                        config.routeDirections.includes(route) && 
                                        config.myCars[carType] > 0) {
                                        
                                        const button = row.querySelector('button span');
                                        if (button && button.textContent.includes('แข่งขันรับงาน')) {
                                            actions.push({ index, carType, route });
                                        }
                                    }
                                }
                            });

                            return { success: true, actions };
                        }, currentConfig);

                        if (results.success && results.actions.length > 0) {
                            for (const action of results.actions) {
                                try {
                                    // อัพเดทสถานะ
                                    currentConfig.myCars[action.carType]--;
                                    currentConfig.assignedCars[action.carType]++;
                                    currentConfig.assignedRoutes[action.carType].push(action.route);

                                    console.log(`✅ รับงานสำเร็จ: ${action.carType} เส้นทาง ${action.route}`);
                                    await new Promise(resolve => setTimeout(resolve, 500));
                                } catch (error) {
                                    console.log(`❌ ไม่สามารถรับงานได้: ${error.message}`);
                                }
                            }
                            showSummary();
                            break;
                        } else {
                            retryCount++;
                            if (retryCount >= MAX_RETRIES) {
                                console.log('ไม่พบงานที่ตรงเงื่อนไข, รอรอบถัดไป');
                            } else {
                                console.log(`รอข้อมูล... (พยายามครั้งที่ ${retryCount}/${MAX_RETRIES})`);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        }
                    }

                    if (isAllJobsAssigned()) {
                        showSummary(true);
                        isRunning = false;
                        break;
                    }

                    await new Promise(resolve => setTimeout(resolve, REFRESH_DELAY));
                } else {
                    console.log('ไม่ได้อยู่ที่หน้า Single Hall กำลังนำทาง...');
                    await targetPage.goto(WORKDAY_URL, { waitUntil: 'networkidle0' });
                }
            } else {
                try {
                    const newPage = await browser.newPage();
                    await newPage.goto(WORKDAY_URL, { waitUntil: 'networkidle0' });
                } catch (error) {
                    console.error('ไม่สามารถเปิดแท็บใหม่ได้:', error.message);
                    isRunning = false;
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, ERROR_DELAY));
            }
        }
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการทำงาน:', error.message);
        isRunning = false;
    }
}

// เริ่ม server
app.listen(SERVER_PORT, () => {
    console.log(`Server is running at ${HTTP}://${SERVER_HOST}:${SERVER_PORT}`);
});