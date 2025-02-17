const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const users = [
    { id: 1, name: "John Doe", email: "john@example.com", username: "john", password: "1" },
    { id: 2, name: "Jane Doe", email: "jane@example.com", username: "jane", password: "1"  }
];

// 📌 ดึงข้อมูลผู้ใช้ทั้งหมด
app.get('/users', (req, res) => {
    res.json(users);
});

// 📌 ดึงข้อมูลผู้ใช้คนเดียว ตาม ID
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(404).json({ message: "Invalid username or password" });
    res.json(user);
});

// 📌 เริ่มต้นเซิร์ฟเวอร์
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));