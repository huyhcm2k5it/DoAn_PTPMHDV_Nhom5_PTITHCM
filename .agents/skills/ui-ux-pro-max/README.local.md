# UI UX Pro Max — bản dùng chung cho repository

Nguồn: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
Thư mục nguồn: .claude/skills/ui-ux-pro-max (main), tải ngày 2026-11-04.
Giấy phép: MIT, xem LICENSE kèm theo.

Giữ nguyên SKILL.md, scripts/, data/ và references/ từ upstream. Codex nhận skill tại .agents/skills/ui-ux-pro-max trong repository; mở lại chat nếu skill chưa xuất hiện.

Chạy kiểm tra với Python 3:

    python .agents/skills/ui-ux-pro-max/scripts/search.py "keyboard focus forms" --domain ux -n 2

Skill là công cụ hỗ trợ phát triển, không phải dependency runtime của web/backend. Khi có Figma đã chốt, dùng Figma làm chuẩn; kết quả tìm kiếm chỉ hỗ trợ accessibility và cách triển khai. Không đưa cache Python, token hoặc hướng dẫn nhiệm vụ cá nhân vào thư mục này.
