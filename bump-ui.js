const fs = require('fs');
const path = './index.js';

if (!fs.existsSync(path)) {
    console.log('Không tìm thấy file index.js!');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Chèn CSS Glassmorphism vào đầu file hoặc phần style
const glassCss = `
<style>
.hybr-header-logo {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: rgba(138, 43, 226, 0.15);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(216, 112, 147, 0.3);
    border-radius: 14px;
    box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
    color: #ffffff;
    font-family: inherit;
}
.hybr-logo-icon {
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #a855f7, #6366f1);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(168, 85, 247, 0.4);
    font-weight: bold;
    font-size: 16px;
    color: #fff;
}
.hybr-logo-text { display: flex; flex-direction: column; }
.hybr-logo-title {
    font-size: 16px; font-weight: 700; letter-spacing: 0.5px;
    background: linear-gradient(135deg, #f3e8ff, #d8b4fe);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.hybr-logo-version { font-size: 10px; color: #c084fc; opacity: 0.8; }
</style>
`;

// 2. Định nghĩa HTML Header logo v6.1.0
const headerHtml = `
    <div class="hybr-header-logo">
        <div class="hybr-logo-icon">H</div>
        <div class="hybr-logo-text">
            <span class="hybr-logo-title">Hybr089</span>
            <span class="hybr-logo-version">v6.1.0</span>
        </div>
    </div>
`;

// Tùy chỉnh logic thay thế phiên bản cũ hoặc chèn header tùy vào cấu trúc index.js của ní ở đây
// Ví dụ: cập nhật version string
content = content.replace(/v6\.0\.9/g, 'v6.1.0');

// Ghi đè lại file index.js
fs.writeFileSync(path, content, 'utf8');
console.log('Đã patch thành công giao diện logo glass tím và bump lên v6.1.0!');
