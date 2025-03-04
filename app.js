const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

app.get("/fetch-table", async (req, res) => {
    let browser;
    try {
        console.log("Launching browser...");
        browser = await puppeteer.launch({
            headless: false
        });

        console.log("Opening new page...");
        const page = await browser.newPage();

        console.log("Navigating to the URL...");
        await page.goto("https://leave.swmaxnet.com", { waitUntil: "networkidle2" });

        console.log("Searching for the text...");
        const found = await page.evaluate(() => {
            const textToFind = 'https://leave.swmaxnet.com';
            const bodyText = document.body.innerText;
            if (bodyText.includes(textToFind)) {
                alert('พบข้อความแล้ว!');
                return true;
            }
            return false;
        });

        if (found) {
            console.log("Text found!");
            res.json({ success: true, message: 'พบข้อความแล้ว!' });
        } else {
            console.log("Text not found.");
            res.json({ success: false, message: 'ไม่พบข้อความ' });
        }
    } catch (error) {
        console.error("An error occurred:", error.message);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        if (browser) {
            console.log("Closing browser...");
            await browser.close(); // ปิดเบราว์เซอร์
        }
    }
});

// 📌 เริ่มต้นเซิร์ฟเวอร์
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));