const puppeteer = require('puppeteer');
const express = require('express');
const cors = require('cors');
const app = express();
const axios = require('axios');

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

const URL_TBBOT = 'http://127.0.0.1:3000';
const URL_TURBOROUTE = 'https://th.turboroute.ai/#/login';  

// ตัวแปรควบคุม Protocol
const HTTP = 'http';                                            // Protocol สำหรับ HTTP
const HTTPS = 'https';                                          // Protocol สำหรับ HTTPS

// ตัวแปรควบคุม Server
const SERVER_PORT = 4000;                                       // พอร์ตที่ใช้สำหรับ Express server
const SERVER_HOST = '127.0.0.1';                                // host ที่ใช้สำหรับ Express server
const CHROME_DEBUG_URL = `${HTTP}://127.0.0.1:9222`;            // URL สำหรับเชื่อมต่อกับ Chrome debugger

// ตัวแปรควบคุม URL และชื่อเว็บ
const BASE_URL = `${HTTPS}://th.turboroute.ai`;                 // URL หลักของเว็บไซต์
const WORKDAY_URL = `${BASE_URL}/#/grab-single/single-hall`;    // URL ของหน้า single-hall

// ตัวแปรควบคุมการทำงาน
let isRunning = false;                                          // สถานะการทำงานของโปรแกรม
let browser;                                                    // ตัวแปรเก็บ instance ของ browser
let roundCount = 0;                                             // จำนวนรอบที่ทำงานไปแล้ว
let currentRoundJobs = {};                                      // เพิ่มตัวแปรสำหรับเก็บงานในแต่ละรอบ

//---------Use API--------------------------------------------------------

// API สำหรับเริ่มการทำงาน

// API สำหรับเริ่มการทำงาน
app.post('/start', async (req, res) => {
    try {
        const { cars, routes } = req.body;
        
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
        runLoop();
        res.json({ 
            status: 'success', 
            message: 'บอทเริ่มการทำงานแล้ว',
            config: {
                cars: carsObject,
                routes: routes
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
        console.log('โปรแกรมหยุดทำงานอยู่แล้ว');
        return res.json({ status: 'already_stopped', message: 'โปรแกรมหยุดทำงานอยู่แล้ว' });
    }
    isRunning = false;
    console.log('หยุดการทำงานแล้ว');
    res.json({ status: 'stopped', message: 'หยุดการทำงานแล้ว' });
});

// API สำหรับเช็คสถานะ
app.get('/status', (req, res) => {
    try {
        const now = new Date().toLocaleString('th-TH');
        
        // ถ้าไม่มี currentConfig หรือไม่มี myCars
        if (!currentConfig || !currentConfig.myCars || !currentConfig.assignedRoutes) {
            console.log(isRunning ? 'โปรแกรมกำลังทำงานอยู่' : 'โปรแกรมหยุดทำงาน');
            return res.json({
                status: isRunning ? 'running' : 'stopped',
                currentRound: roundCount,
                timestamp: now,
                message: isRunning ? 'โปรแกรมกำลังทำงานอยู่' : 'โปรแกรมหยุดทำงาน',
                details: {
                    availableCars: ['ยังไม่มีการกำหนดรถ'],
                    acceptedJobs: ['ยังไม่มีการรับงาน']
                }
            });
        }

        // เตรียมข้อมูลรถว่าง
        const availableCars = Object.entries(currentConfig.myCars)
            .filter(([_, count]) => count > 0)
            .map(([type, count]) => `${type} จำนวน ${count} คัน`);

        // เตรียมข้อมูลงานที่รับแล้ว
        const acceptedJobs = Object.entries(currentConfig.assignedRoutes)
            .filter(([_, routes]) => routes.length > 0)
            .map(([type, routes]) => `${type} จำนวน ${routes.length} คัน เส้นทาง: ${routes.join(', ')}`);

        res.json({
            status: isRunning ? 'running' : 'stopped',
            currentRound: roundCount,
            timestamp: now,
            message: isRunning ? 'โปรแกรมกำลังทำงานอยู่' : 'โปรแกรมหยุดทำงาน',
            details: {
                availableCars: availableCars.length > 0 ? availableCars : ['ไม่มีรถว่าง'],
                acceptedJobs: acceptedJobs.length > 0 ? acceptedJobs : ['ยังไม่มีงานที่รับ']
            }
        });
    } catch (error) {
        console.log('โปรแกรมหยุดทำงาน');
        // ถ้าเกิด error ให้ส่งค่าเริ่มต้นกลับไป
        res.status(500).json({
            status: 'error',
            currentRound: 0,
            message: 'โปรแกรมหยุดทำงาน',
            error: error.message
        });
    }
});

// API สำหรับ Solve Cloudflare Turnstile captcha
app.get('/solver-captcha', async (req, res) => {
    try {
        const CAPSOLVER_API_KEY = "CAP-ED680824D056174AB0DDCCAA707A8DCEA48BBF5EB00D87851109F7DE6C0E7A48";
        const PAGE_URL = URL_TURBOROUTE;
        const WEBSITE_KEY = "0x4AAAAAAAdPI4avBnC7RBvD";
        
        // สร้าง task
        const taskId = await solvecf(PAGE_URL, WEBSITE_KEY, null, null, CAPSOLVER_API_KEY);
        
        if (!taskId) {
            return res.status(400).json({
                status: 'error',
                message: 'ไม่สามารถสร้าง task ได้'
            });
        }
        
        // รอผลลัพธ์
        const solution = await solutionGet(taskId, CAPSOLVER_API_KEY);
        
        if (solution) {
            console.log("Solution:", solution);
            return res.json({
                status: 'success',
                solution: solution
            });
        } else {
            return res.status(408).json({
                status: 'error',
                message: 'ไม่พบผลลัพธ์หรือหมดเวลารอ'
            });
        }
    } catch (error) {
        console.error('Error in solve-captcha endpoint:', error);
        res.status(500).json({
            status: 'error',
            message: 'เกิดข้อผิดพลาดในการแก้ captcha',
            error: error.message
        });
    }
});

// ฟังก์ชันสำหรับส่ง request ไปยัง Capsolver API เพื่อสร้าง task
async function solvecf(pageUrl, websiteKey, metadata_action = null, metadata_cdata = null, apiKey) {
    try {
        const url = "https://api.capsolver.com/createTask";
        const task = {
            "type": "AntiTurnstileTaskProxyLess",
            "websiteURL": pageUrl,
            "websiteKey": websiteKey,
        };
        
        // เพิ่ม metadata ถ้ามีการกำหนด
        if (metadata_action || metadata_cdata) {
            task.metadata = {};
            if (metadata_action) {
                task.metadata.action = metadata_action;
            }
            if (metadata_cdata) {
                task.metadata.cdata = metadata_cdata;
            }
        }
        
        const data = {
            "clientKey": apiKey,
            "task": task
        };
        
        const response = await axios.post(url, data);
        const responseData = response.data;
        // console.log("Response จาก createTask:", responseData);
        
        if (responseData.errorId !== 0) {
            console.log("เกิดข้อผิดพลาดในการสร้าง task:", responseData.errorDescription);
            return null;
        }
        
        return responseData.taskId;
    } catch (error) {
        console.error("Error creating task:", error.message);
        return null;
    }
}

// ฟังก์ชันสำหรับตรวจสอบผลลัพธ์ของ task
async function solutionGet(taskId, apiKey, timeout = 120) {
    const url = "https://api.capsolver.com/getTaskResult";
    const startTime = Date.now();
    
    while (true) {
        try {
            const data = { "clientKey": apiKey, "taskId": taskId };
            const response = await axios.post(url, data);
            const responseData = response.data;
            
            const status = responseData.status || '';
            
            if (status === "ready") {
                return responseData.solution;
            }
            
            if ((Date.now() - startTime) / 1000 > timeout) {
                console.log("หมดเวลารอผลลัพธ์ (Timeout)");
                return null;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error("Error getting solution:", error.message);
            return null;
        }
    }
}

//---------Use API--------------------------------------------------------

// ฟังก์ชันสำหรับอ่านจำนวนหน้าทั้งหมด
async function getTotalPages(page) {
    return await page.evaluate(() => {
        const allNumberElements = document.querySelectorAll('.el-pager li.number');
        return parseInt(allNumberElements[allNumberElements.length - 1]?.textContent || '1');
    });
}

// ฟังก์ชันตรวจสอบหน้าปัจจุบัน
async function getCurrentPage(page) {
    return await page.evaluate(() => {
        const activeButton = document.querySelector('.el-pager li.active');
        return activeButton ? parseInt(activeButton.textContent.trim()) : 1;
    });
}

async function acceptJob(page, row) {
    try {
        // คลิกปุ่ม "แข่งขันรับงาน" ในแถวนั้นๆ
        const clickResult = await page.evaluate((rowElement) => {
            try {
                const acceptButton = rowElement.querySelector('span.grab-single');
                if (acceptButton) {
                    acceptButton.click();
                    return true;
                }
                return false;
            } catch (err) {
                return false;
            }
        }, row);

        if (!clickResult) {
            console.log('ไม่พบปุ่มรับงานหรือไม่สามารถคลิกได้');
            return false;
        }

        try {
            // รอให้ popup แสดงขึ้นมา
            await page.waitForSelector('.el-dialog__wrapper[flag="true"]', {
                visible: true,
                timeout: 2000
            });

            try {
                // รอจนกว่าค่าใน input จะถูกตั้งค่า
                await page.waitForFunction(() => {
                    const input = document.querySelector('input[name="cf-turnstile-response"]');
                    return input && input.value && input.value.trim() !== '';
                }, { timeout: 3000 });

            } catch (error) {
                console.log('การยืนยันตัวตนไม่สำเร็จภายในเวลาที่กำหนด');
                // ยิงไปที่ /solver-captcha
                const solverCaptcha = await axios.get(getSelfUrl('/solver-captcha'));
                
                // ตรวจสอบว่า status เป็น success หรือไม่
                if (solverCaptcha.data && solverCaptcha.data.status === 'success') {
                    // console.log('สามารถแก้ captcha ได้สำเร็จ!');
                    
                    // เข้าถึงค่า token จาก response
                    const token = solverCaptcha.data.solution.token;
                    
                    // หา input element และใส่ค่า token
                    const inputSet = await page.evaluate((tokenValue) => {
                        const input = document.querySelector('input[name="cf-turnstile-response"]');
                        if (input) {
                            input.value = tokenValue;
                            const event = new Event('change', { bubbles: true });
                            input.dispatchEvent(event);
                            console.log('Event change dispatched');
                            return true;
                        }
                        return false;
                    }, token);

                    if (inputSet) {
                        console.log('ใส่ token ลงใน input สำเร็จ!');
                    } else {
                        console.log('ไม่พบ input element สำหรับใส่ token');
                    }

                } else {
                    console.log('ไม่สามารถแก้ captcha ได้');
                    return false;
                }
            }
            
            // รอให้ปุ่มยืนยันแข่งขันรับงานพร้อมใช้งาน
            await page.waitForFunction(() => {
                const button = document.querySelector('.el-dialog__footer button');
                return button && !button.hasAttribute('disabled');
            }, { timeout: 5000 });
            console.log('ยืนยันตัวตนแล้ว');

            // คลิกปุ่มยืนยัน
            // const buttonClicked = await page.evaluate(() => {
            //     const button = document.querySelector('.el-dialog__footer button');
            //     if (button && !button.hasAttribute('disabled')) {
            //         button.click();
            //         return true;
            //     }
            //     return false;
            // });
            
            // if (buttonClicked) {
            //     console.log('คลิกปุ่มยืนยันแข่งขันรับงานสำเร็จ!');
            // } else {
            //     console.log('ไม่สามารถคลิกปุ่มยืนยันได้');
            // }
            
            return true;

        } catch (error) {
            console.log('เกิดข้อผิดพลาดระหว่างรอ Popup:', error.message);
            return false;
        }

    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการรับงาน:', error.message);
        return false;
    }
}

async function checkJobConditions(job, config, page, rowElement) {
    if (!job || !config) return false;

    const hasMatchingType = job.route in config.myCars; 
    const hasMatchingRoute = config.routeDirections.includes(job.routeId);

    if (hasMatchingType && hasMatchingRoute) {
        const car_count = config.myCars[job.route];
        if (car_count > 0) {
            // ส่ง page และ row element ไปให้ acceptJob
            const accept = await acceptJob(page, rowElement);
            if (accept) {
                config.assignedCars[job.route]++;
                config.assignedRoutes[job.route].push(job.routeId);
                config.myCars[job.route]--;
                return true;
            }

            // หยุดการทำงานของโปรแกรม
            isRunning = false;
            console.log('โปรแกรมหยุดทำงานแล้ว');

        }
    }
    return false;
}

async function displayTableData(tableData, currentPage, totalPages, page) {
    // ถ้าเป็นหน้าแรกของรอบใหม่ ให้เคลียร์ข้อมูลงานของรอบก่อนหน้า
    if (currentPage === 1) {
        currentRoundJobs = {};
    }

    console.log(`\nรอบที่ ${roundCount + 1}: -> หน้าที่ ${currentPage} จาก ${totalPages} หน้า:`);

    // แก้ไขการใช้ forEach เป็น for...of เพื่อให้รองรับ async/await
    for (const [index, row] of tableData.entries()) {
        const rowElement = await page.evaluateHandle((index) => {
            return document.querySelectorAll('table.el-table__body tbody tr')[index];
        }, index);
        
        const isAccepted = await checkJobConditions(row, currentConfig, page, rowElement);
        if (isAccepted) {
            if (!currentRoundJobs[row.route]) {
                currentRoundJobs[row.route] = [];
            }
            currentRoundJobs[row.route].push(row.routeId);
        }
        
        await rowElement.dispose();
    }

    // สรุปข้อมูลหน้าปัจจุบัน
    console.log(`📊 สรุปหน้า ${currentPage}:`);
    console.log("🚗 รถว่าง:");
    Object.entries(currentConfig.myCars).forEach(([carType, count]) => {
        if (count > 0) {
            console.log(`   - ${carType} จำนวน ${count} คัน`);
        }
    });

    console.log("\n✅ รับงานในหน้านี้:");
    if (Object.keys(currentRoundJobs).length > 0) {
        Object.entries(currentRoundJobs).forEach(([carType, routes]) => {
            console.log(`   - ${carType} จำนวน ${routes.length} คัน 🛣️ เส้นทาง: ${routes.join(', ')}`);
        });
    }
    
    // หยุดการทำงานเมื่อไม่มีรถว่างทุกประเภท
    let hasAvailableCars = false;
    Object.values(currentConfig.myCars).forEach(count => {
        if (count > 0) {
            hasAvailableCars = true;
        }
    });

    // หยุดการทำงานเมื่อไม่มีรถว่างทุกประเภท
    if (!hasAvailableCars) {
        console.log('\n-----------------------------------------------');
        console.log('🚫 ไม่มีรถว่างทุกประเภทแล้ว จึงหยุดการทำงาน');
        console.log('-----------------------------------------------');
        isRunning = false;
        showSummary(true);
    } else {
        console.log('\n-----------------------------------------------');
    }
}

// ฟังก์ชันแสดงสรุปผล
function showSummary(isEnd = false) {  // เพิ่ม parameter สำหรับควบคุมการแสดงผล
    if (!currentConfig) return;

    const now = new Date().toLocaleString('th-TH');
    console.log(`\n📅 ${isEnd ? 'ผลสรุปสุดท้าย' : 'สรุปผลรายรอบ'}: ${now}`);
    console.log("✅ รับงาน:");
    Object.entries(currentConfig.assignedRoutes).forEach(([carType, routes]) => {
        if (routes.length > 0) {
            console.log(`   - ${carType} จำนวน ${routes.length} คัน 🛣️ เส้นทาง: ${routes.join(', ')}`);
        }
    });
    console.log("\n***------------------- END -------------------***");
}

// ฟังก์ชันหลักที่ทำงานวนลูป
async function runLoop() {
    try {
        if (!browser) {
            console.log('กำลังเชื่อมต่อกับ Turbo Route...');
            browser = await puppeteer.connect({
                browserURL: CHROME_DEBUG_URL,
                defaultViewport: null
            });
        }

        while (isRunning) {
            const pages = await browser.pages();
            const targetPages = pages.filter(page => page.url().includes(BASE_URL));

            if (targetPages.length > 0) {
                const targetPage = targetPages[0];
                const currentUrl = await targetPage.url();
                
                if (currentUrl === WORKDAY_URL) {
                    await targetPage.reload({ waitUntil: 'networkidle0' });
                    
                    // รอให้ตารางและ pagination พร้อม
                    await targetPage.waitForSelector('table.el-table__body tbody tr', { timeout: 5000 });
                    await targetPage.waitForSelector('.el-pagination .el-pager li.number', { timeout: 5000 });

                    let currentPage = 1;
                    
                    while (currentPage <= await getTotalPages(targetPage) && isRunning) {
                        try {
                            // ตรวจสอบหน้าปัจจุบัน
                            const actualPage = await getCurrentPage(targetPage);
                            if (actualPage !== currentPage) {
                                console.log(`ตรวจพบการเปลี่ยนหน้าอัตโนมัติ เริ่มอ่านใหม่จากหน้าแรก...`);
                                currentPage = 1; // รีเซ็ตกลับไปหน้าแรก
                                continue; // ข้ามการทำงานรอบนี้ กลับไปเริ่มลูปใหม่
                            }

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

                            await displayTableData(tableData, currentPage, await getTotalPages(targetPage), targetPage);
                            
                            
                            // ถ้ายังไม่ถึงหน้าสุดท้าย ให้กดปุ่มหน้าถัดไป
                            if (currentPage < await getTotalPages(targetPage)) {
                                const nextPage = currentPage + 1;
                                await targetPage.evaluate((page) => {
                                    const pageButtons = document.querySelectorAll('.el-pager li.number');
                                    const nextButton = Array.from(pageButtons).find(btn => btn.textContent.trim() === String(page));
                                    if (nextButton) nextButton.click();
                                }, nextPage);
                                
                                // รอให้ข้อมูลในตารางเปลี่ยน
                                await new Promise(resolve => setTimeout(resolve, 500));
                            }
                            currentPage++;

                        } catch (error) {
                            console.log('เกิดข้อผิดพลาดในการอ่านข้อมูล เริ่มอ่านใหม่จากหน้าแรก:', error.message);
                            currentPage = 1; // รีเซ็ตกลับไปหน้าแรก
                            continue;
                        }
                    }

                    if (isRunning) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                        roundCount++;
                        
                        // เพิ่มการแสดงสรุปผลรายรอบ
                        const now = new Date().toLocaleString('th-TH');
                        console.log(`\n📊 สรุปผลรอบที่ ${roundCount}: ${now}`);
                        console.log("🚗 รถว่าง:");
                        Object.entries(currentConfig.myCars).forEach(([carType, count]) => {
                            if (count > 0) {
                                console.log(`   - ${carType} จำนวน ${count} คัน`);
                            }
                        });

                        console.log("\n✅ รับงาน:");
                        Object.entries(currentRoundJobs).forEach(([carType, routes]) => {
                            if (routes.length > 0) {
                                console.log(`   - ${carType} จำนวน ${routes.length} คัน 🛣️ เส้นทาง: ${routes.join(', ')}`);
                            }
                        });
                        console.log('\n-----------------------------------------------');
                        
                        // เคลียร์ข้อมูลงานของรอบนี้
                        currentRoundJobs = {};
                    }

                } else {
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
                    console.error('ไม่สามารถเปิดแท็บใหม่ได้:', error.message);
                    isRunning = false;
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการทำงานกับ Turbo Route:', error.message);
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
    console.log('check-chrome');
    res.json(status);
});

// เพิ่มฟังก์ชันสำหรับเปิด Chrome ด้วย Debug Mode
async function openChromeWithDebug(urls = []) {
    try {
        const { execSync } = require('child_process');
        
        // สร้างคำสั่งตามระบบปฏิบัติการ
        const command = process.platform === 'win32'
            ? `start chrome --remote-debugging-port=9222 ${urls[0]}`
            : `google-chrome --remote-debugging-port=9222 ${urls[0]}`;

        // รันคำสั่งเปิด Chrome
        execSync(command);

        // รอให้ Chrome พร้อมใช้งาน
        await new Promise(resolve => setTimeout(resolve, 1000));

        // เชื่อมต่อกับ Chrome ที่เปิดไว้
        const browser = await puppeteer.connect({
            browserURL: CHROME_DEBUG_URL,
            defaultViewport: null
        });

        // เปิด URL ที่เหลือในแท็บใหม่ (เริ่มจากตัวที่ 2)
        for (let i = 1; i < urls.length; i++) {
            const page = await browser.newPage();
            await page.goto(urls[i], { waitUntil: 'networkidle0' });
        }

        // ตัด connection เพื่อให้ Chrome ทำงานอิสระ
        await browser.disconnect();

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

    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const result = await openChromeWithDebug(validUrls);
    res.json(result);
});

// ฟังก์ชันสำหรับหยุดการทำงาน
async function stop() {
    if (!isRunning) {
        return { status: 'already_stopped', message: 'โปรแกรมหยุดทำงานอยู่แล้ว' };
    }
    
    isRunning = false;
    
    // แสดงผลสรุปสุดท้าย
    showSummary(true);
    
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

// เพิ่มฟังก์ชันสำหรับสร้าง URL ของตัวเอง
function getSelfUrl(path) {
    return `${HTTP}://${SERVER_HOST}:${SERVER_PORT}${path}`;
}

// เริ่ม server
app.listen(SERVER_PORT, () => {
    console.log(`Server is running at ${HTTP}://${SERVER_HOST}:${SERVER_PORT}`);
});