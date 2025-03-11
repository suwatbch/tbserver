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
const TARGET_URL = 'https://smart.samartcorp.com/login.aspx';

// ฟังก์ชันสำหรับ delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ฟังก์ชันสำหรับคลิก checkbox
async function clickCheckbox(page) {
    try {
        console.log('เริ่มการตรวจสอบ Turnstile...');
        
        // รอให้ element ที่มี class cf-turnstile ปรากฏ
        await page.waitForSelector('.cf-turnstile', { timeout: 10000 });
        console.log('พบ Turnstile element');

        // หาตำแหน่งของ element
        const element = await page.$('.cf-turnstile');
        const box = await element.boundingBox();
        
        if (!box) {
            console.log('ไม่สามารถหาตำแหน่งของ element ได้');
            return false;
        }

        console.log('ตำแหน่ง element:', box);

        // คลิกที่ตำแหน่งกลางของ element
        const centerX = box.x + (box.width / 2);
        const centerY = box.y + (box.height / 2);

        // เพิ่มการเคลื่อนไหวของเมาส์แบบธรรมชาติ
        await page.mouse.move(centerX - 100, centerY - 100, { steps: 10 });
        await delay(300);
        await page.mouse.move(centerX, centerY, { steps: 10 });
        await delay(500);
        
        console.log('กำลังคลิกที่พิกัด:', centerX, centerY);
        await page.mouse.click(centerX, centerY);
        
        // รอและตรวจสอบผล
        await delay(2000);
        
        // ตรวจสอบว่าผ่านการยืนยันหรือไม่
        const success = await page.evaluate(() => {
            const turnstile = document.querySelector('.cf-turnstile');
            return turnstile && turnstile.getAttribute('data-callback-executed') === 'true';
        });

        if (success) {
            console.log('การยืนยันตัวตนสำเร็จ');
            return true;
        } else {
            console.log('การยืนยันตัวตนไม่สำเร็จ');
            return false;
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
            if (currentUrl === TARGET_URL) {
                await showNotification();
            }

            // เฝ้าดูการเปลี่ยนแปลง URL
            targetPage.on('framenavigated', async frame => {
                if (frame === targetPage.mainFrame()) {
                    const url = frame.url();
                    if (url === TARGET_URL) {
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