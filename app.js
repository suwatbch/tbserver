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
const MAX_RETRIES = 2;      // จำนวนครั้งสูงสุดที่จะลองอ่านซ้ำ

// ตัวแปรควบคุมการทำงาน
let isRunning = false;      // สถานะการทำงานของโปรแกรม
let browser;               // ตัวแปรเก็บ instance ของ browser
let roundCount = 0;        // จำนวนรอบที่ทำงาน
let currentConfig = null;  // ค่า config ปัจจุบัน
let isTestMode = true;     // โหมดทดสอบ (ทำงานแค่รอบเดียว)

//---------Use API--------------------------------------------------------

// API สำหรับเริ่มการทำงาน
app.post('/start', async (req, res) => {
    const { cars, routes, testMode = true } = req.body;
    
    // ตรวจสอบรูปแบบข้อมูล
    if (!cars || !Array.isArray(cars) || !routes || !Array.isArray(routes)) {
        return res.json({ 
            status: 'error', 
            message: 'รูปแบบข้อมูลไม่ถูกต้อง กรุณาระบุ cars เป็น array ของ object และ routes เป็น array ของ string' 
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

// ฟังก์ชันหลักที่ทำงานวนลูป
async function runLoop() {
    try {
        while (isRunning && !isAllJobsAssigned()) {
            // ตรวจสอบการเชื่อมต่อ browser
            if (!browser || !browser.isConnected()) {
                console.error('Browser disconnected, stopping the loop');
                isRunning = false;
                break;
            }

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
                    await targetPage.waitForSelector('table.el-table__body tbody tr', { timeout: 10000 });

                    // อ่านและประมวลผลข้อมูลในตาราง
                    const results = await targetPage.evaluate((config) => {
                        const table = document.querySelector('table.el-table__body');
                        if (!table) return { success: false, message: 'ไม่พบตาราง' };

                        const tbody = table.querySelector('tbody');
                        if (!tbody) return { success: false, message: 'ไม่พบข้อมูลในตาราง' };

                        const rows = tbody.querySelectorAll('tr');
                        if (!rows || rows.length === 0) {
                            console.log('⚠️ ไม่พบข้อมูลในตาราง');
                            return { 
                                success: false, 
                                message: 'ไม่พบแถวข้อมูล',
                                hasNextPage: false,
                                currentPage: '0',
                                totalPages: '0'
                            };
                        }

                        // ตรวจสอบว่ามีข้อมูลที่ต้องการหรือไม่
                        let hasValidData = false;
                        let totalJobs = 0;
                        let validJobs = 0;
                        const actions = [];
                        rows.forEach((row, index) => {
                            const cells = row.querySelectorAll('td');
                            if (cells.length >= 4) {
                                totalJobs++;
                                const route = cells[1].textContent.trim();
                                const carType = cells[3].textContent.trim();

                                if (carType in config.myCars && 
                                    config.routeDirections.includes(route) && 
                                    config.myCars[carType] > 0) {

                                    actions.push({ index, carType, route });
                                    hasValidData = true;
                                    validJobs++;
                                    
                                    // const button = row.querySelector('button span');
                                    // if (button && button.textContent.includes('แข่งขันรับงาน')) {
                                    //     actions.push({ index, carType, route });
                                    //     hasValidData = true;
                                    //     validJobs++;
                                    // }
                                }
                            }
                        });

                        // ตรวจสอบว่ามีปุ่มหน้าถัดไปหรือไม่
                        const nextPageButton = document.querySelector('.btn-next:not([disabled])');
                        const hasNextPage = nextPageButton !== null;
                        
                        // ดึงข้อมูลหน้าปัจจุบันและจำนวนหน้าทั้งหมด
                        const pager = document.querySelector('.el-pager');
                        let currentPage = '1';  // ค่าเริ่มต้นเป็นหน้า 1
                        let totalPages = '1';   // ค่าเริ่มต้นเป็น 1 หน้า
                        
                        if (pager) {
                            // หาหน้าปัจจุบันจาก class active
                            const activePage = pager.querySelector('.number.active');
                            if (activePage) {
                                currentPage = activePage.textContent.trim();
                            }
                            
                            // หาจำนวนหน้าทั้งหมดจากปุ่มตัวเลขทั้งหมด
                            const allNumbers = Array.from(pager.querySelectorAll('.number'));
                            if (allNumbers.length > 0) {
                                const lastNumber = allNumbers[allNumbers.length - 1];
                                totalPages = lastNumber.textContent.trim();
                            }
                        }

                        return { 
                            success: true, 
                            actions,
                            hasNextPage,
                            currentPage,
                            totalPages,
                            hasValidData,
                            totalJobs,
                            validJobs
                        };
                    }, currentConfig);

                    if (results.success) {
                        // แสดงข้อมูลหน้าปัจจุบัน
                        console.log(`\n📄 กำลังอ่านข้อมูลหน้า ${results.currentPage} จากทั้งหมด ${results.totalPages} หน้า`);
                        console.log(`📊 พบงานทั้งหมด ${results.totalJobs} รายการ`);
                        
                        if (results.actions.length > 0) {
                            console.log(`✅ พบงานที่ตรงเงื่อนไข ${results.validJobs} รายการ`);
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
                            console.log(`⚠️ ไม่พบงานที่ตรงเงื่อนไข (${results.validJobs}/${results.totalJobs} รายการ)`);
                        }

                        // ถ้ามีหน้าถัดไป ให้คลิกปุ่มหน้าถัดไป
                        if (results.hasNextPage) {
                            const nextPageNum = parseInt(results.currentPage) + 1;
                            console.log(`⏭️ กำลังเปลี่ยนไปหน้าถัดไป (${nextPageNum}/${results.totalPages})...`);
                            
                            try {
                                // คลิกที่เลขหน้าถัดไปโดยตรง
                                await targetPage.evaluate(async (nextPage) => {
                                    // ค้นหาและคลิกที่เลขหน้าโดยตรง
                                    const pageButtons = document.querySelectorAll('.el-pager li.number');
                                    const nextButton = Array.from(pageButtons).find(btn => btn.textContent.trim() === String(nextPage));
                                    if (nextButton) {
                                        nextButton.click();
                                        return true;
                                    }
                                    
                                    // ถ้าไม่พบเลขหน้า ให้คลิกที่ปุ่ม next
                                    const nextBtn = document.querySelector('.btn-next:not([disabled])');
                                    if (nextBtn) {
                                        nextBtn.click();
                                        return true;
                                    }
                                    return false;
                                }, nextPageNum);

                                // รอให้หน้าเปลี่ยนและข้อมูลโหลดเสร็จ
                                await targetPage.waitForFunction(
                                    (expectedPage) => {
                                        // ตรวจสอบว่าหน้าปัจจุบันตรงกับที่ต้องการ
                                        const activeButton = document.querySelector('.el-pager li.active');
                                        if (!activeButton || activeButton.textContent.trim() !== String(expectedPage)) {
                                            return false;
                                        }
                                        
                                        // ตรวจสอบว่าไม่มี loading mask
                                        const loadingMask = document.querySelector('.el-loading-mask');
                                        if (loadingMask) {
                                            return false;
                                        }
                                        
                                        // ตรวจสอบว่ามีข้อมูลในตาราง
                                        const table = document.querySelector('table.el-table__body tbody');
                                        const rows = table?.querySelectorAll('tr');
                                        return rows && rows.length > 0;
                                    },
                                    { timeout: 10000 },
                                    nextPageNum
                                );

                                // รอเพิ่มเติมเล็กน้อยเพื่อให้แน่ใจว่าข้อมูลโหลดเสร็จสมบูรณ์
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                console.log('✅ เปลี่ยนหน้าและโหลดข้อมูลเสร็จสมบูรณ์');
                            } catch (error) {
                                console.log(`⚠️ เกิดข้อผิดพลาดในการเปลี่ยนหน้า: ${error.message}`);
                                
                                // ถ้าอยู่ในโหมดทดสอบ ให้หยุดทำงาน
                                if (isTestMode) {
                                    console.log('🛑 หยุดการทำงานเนื่องจากเกิดข้อผิดพลาดในโหมดทดสอบ');
                                    isRunning = false;
                                    showSummary(true);
                                    break;
                                }

                                // ลองโหลดหน้าใหม่
                                console.log('🔄 กำลังโหลดหน้าใหม่...');
                                await targetPage.reload({ waitUntil: 'networkidle0' });
                                await new Promise(resolve => setTimeout(resolve, 2000));
                            }
                        } else {
                            console.log('🏁 อ่านข้อมูลครบทุกหน้าแล้ว');
                            if (!results.hasValidData) {
                                console.log('⚠️ ไม่พบงานที่ตรงเงื่อนไขในทุกหน้า');
                                console.log('📊 สรุปงานที่พบ:');
                                console.log(`   - จำนวนงานทั้งหมด: ${results.totalJobs}`);
                                console.log(`   - จำนวนงานที่ตรงเงื่อนไข: ${results.validJobs}`);
                            }
                            
                            // ถ้าอยู่ในโหมดทดสอบ ให้หยุดทำงาน
                            if (isTestMode) {
                                console.log('🛑 หยุดการทำงานเนื่องจากอยู่ในโหมดทดสอบ');
                                isRunning = false;
                                showSummary(true);
                                break;
                            }
                            
                            console.log('🔄 เริ่มรอบใหม่...');
                        }
                    }

                    if (isAllJobsAssigned()) {
                        showSummary(true);
                        isRunning = false;
                        break;
                    }

                    // ถ้าอยู่ในโหมดทดสอบ ให้หยุดทำงานหลังจากทำงานรอบแรกเสร็จ
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