const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const express = require('express');
const app = express();

// เพิ่ม Stealth Plugin
puppeteer.use(StealthPlugin());

// ตัวแปรควบคุม Protocol และ Server
const HTTP = 'http';
const CHROME_DEBUG_URL = `${HTTP}://127.0.0.1:9222`;
const SERVER_PORT = 4000;
const SERVER_HOST = 'localhost';

// ตัวแปรควบคุม URL
const PAGE_URL = 'https://smart.samartcorp.com/login.aspx';

// ฟังก์ชันสำหรับคลิก checkbox
async function clickCheckbox(page) {
    try {
        console.log('เริ่มการตรวจสอบ Turnstile...');
        
        // รอให้ element ที่มี class cf-turnstile ปรากฏ
        await page.waitForSelector('.cf-turnstile', { timeout: 20000 });
        console.log('พบ Turnstile element');

        // คลิกที่ checkbox
        const checkboxClicked = await page.evaluate(() => {
            const checkbox = document.querySelector('.cf-turnstile input[type="checkbox"]');
            if (checkbox) {
                checkbox.click();
                return true;
            }
            return false;
        });

        if (checkboxClicked) {
            console.log('คลิก checkbox สำเร็จ!');
        } else {
            console.log('ไม่พบ checkbox หรือไม่สามารถคลิกได้');
        }

    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการคลิก:', error.message);
        return false;
    }
}

// ฟังก์ชันหลัก
async function run() {
    try {
        console.log('กำลังเชื่อมต่อกับ Chrome...');
        const browser = await puppeteer.connect({
            browserURL: CHROME_DEBUG_URL,
            defaultViewport: null
        });

        // ค้นหาแท็บที่เปิด smart.samartcorp.com อยู่
        const pages = await browser.pages();
        const targetPage = pages.find(page => page.url().includes('smart.samartcorp.com'));

        if (targetPage) {
            console.log('พบแท็บที่เปิดอยู่แล้ว');

            // ฟังก์ชันสำหรับแสดงการแจ้งเตือน
            const showNotification = async () => {
                await targetPage.evaluate(() => {
                    // แสดง alert
                    alert('พบหน้า Login!');
                });
                console.log('แจ้งเตือน: พบหน้า Login!');

                // รอให้ alert ถูกปิด
                await new Promise(resolve => setTimeout(resolve, 1000));

                // เรียกใช้ฟังก์ชันคลิก checkbox
                await clickCheckbox(targetPage);
            };

            // ตรวจสอบ URL ปัจจุบัน
            const currentUrl = targetPage.url();
            if (currentUrl === PAGE_URL) {
                await showNotification();
            }

            // เฝ้าดูการเปลี่ยนแปลง URL
            targetPage.on('framenavigated', async frame => {
                if (frame === targetPage.mainFrame()) {
                    const url = frame.url();
                    if (url === PAGE_URL) {
                        await showNotification();
                    }
                }
            });

            console.log('ติดตั้งระบบตรวจจับเรียบร้อยแล้ว');
        } else {
            console.log('ไม่พบแท็บที่เปิด smart.samartcorp.com');
        }

    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการทำงาน:', error.message);
    }
}

// เริ่มการทำงานทันทีที่รันโปรแกรม
run();

// เริ่ม server
app.listen(SERVER_PORT, () => {
    console.log(`Server is running at ${HTTP}://${SERVER_HOST}:${SERVER_PORT}`);
});