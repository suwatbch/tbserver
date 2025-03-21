const puppeteer = require('puppeteer');
const express = require('express');
const cors = require('cors');
const app = express();
const axios = require('axios');
const path = require('path');
const fs = require('fs');

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

const screenshotsDir = path.join(__dirname, 'screenshots');

// ตรวจสอบว่าโฟลเดอร์มีอยู่จริงหรือไม่
if (!fs.existsSync(screenshotsDir)) {
    try {
        fs.mkdirSync(screenshotsDir, { recursive: true });
        console.log('สร้างโฟลเดอร์ screenshots สำเร็จ');
    } catch (err) {
        console.error('ไม่สามารถสร้างโฟลเดอร์ screenshots:', err.message);
    }
}

//---------Use API--------------------------------------------------------

app.get('/run-test', async (req, res) => {
    let browser;
    let page;

    try {
        console.log('--> เริ่มทดสอบล็อกอิน');

        const cars = [{ type: '4Wj', quantity: 1 }];
        const routes = ['CT1-EA2'];

        const carsObject = cars.reduce((acc, car) => {
            acc[car.type] = car.quantity;
            return acc;
        }, {});

        const currentConfig = {
            myCars: carsObject,
            routeDirections: routes,
            assignedCars: Object.fromEntries(Object.keys(carsObject).map(key => [key, 0])),
            assignedRoutes: Object.fromEntries(Object.keys(carsObject).map(key => [key, []]))
        };
        
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        page = await browser.newPage();
        await page.setDefaultNavigationTimeout(10000);
        
        await page.goto('https://th.turboroute.ai/#/login');
        await page.waitForSelector('form.login-form', { visible: true });
        
        await page.type('input[name="account"]', '0955294478');
        await page.type('input[name="password"]', 'FleetSPT@2468');
        await page.click('button.el-button--primary.el-button--medium');
        await page.screenshot({ path: path.join(screenshotsDir, '1_login_form.png') });
        
        await page.waitForNavigation({ waitUntil: 'networkidle0' });
        await page.screenshot({ path: path.join(screenshotsDir, '2_home_form.png') });
        console.log('--> เข้าสู่หน้าหลัก');

        await page.waitForSelector('a[href="#/grab-single/single-hall"]', { visible: true });
        await page.click('a[href="#/grab-single/single-hall"]');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
            page.waitForSelector('table.el-table__body', { visible: true })
        ]);
        await page.screenshot({ path: path.join(screenshotsDir, '3_single_hall.png') });
        console.log('--> เข้าสู่หน้างานสำเร็จ');

        const clickResult = await page.evaluate(() => {
            try {
                const firstRow = document.querySelector('table.el-table__body tbody tr');
                const acceptButton = firstRow.querySelector('span.grab-single');
                if (acceptButton) {
                    acceptButton.click();
                    return true;
                }
                return false;
            } catch (err) {
                return false;
            }
        });

        if (clickResult) {
            console.log('--> คลิกปุ่มแข่งขันรับงานสำเร็จ');
            await page.waitForSelector('.el-dialog__wrapper[flag="true"]', { visible: true, timeout: 5000 });
            await new Promise(resolve => setTimeout(resolve, 4000));
            await page.screenshot({ path: path.join(screenshotsDir, '4_open_dialog.png') });

            try {
                // await page.waitForSelector('input[name="cf-turnstile-response"]', { visible: true });
                await page.waitForSelector('#verify-container', { visible: true, timeout: 5000 });
                
                console.log('--> รอการยืนยันตัวตน');
                const verificationStatus = await page.evaluate(() => {
                    const turnstileInput = document.querySelector('input[name="cf-turnstile-response"]');
                    const hasResponse = turnstileInput && turnstileInput.value !== '';
                    const checkbox = document.querySelector('.cf-turnstile iframe');
                    const isChecked = checkbox && checkbox.getAttribute('data-checked') === 'true';
                    return {hasResponse, isChecked};
                });
                console.log('--> ตรวจสอบสถานะการยืนยันตัวตนเสร็จสิ้น');

                if (verificationStatus.hasResponse && verificationStatus.isChecked) {
                    console.log('✅ การยืนยันตัวตนสำเร็จแล้ว');
                } else {
                    console.log('⚠️ ยังไม่ได้ยืนยันตัวตน');
                    if (!verificationStatus.hasResponse) {
                        console.log('- ยังไม่มีการตอบสนองจาก Turnstile');
                    }
                    if (!verificationStatus.isChecked) {
                        console.log('- ยังไม่ได้กดเช็กบ็อกซ์');
                    }

                    const solverCaptcha = await axios.get(getSelfUrl('/solver-captcha'));
                    if (solverCaptcha.data && solverCaptcha.data.status === 'success') {
                        const token = solverCaptcha.data.solution.token;
                        
                        const setToken = await page.evaluate((tokenValue) => {
                            try {
                                const input = document.querySelector('input[name="cf-turnstile-response"]');
                                if (!input) return false;

                                input.value = tokenValue;
                                
                                const events = ['input', 'change', 'blur'];
                                events.forEach(eventType => {
                                    input.dispatchEvent(new Event(eventType, { bubbles: true }));
                                });

                                return input.value === tokenValue;
                            } catch (err) {
                                console.error('Error:', err);
                                return false;
                            }
                        }, token);

                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await page.screenshot({ path: path.join(screenshotsDir, '5_set_token.png') });

                        if (setToken) {
                            console.log('--> เซ็ต token สำเร็จ');
                            
                            const verifyStatus = await page.evaluate(() => {
                                const button = document.querySelector('.el-dialog__footer button');
                                const turnstileResponse = document.querySelector('input[name="cf-turnstile-response"]');
                                return {
                                    buttonEnabled: button && !button.hasAttribute('disabled'),
                                    hasToken: turnstileResponse && turnstileResponse.value !== '',
                                    tokenValue: turnstileResponse ? turnstileResponse.value : 'ไม่พบค่า'
                                };
                            });

                            console.log('สถานะการยืนยัน:', {
                                'ปุ่มพร้อมใช้งาน': verifyStatus.buttonEnabled,
                                'มี Token': verifyStatus.hasToken,
                                'ค่า Token': verifyStatus.tokenValue.substring(0, 30) + '...'
                            });

                            await new Promise(resolve => setTimeout(resolve, 4000));
                            await page.screenshot({ path: path.join(screenshotsDir, '6_view_status.png') });
                        } else {
                            console.log('ไม่สามารถเซ็ต token ได้');
                        }

                    } else {
                        console.log('ไม่สามารถแก้ captcha ได้');
                    }
                }

            } catch (error) {
                console.error('เกิดข้อผิดพลาดในการตรวจสอบการยืนยันตัวตน:', error.message);
            }

        } else {
            console.log('ไม่พบปุ่มรับงานหรือไม่สามารถคลิกได้');
        }
        res.json({ status: 'success', message: 'สำเร็จ'});

    } catch (error) {
        console.error('error -->:', error);
        res.status(500).json({
            status: 'error',
            message: 'ล้มเหลว',
            error: error.message
        });
    } finally {
        if (browser) {
            await browser.close();
            console.log('ปิด browser');
        }
    }
});

// API สำหรับตรวจสอบโครงสร้างหน้าเว็บ
app.get('/check-structure', async (req, res) => {
    let browser;
    let page;

    try {
        console.log('เริ่มตรวจสอบโครงสร้างหน้าเว็บ');
        
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        page = await browser.newPage();
        
        // เพิ่ม event listener สำหรับ console.log จากหน้าเว็บ
        page.on('console', msg => console.log('Browser Log:', msg.text()));
        
        console.log('กำลังโหลดหน้าเว็บ...');
        const response = await page.goto('https://th.turboroute.ai/#/login', {
            waitUntil: 'networkidle0'
        });
        
        console.log('สถานะการโหลดหน้าเว็บ:', response.status());

        // ตรวจสอบโครงสร้างหน้าเว็บอย่างละเอียด
        const pageDetails = await page.evaluate(() => {
            const getElementDetails = (element) => {
                if (!element) return null;
                const computedStyle = window.getComputedStyle(element);
                return {
                    tagName: element.tagName.toLowerCase(),
                    id: element.id,
                    className: element.className,
                    type: element.type,
                    name: element.name,
                    value: element.value,
                    placeholder: element.placeholder,
                    required: element.required,
                    disabled: element.disabled,
                    visible: computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden',
                    position: {
                        x: element.offsetLeft,
                        y: element.offsetTop
                    },
                    size: {
                        width: element.offsetWidth,
                        height: element.offsetHeight
                    }
                };
            };

            // ตรวจสอบฟอร์มล็อกอิน
            const loginForm = document.querySelector('form');
            const formDetails = loginForm ? {
                ...getElementDetails(loginForm),
                action: loginForm.action,
                method: loginForm.method,
                enctype: loginForm.enctype
            } : null;

            // ตรวจสอบ input fields
            const inputs = Array.from(document.querySelectorAll('input')).map(input => ({
                ...getElementDetails(input),
                parentElement: {
                    className: input.parentElement?.className,
                    tagName: input.parentElement?.tagName.toLowerCase()
                }
            }));

            // ตรวจสอบปุ่มทั้งหมด
            const buttons = Array.from(document.querySelectorAll('button')).map(button => ({
                ...getElementDetails(button),
                text: button.textContent.trim(),
                parentElement: {
                    className: button.parentElement?.className,
                    tagName: button.parentElement?.tagName.toLowerCase()
                }
            }));

            // ตรวจสอบ error message containers
            const possibleErrorContainers = Array.from(document.querySelectorAll('.el-message-box, .el-message, .error-message')).map(container => ({
                ...getElementDetails(container),
                text: container.textContent.trim()
            }));

            // ตรวจสอบ loading indicators
            const loadingElements = Array.from(document.querySelectorAll('.loading, .el-loading, .spinner')).map(element => ({
                ...getElementDetails(element),
                text: element.textContent.trim()
            }));

            return {
                title: document.title,
                url: window.location.href,
                form: formDetails,
                inputs,
                buttons,
                errorContainers: possibleErrorContainers,
                loadingIndicators: loadingElements,
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight
                }
            };
        });

        // บันทึกภาพหน้าจอ
        const screenshotPath = path.join(screenshotsDir, `structure_check_${Date.now()}.png`);
        await page.screenshot({ 
            path: screenshotPath,
            fullPage: true
        });

        // สรุปข้อมูลสำคัญ
        const summary = {
            inputFields: pageDetails.inputs.length,
            buttons: pageDetails.buttons.length,
            hasLoginForm: !!pageDetails.form,
            foundElements: {
                usernameField: pageDetails.inputs.some(input => input.name === 'account'),
                passwordField: pageDetails.inputs.some(input => input.name === 'password'),
                loginButton: pageDetails.buttons.some(btn => btn.text.includes('เข้าสู่ระบบ'))
            }
        };

        console.log('\nสรุปโครงสร้างหน้าเว็บ:', JSON.stringify(summary, null, 2));

        res.json({
            status: 'success',
            message: 'ตรวจสอบโครงสร้างหน้าเว็บเสร็จสิ้น',
            summary,
            details: pageDetails,
            screenshot: path.basename(screenshotPath)
        });

    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการตรวจสอบ:', error);
        res.status(500).json({
            status: 'error',
            message: 'เกิดข้อผิดพลาดในการตรวจสอบโครงสร้างหน้าเว็บ',
            error: error.message
        });
    } finally {
        if (browser) {
            await browser.close();
            console.log('ปิด browser');
        }
    }
});

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
            // บันทึกภาพหน้าจอเมื่อคลิกปุ่มรับงานแล้ว
            await page.screenshot({ path: path.join(screenshotsDir, '1_after_click_accept.png') });
            
            // รอให้ popup แสดงขึ้นมา
            await page.waitForSelector('.el-dialog__wrapper[flag="true"]', {
                visible: true,
                timeout: 2000
            });
            
            await new Promise(resolve => setTimeout(resolve, 4000));

            // บันทึกภาพหน้าจอเมื่อ popup แสดงขึ้นมา
            await page.screenshot({ path: path.join(screenshotsDir, '2_popup_appeared.png') });

            await page.waitForSelector('input[name="cf-turnstile-response"]', { visible: true });

            await page.click('input[name="cf-turnstile-response"]'); 
            await page.focus('input[name="cf-turnstile-response"]'); 

            // Check if the input is focused
            const isInputFocused = await page.evaluate(() => {
                const input = document.querySelector('input[name="cf-turnstile-response"]');
                return input === document.activeElement;
            });

            if (isInputFocused) {
                console.log('Input is focused');
            } else {
                console.log('Input is not focused');
            }

            return true;

        } catch (error) {
            console.error('เกิดข้อผิดพลาดระหว่างรอ Popup:', error.message);
            // บันทึกภาพหน้าจอเมื่อเกิดข้อผิดพลาด
            await page.screenshot({ path: path.join(screenshotsDir, 'error_' + Date.now() + '.png') });
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