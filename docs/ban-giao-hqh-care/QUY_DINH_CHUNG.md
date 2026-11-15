# Quy định chung cho Huy Quân Hưng

Đây là bản tóm tắt để tra nhanh, phản ánh quy định GitHub ngày 24/10/2026. Khi cần chi tiết thao tác, dùng [bản quy định đầy đủ](../QUY_DINH_GITHUB_NHOM5_HUY_QUAN_HUNG_20261024.md). Tài liệu quy định không tự tạo quyền, nhánh, CODEOWNERS, PR hoặc bảo vệ nhánh trên GitHub.

## Nhận việc và giới hạn file

- Task/issue phải ghi owner, mục tiêu, API hoặc màn hình, file/phạm vi, đầu vào từ ai, điều kiện đúng/lỗi, test và tiêu chí hoàn thành.
- Mỗi người có tối đa hai issue đang code. Trước khi sửa file chung, hỏi owner ở nhóm và ghi người sẽ tích hợp cuối.
- Giữ code theo owner ở [bảng phân công](PHAM_VI_VA_DAU_MOI.md). Không sửa DB/migration của người khác.
- Client chỉ gọi `/api/v1` qua Envoy. Service owner xác minh capability, ownership, trạng thái và quyền trên tài nguyên; Gateway không thay thế kiểm tra tại backend.
- HTTP liên service không tạo chuỗi đồng bộ. Workflow dài dùng message, transaction cục bộ, outbox/inbox và trả `202 + statusUrl` khi thao tác còn chờ.
- Retry giữ cùng Idempotency-Key và nội dung của cùng ý định; key cũ với nội dung khác phải conflict. Consumer dedupe message ID và business ID.
- Không dùng mock, cache, UI hoặc HTTP gọi chéo để chứng minh đã thanh toán, đã ký, đã lấy mẫu, đã hoàn tiền hay đã cấp phát.
- Dùng dữ liệu giả. Không commit `.env`, token, OTP, private key, thông tin bệnh nhân thật, `.runtime`, `node_modules`, output build hoặc log nhạy cảm.

## Git và review

- Nhánh dài hạn: `main` là bản nộp ổn định; `develop` là nhánh tích hợp; mỗi thành viên làm trên nhánh riêng `huy`, `quan`, `hung`.
- PR task: nhánh cá nhân → `develop`. Không push trực tiếp/force-push `main`/`develop`; không reset đè thay đổi của người khác.
- PR có một mục đích rõ, gắn issue, mô tả trước/sau, files/contracts/migration/env bị ảnh hưởng, test đã chạy và phần còn chờ. UI đính kèm ảnh khi hữu ích.
- Review chéo: Quân review PR Huy; Huy review PR Quân/Hưng; nếu reviewer chính là tác giả hoặc vắng thì thành viên còn lại review. Đổi contract có consumer liên quan review.
- Huy điều phối merge sau review và CI; tác giả không tự duyệt PR của mình. Chỉ đổi người merge khi đã bàn giao rõ.
- Sau khi nhập `develop`, owner kiểm kết quả tích hợp. Gỡ conflict bằng hiểu biết từng đoạn; không chọn cả file ours/theirs chỉ để Git hết báo lỗi.
- Migration đã áp dụng không sửa/xóa; thêm version mới. Một service được build/test/migrate độc lập.
- PR release `develop → main` chỉ sau khi dựng Compose sạch, seed, E2E, build web/APK và review. Gắn tag/bản nộp đúng commit.

## Definition of Done

Một task chỉ Done khi code khớp contract, kiểm quyền/validation/lỗi/idempotency, có migration/seed/test/log cần thiết, reviewer khác kiểm, CI đúng commit xanh và bằng chứng đã được cập nhật.

Web/Android phải dùng dữ liệu qua Gateway, có loading/empty/401/403/409/pending/lỗi mạng và không hard-code thành công. Message/workflow phải chứng minh duplicate, restart, timeout/retry và state cuối đúng trong DB owner. Luồng chưa ghép được ghi **local complete / integration pending**, không ghi Done toàn luồng.

## Khi có lỗi hoặc blocker

- CI đỏ: tác giả sửa; không tắt test để xanh.
- Lỗi sau merge: Huy điều phối, owner service sửa bằng commit/PR mới hoặc nhóm thống nhất revert; không rewrite lịch sử nhánh chung.
- Push rejected: fetch, đọc log, tích hợp commit remote và chạy lại test; không force-push.
- Blocker quá một ngày làm việc: tạo issue ghi owner phụ thuộc và dữ liệu/hợp đồng còn thiếu. Tiếp tục làm phần độc lập, không tạo fake success cho demo.

## Tài liệu nền thay đổi theo thời gian

Lịch/phân công Word ngày 19/10 là nguồn về phạm vi và kế hoạch, nhưng quy trình Git trong đó đã cũ. Quy tắc nhánh cá nhân, PR vào `develop`, PR `develop → main` và review phải theo bản GitHub ngày 24/10. Trước release, nhóm cập nhật lại một nguồn chuẩn nếu quyết định mới khác hai bản này.
