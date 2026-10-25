# Checklist nhận và giao task

Dùng một bản checklist cho từng luồng. Người làm điền bằng chứng; người nhận tự chạy lại và xác nhận trước khi task liên quan chuyển sang Integrated.

## Phiếu bàn giao

```text
Task/luồng:
API hoặc event/command ID:
Commit và PR:
Owner giao:
Owner nhận:
Ngày/version contract:
Schema và sample payload:
Endpoint, exchange/routing key, queue:
Auth, capability và ownership:
Seed ID/dữ liệu giả:
Lệnh chạy/migrate/seed:
Happy path và kết quả mong đợi:
Ca lỗi/retry/duplicate và kết quả mong đợi:
Test đã chạy + exit code/link CI:
CorrelationId đã lược thông tin nhạy cảm:
Ảnh màn hình nếu là UI:
Giới hạn hoặc blocker:
Kết quả người nhận chạy lại:
Review/CI:
Trạng thái: TODO / DOING / BLOCKED / REVIEW / INTEGRATED / DONE
```

## Gate trước khi người nhận xác nhận

- [ ] API/event có schema version và khớp nguồn hợp đồng đã duyệt.
- [ ] Request/response hoặc payload sample có một thành công và một lỗi.
- [ ] Dữ liệu seed là giả và đủ cho người nhận dựng test độc lập.
- [ ] Quyền, actor, ownership, state và lỗi 401/403/409 được chứng minh.
- [ ] Retry cùng key/message không tạo thêm hiệu ứng; payload đổi cùng key bị chặn.
- [ ] Với workflow async: 202/statusUrl, inbox/outbox, restart và trạng thái cuối đã được kiểm.
- [ ] Migration/additive, không sửa dữ liệu dùng chung; lệnh chạy đúng DB/service owner.
- [ ] Người nhận chạy lại bằng source tích hợp, cập nhật commit/CI và xác nhận.
- [ ] Phần chưa ghép có tên owner/nguyên nhân; chưa tự chuyển Done.

## Checklist Huy cần gửi cho từng bên

### Quân

- [ ] CatalogChanged + price snapshot/version và test cũ không đổi khi giá mới.
- [ ] Clinical đọc ticket đúng nguồn và phát VisitSigned/VisitReturnReady.
- [ ] PrescriptionFinalized có revision/items snapshot; Pharmacy replay một lần.
- [ ] W03/W08/W10/W12 export component/route rõ; Quân tích hợp shell/menu/callback.
- [ ] E2E queue→visit; visit không LAB; LAB RETURN và cấp toa đã chạy trên Compose nhóm.

### Hưng

- [ ] API auth/lease claims/issuer/audience được dùng thống nhất và projection quyền có checkpoint.
- [ ] RequestCharge LAB_ORDER, ChargePrepared, ChargePaid/SettlementDecision có fence/revision đúng.
- [ ] UNKNOWN/timeout giữ khóa; FAILED, cancellationId, refundStatus được đối chiếu.
- [ ] W08 lấy bản SIGNED/PUBLISHED qua shared API; Android cùng account thấy cùng trạng thái.
- [ ] Notification chỉ nhận thông tin tối thiểu, dừng Notification không chặn Clinical/Billing.

### Cả nhóm trước khi nộp

- [ ] `develop` có source đã review; CI của commit cuối xanh.
- [ ] Compose dựng sạch, từng DB migrate/seed, health của chín service được xác nhận.
- [ ] Hai luồng có/không LAB, đổi/hủy/hoàn, mẫu lỗi, thiếu quyền và retry/restart có output.
- [ ] Web responsive; Android APK build và demo trên API/Gateway thật.
- [ ] Test evidence, sơ đồ, ma trận truy vết, README và báo cáo cùng commit/version.
- [ ] Release PR sang `main` được người khác review; tag/source/APK khớp nhau.
