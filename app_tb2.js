const puppeteer = require('puppeteer');
const express = require('express');
const cors = require('cors');
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

const URL_TBBOT = 'http://localhost:3000';
const URL_TURBOROUTE = 'https://th.turboroute.ai/#/login';      

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

// ตัวแปรควบคุมเวลา (มิลลิวินาที)
const REFRESH_DELAY = 500;  // เวลารอก่อนรีเฟรช

// ตัวแปรควบคุมการทำงาน
let isRunning = false;      // สถานะการทำงานของโปรแกรม
let browser;               // ตัวแปรเก็บ instance ของ browser
let roundCount = 0;        // จำนวนรอบที่ทำงาน
let currentConfig = null;  // ค่า config ปัจจุบัน
let isTestMode = true;     // โหมดทดสอบ (ทำงานแค่รอบเดียว)

//---------Use API--------------------------------------------------------

// API สำหรับเริ่มการทำงาน
app.post('/start', async (req, res) => {
    try {
        const { cars, routes, testMode = true } = req.body;
        
        // ตรวจสอบรูปแบบข้อมูล
        if (!cars || !Array.isArray(cars) || !routes || !Array.isArray(routes)) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'รูปแบบข้อมูลไม่ถูกต้อง' 
            });
        }

        if (isRunning) {
            return res.json({ status: 'success', message: 'โปรแกรมกำลังทำงานอยู่แล้ว' });
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
                message: 'ไม่สามารถเชื่อมต่อกับ Chrome ได้ กรุณาเปิด Chrome ด้วย Debug Mode' 
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
        isTestMode = testMode;  // ตั้งค่าโหมดทดสอบ
        runLoop();
        res.json({ 
            status: 'success', 
            message: 'บอทเริ่มการทำงานแล้ว',
            config: {
                cars: carsObject,
                routes: routes,
                testMode: testMode
            }
        });
    } catch (error) {
        console.error('Error in /start endpoint:', error);
        res.status(500).json({
            status: 'error',
            message: 'เกิดข้อผิดพลาดในการเริ่มการทำงาน',
            error: error.message
        });
    }
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

//---------Use API--------------------------------------------------------

// ฟังก์ชันตรวจสอบว่ารับงานครบหรือยัง
function isAllJobsAssigned() {
    if (!currentConfig) return true;
    return Object.values(currentConfig.myCars).every(count => count === 0);
}

function checkJobConditions(job, config) {
    // Debug log เพื่อดูค่าที่ได้รับ
    console.log('Checking job:', {
        type: job.type,
        route: job.route,
        status: job.status,
        config: {
            availableCars: config.myCars[job.type],
            allowedRoutes: config.routeDirections
        }
    });

    // เช็คว่ามีรถว่างพอ
    if (!config.myCars[job.type] || config.myCars[job.type] <= 0) {
        console.log(`❌ ไม่มีรถ ${job.type} ว่าง`);
        return false;
    }
    
    // แก้ไขการตรวจสอบเส้นทาง - ต้องดึงรหัสเส้นทางจาก routeId
    const routeCode = job.routeId.split('-')[0]; // เช่น "PDT" จาก "PDT-7TRA"
    if (!config.routeDirections.some(route => routeCode.includes(route))) {
        console.log(`❌ เส้นทาง ${routeCode} ไม่อยู่ในรายการที่ต้องการ`);
        return false;
    }
    
    // แก้ไขการตรวจสอบสถานะ - ต้องดูว่าเป็น "grab an order"
    if (job.status !== 'grab an order') {
        console.log(`❌ สถานะงานไม่พร้อมรับ (${job.status})`);
        return false;
    }
    
    console.log(`✅ งานผ่านเงื่อนไขทั้งหมด`);
    return true;
}

function displayTableData(tableData, currentPage, totalPages) {
    console.log(`\nหน้าที่ ${currentPage} จาก ${totalPages} หน้า:`);
    
    // ตัวแปรสำหรับเก็บสถิติ
    let validJobs = 0;
    const jobsByType = {};
    const validJobsByType = {};

    // แสดงข้อมูลและตรวจสอบเงื่อนไข
    tableData.forEach((row, index) => {
        // ดึงรหัสเส้นทาง
        const routeCode = row.routeId.split('-')[0];
        
        const isValid = checkJobConditions(row, currentConfig);
        const status = isValid ? '✅' : '❌';
        
        // นับจำนวนงานทั้งหมดตามประเภทรถ
        jobsByType[row.type] = (jobsByType[row.type] || 0) + 1;
        
        // ถ้างานผ่านเงื่อนไข
        if (isValid) {
            validJobs++;
            validJobsByType[row.type] = (validJobsByType[row.type] || 0) + 1;
        }

        // แสดงข้อมูลพร้อมสถานะการตรวจสอบ
        console.log(
            `${index + 1}. ${status} ${row.routeId} | ${row.type} | ${routeCode} | ` +
            `${row.distance} | ${row.startTime} | ${row.duration} | ` +
            `${row.endTime} | ${row.amount} | ${row.status}`
        );

        // แสดงรายละเอียดการตรวจสอบ
        console.log(`   🔍 การตรวจสอบ:`);
        console.log(`      • รถ ${row.type}: ${currentConfig.myCars[row.type] > 0 ? '✅ มีรถว่าง' : '❌ ไม่มีรถว่าง'}`);
        console.log(`      • เส้นทาง ${routeCode}: ${currentConfig.routeDirections.some(r => routeCode.includes(r)) ? '✅ อยู่ในรายการ' : '❌ ไม่อยู่ในรายการ'}`);
        console.log(`      • สถานะ: ${row.status === 'grab an order' ? '✅ พร้อมรับงาน' : '❌ ไม่พร้อมรับงาน'}`);
    });

    // สรุปข้อมูลหน้าปัจจุบัน
    console.log(`\n📊 สรุปหน้า ${currentPage}:`);
    console.log(`   - พบงานทั้งหมด ${tableData.length} รายการ`);
    console.log(`   - งานที่สามารถรับได้ ${validJobs} รายการ`);
    
    // แสดงสรุปตามประเภทรถ
    console.log('\n📈 แยกตามประเภทรถ:');
    Object.entries(jobsByType).forEach(([type, count]) => {
        const validCount = validJobsByType[type] || 0;
        console.log(`   - ${type}:`);
        console.log(`     • งานทั้งหมด: ${count} งาน`);
        console.log(`     • งานที่รับได้: ${validCount} งาน`);
        if (currentConfig.myCars[type] > 0) {
            console.log(`     • รถว่าง: ${currentConfig.myCars[type]} คัน`);
        }
    });
    
    console.log('\n-----------------------------------------------');
}

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
                    console.log(`\n🔄 รอบที่ ${roundCount}:`);
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

                        // แสดงข้อมูลตาราง
                        displayTableData(tableData, currentPage, totalPages);

                        if (currentPage < totalPages) {
                            const nextPage = currentPage + 1;
                            await targetPage.evaluate((page) => {
                                const pageButtons = document.querySelectorAll('.el-pager li.number');
                                const nextButton = Array.from(pageButtons).find(btn => btn.textContent.trim() === String(page));
                                if (nextButton) nextButton.click();
                            }, nextPage);
                            
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
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

                    // สรุปผลรวมทั้งรอบ
                    console.log('\n📋 สรุปผลรวมรอบที่', roundCount);
                    console.log(`   - จำนวนหน้าทั้งหมด: ${totalPages}`);
                    
                    // แสดงสรุปผลการรับงาน
                    showSummary(isTestMode);

                    // ถ้าอยู่ในโหมดทดสอบและทำงานครบ 1 รอบ
                    if (isTestMode && roundCount >= 1) {
                        console.log('🛑 หยุดการทำงานเนื่องจากอยู่ในโหมดทดสอบ');
                        isRunning = false;
                        showSummary(true);
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
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการทำงาน:', error.message);
        isRunning = false;
    }
}

//---------Use Chome--------------------------------------------------------

// เพิ่มฟังก์ชันตรวจสอบสถานะ Chrome Debug Mode
async function checkChromeDebugMode() {
    try {
        const browser = await puppeteer.connect({
            browserURL: CHROME_DEBUG_URL,
            defaultViewport: null
        });
        
        await browser.disconnect();
        return {
            status: true,
            message: 'Chrome กำลังทำงานใน Debug Mode'
        };
    } catch (error) {
        return {
            status: false,
            message: 'กรุณาเปิด Chrome ด้วย Debug Mode'
        };
    }
}

// เพิ่ม API endpoint สำหรับตรวจสอบ Chrome Debug Mode
app.get('/check-chrome', async (req, res) => {
    const status = await checkChromeDebugMode();
    res.json(status);
});

// เพิ่มฟังก์ชันสำหรับเปิด Chrome ด้วย Debug Mode
async function openChromeWithDebug(urls = []) {
    try {
        const browser = await puppeteer.launch({
            headless: false,
            args: [
                '--remote-debugging-port=9222',
                urls[0] 
            ],
            defaultViewport: null
        });

        // รอให้ Chrome พร้อมใช้งาน
        await new Promise(resolve => setTimeout(resolve, 2000));

        // เปิด URL ที่เหลือในแท็บใหม่ (เริ่มจากตัวที่ 2)
        for (let i = 1; i < urls.length; i++) {
            const page = await browser.newPage();
            await page.goto(urls[i], { waitUntil: 'networkidle0' });
        }

        return {
            status: true,
            message: `เปิด Chrome และ URL ทั้งหมด ${urls.length} รายการสำเร็จ`,
            openedUrls: urls
        };
    } catch (error) {
        console.log("Failed to open Chrome:", error.message);
        return {
            status: false,
            message: 'ไม่สามารถเปิด Chrome ได้',
            error: error.message
        };
    }
}

// เพิ่ม API endpoint สำหรับเปิด Chrome พร้อม URL
app.post('/open-chrome', async (req, res) => {
    const { urls } = req.body;

    // ตรวจสอบรูปแบบข้อมูล
    if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({
            status: 'error',
            message: 'กรุณาระบุ urls เป็น array ของ URL'
        });
    }

    // ตรวจสอบความถูกต้องของ URL
    const validUrls = urls.filter(url => {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    });

    if (validUrls.length === 0) {
        return res.status(400).json({
            status: 'error',
            message: 'ไม่พบ URL ที่ถูกต้อง'
        });
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const result = await openChromeWithDebug(validUrls);
    res.json(result);
});

// ฟังก์ชันสำหรับหยุดการทำงาน
async function stop() {
    if (!isRunning) {
        return { status: 'already_stopped', message: 'โปรแกรมหยุดทำงานอยู่แล้ว' };
    }
    
    isRunning = false;
    
    // Cleanup browser resources
    if (browser) {
        try {
            await browser.disconnect();
            browser = null;
        } catch (error) {
            console.error('Error disconnecting browser:', error.message);
        }
    }
    
    return { status: 'stopped', message: 'หยุดการทำงานแล้ว' };
}

// ฟังก์ชันสำหรับปิด Chrome ทั้งหมด
async function closeAllChrome() {
    try {
        // ใช้คำสั่งระบบในการปิด Chrome ทั้งหมด
        if (process.platform === 'win32') {
            // สำหรับ Windows
            require('child_process').execSync('taskkill /F /IM chrome.exe');
        } else {
            // สำหรับ macOS และ Linux
            require('child_process').execSync('pkill -f chrome');
        }
        
        return {
            status: true,
            message: 'สั่งปิด Chrome ทั้งหมดแล้ว'
        };
    } catch (error) {
        return {
            status: false,
            message: 'เกิดข้อผิดพลาดในการปิด Chrome',
            error: error.message
        };
    }
}

// API endpoint สำหรับปิด Chrome ทั้งหมด
app.get('/close-chrome', async (req, res) => {
    // เรียกใช้ฟังก์ชัน stop เพื่อหยุดการทำงาน
    const stopResult = await stop();

    // ปิด Chrome ทั้งหมด
    const closeResult = await closeAllChrome();

    if (closeResult.status) {
        // เปิด Chrome พร้อม URL ใหม่
        const openResult = await openChromeWithDebug([
            URL_TBBOT,
            URL_TURBOROUTE
        ]);
        res.json(openResult);
    } else {
        res.json({ stopResult, closeResult });
    }
});

//---------UseChome--------------------------------------------------------

// เริ่ม server
app.listen(SERVER_PORT, () => {
    console.log(`Server is running at ${HTTP}://${SERVER_HOST}:${SERVER_PORT}`);
});