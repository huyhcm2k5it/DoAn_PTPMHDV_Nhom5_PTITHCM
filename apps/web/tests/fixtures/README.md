# Dữ liệu giả để kiểm thử màn hình Huy

`huy-demo.json` chứa sáu tình huống độc lập: khám thường, chờ lấy mẫu sau thu phí LAB, kết quả chờ duyệt, khám quay lại sau LAB, bệnh án/toa đã ký và hủy LAB đang chờ hoàn tiền.

Tất cả tên người, bệnh án, kết quả và toa trong file đều là dữ liệu mô phỏng. File không chứa JWT, mật khẩu đăng nhập hoặc cấu hình DB. `actors` chỉ là định danh và quyền dùng trong test, không phải tài khoản đã tạo trên Identity.

Các ID được liên kết từ Patient → Appointment/ticket → Clinical visit/note/prescription → Diagnostic order/specimen/result. Số tiền LAB được tính từ danh mục giả; snapshot đơn vị/tham chiếu giữ nguyên theo chỉ định. Trạng thái kết quả và hoàn tiền tách biệt với trạng thái đơn.

File chỉ được đọc trong test/preview được bật rõ ràng. Ứng dụng chính tiếp tục gọi Gateway thật; không fallback sang file khi API lỗi. Không import file vào production feature, seed DB hoặc phát RabbitMQ event từ các giá trị này.

`huy-demo-data.test.ts` kiểm tra các liên kết và quy tắc trạng thái. Không dùng các giá trị mô phỏng làm hướng dẫn điều trị hoặc kết quả y khoa.
