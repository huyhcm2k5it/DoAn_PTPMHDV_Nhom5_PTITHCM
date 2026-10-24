# PostgreSQL riêng cho Huy

Init tạo ba DB, ba role owner riêng; các service dùng DSN của mình. Không chia sẻ bảng, không query DB service khác. Catalog là DB owner để chạy migration tạo extension `btree_gist`; khi triển khai thật nên tách migration role và runtime role ít quyền hơn.

Script chỉ chạy lúc volume mới. Thay mật khẩu trong env không tự thay role trên volume đã có. Không chạy `down -v` trên DB đang có dữ liệu cần giữ. Không dùng credentials này cho DB có sẵn trên máy.

Đây là Compose standalone để Huy phát triển, Quân ghép vào stack chung sau. Port DB chỉ bind loopback; DB nội bộ service dùng hostname `postgres-huy`. Password trong DSN phải URL-safe, hoặc được percent-encode đúng trước khi sử dụng.
