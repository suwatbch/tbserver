const puppeteer = require('puppeteer');
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

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

// ตัวแปรควบคุมข้อความแสดงผล
const MESSAGES = {
    ALREADY_RUNNING: 'โปรแกรมกำลังทำงานอยู่แล้ว',
    ALREADY_STOPPED: 'โปรแกรมหยุดทำงานอยู่แล้ว',
    STARTED: 'เริ่มการทำงานแล้ว',
    STOPPED: 'หยุดการทำงานแล้ว',
    RUNNING: 'โปรแกรมกำลังทำงานอยู่',
    STOPPED_STATUS: 'โปรแกรมหยุดทำงาน',
    CONNECTING: 'กำลังเชื่อมต่อกับ Chrome...',
    NOT_ON_WORKDAY: 'ไม่ได้อยู่ที่หน้า Single Hall กำลังนำทาง...',
    CANNOT_OPEN_TAB: 'ไม่สามารถเปิดแท็บใหม่ได้:',
    ERROR: 'เกิดข้อผิดพลาดในการทำงาน:',
    SERVER_RUNNING: `Server is running at ${HTTP}://${SERVER_HOST}:${SERVER_PORT}`,
    INVALID_CONFIG: 'กรุณาระบุข้อมูลรถและเส้นทางให้ถูกต้อง'
};

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

// ฟังก์ชันตรวจสอบการเชื่อมต่อ Chrome
async function checkChromeConnection() {
    try {
        browser = await puppeteer.connect({
            browserURL: CHROME_DEBUG_URL,
            defaultViewport: null
        });
        return true;
    } catch (error) {
        console.error('ไม่สามารถเชื่อมต่อกับ Chrome ได้:', error.message);
        return false;
    }
}

// API สำหรับเริ่มการทำงาน
app.post('/start', async (req, res) => {
    let { cars, routes } = req.body;
    
    // กำหนดค่าเริ่มต้นถ้าไม่มีข้อมูลส่งมา
    if (!cars || Object.keys(cars).length === 0) {
        cars = { "4WJ": 1 };
    }
    if (!routes || routes.length === 0) {
        routes = ["CT1-EA2"];
    }

    if (isRunning) {
        return res.json({ status: 'already_running', message: MESSAGES.ALREADY_RUNNING });
    }

    // ตรวจสอบการเชื่อมต่อ Chrome
    const isConnected = await checkChromeConnection();
    if (!isConnected) {
        return res.json({ 
            status: 'error', 
            message: 'ไม่สามารถเชื่อมต่อกับ Chrome ได้ กรุณาตรวจสอบว่า Chrome เปิดอยู่ในโหมด debug' 
        });
    }

    // เก็บค่า config ปัจจุบัน
    currentConfig = {
        myCars: { ...cars },
        routeDirections: [...routes],
        assignedCars: Object.fromEntries(Object.keys(cars).map(key => [key, 0])),
        assignedRoutes: Object.fromEntries(Object.keys(cars).map(key => [key, []]))
    };

    isRunning = true;
    roundCount = 0;
    runLoop();
    res.json({ 
        status: 'started', 
        message: MESSAGES.STARTED,
        config: {
            cars: cars,
            routes: routes
        }
    });
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
    const status = {
        status: isRunning ? 'running' : 'stopped',
        currentRound: roundCount,
        message: isRunning ? MESSAGES.RUNNING : MESSAGES.STOPPED_STATUS
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
                                    // ตรวจสอบสถานะปุ่มก่อนคลิก
                                    const isButtonClickable = await targetPage.evaluate((rowIndex) => {
                                        const rows = document.querySelectorAll('table.el-table__body tbody tr');
                                        const button = rows[rowIndex].querySelector('button');
                                        return button && !button.disabled && button.style.display !== 'none';
                                    }, action.index);

                                    if (!isButtonClickable) {
                                        console.log(`❌ ปุ่มไม่พร้อมใช้งาน: ${action.carType} เส้นทาง ${action.route}`);
                                        continue;
                                    }

                                    // // คลิกปุ่มแข่งขันรับงาน
                                    // await targetPage.evaluate((rowIndex) => {
                                    //     const rows = document.querySelectorAll('table.el-table__body tbody tr');
                                    //     const button = rows[rowIndex].querySelector('button');
                                    //     if (button) button.click();
                                    // }, action.index);

                                    // // รอป๊อปอัพและคลิกยืนยัน
                                    // await targetPage.waitForSelector('.el-dialog__wrapper', { timeout: 5000 });
                                    // await targetPage.waitForTimeout(500);

                                    // const isConfirmButtonClickable = await targetPage.evaluate(() => {
                                    //     // ค้นหาปุ่มเฉพาะในป๊อปอัพ
                                    //     const popup = document.querySelector('.el-dialog__wrapper:not([style*="display: none"])');
                                    //     if (!popup) return false;

                                    //     // ค้นหาปุ่มที่มีข้อความ "แข่งขันรับงาน"
                                    //     const confirmButton = popup.querySelector('button span[data-v-406ad98a]');
                                    //     return confirmButton && 
                                    //            confirmButton.textContent.includes('แข่งขันรับงาน') && 
                                    //            !confirmButton.closest('button').disabled;
                                    // });

                                    // if (!isConfirmButtonClickable) {
                                    //     console.log(`❌ ปุ่มยืนยันไม่พร้อมใช้งาน: ${action.carType} เส้นทาง ${action.route}`);
                                    //     continue;
                                    // }

                                    // await targetPage.evaluate(() => {
                                    //     const popup = document.querySelector('.el-dialog__wrapper:not([style*="display: none"])');
                                    //     if (popup) {
                                    //         // คลิกปุ่มที่มีข้อความ "แข่งขันรับงาน"
                                    //         const confirmButton = popup.querySelector('button span[data-v-406ad98a]');
                                    //         if (confirmButton && confirmButton.textContent.includes('แข่งขันรับงาน')) {
                                    //             confirmButton.closest('button').click();
                                    //         }
                                    //     }
                                    // });

                                    // อัพเดทสถานะ
                                    currentConfig.myCars[action.carType]--;
                                    currentConfig.assignedCars[action.carType]++;
                                    currentConfig.assignedRoutes[action.carType].push(action.route);

                                    console.log(`✅ รับงานสำเร็จ: ${action.carType} เส้นทาง ${action.route}`);
                                    await targetPage.waitForTimeout(500);
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
                                await targetPage.waitForTimeout(1000);
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
                    console.log(MESSAGES.NOT_ON_WORKDAY);
                    await targetPage.goto(WORKDAY_URL, { waitUntil: 'networkidle0' });
                }
            } else {
                try {
                    const newPage = await browser.newPage();
                    await newPage.goto(WORKDAY_URL, { waitUntil: 'networkidle0' });
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