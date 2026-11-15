# Bàn giao Quân — chuẩn bị tuần 5 và bản nộp — 07/11/2026

Đã triển khai phần kiểm thử/công cụ có thể thực hiện tại máy local trên nhánh quan.
Chưa hoàn tất nghiệm thu toàn dự án, feature freeze, diễn tập ngày 21/11 hoặc release ngày 22–23/11.
Bảng 24 task và phần còn thiếu: [quan-week4-5-status.csv](quan-week4-5-status.csv).
Code revision: b2ae85d, 7e8dc23, 264d4bb, 7a4fb70; chưa push.
Phiếu contract/routing/auth/seed: [tuần 4](quan-week4-pharmacy.md).

## Đã xác minh

- 20 bệnh nhân tranh slot cuối: đúng một hold thành công.
  20 toa tranh viên cuối: đúng một reservation, không âm/oversell.
- Transaction rollback dòng thuốc thứ hai; lỗi audit ghi receipt làm rollback stock và receipt.
  Unique hold/rx-revision/dispense cùng idempotency ngăn double effect.
- Rehold giữ id tăng attempt; race release/expiry trả reserved một lần.
  Hai người dispense đồng thời chỉ tạo một record và giảm tồn một lần.
- Settlement mismatch source/fence/amount, UNKNOWN, FAILED trước reserve,
  late prepared sau expiry, retry/replay và conflicting FAILED sau PAID đã có regression.
  Chưa đủ ma trận refund FAILED→retry→SUCCEEDED/late bank payment của Billing live.
- Query planner cho slot, queue và inventory dùng index business hiện có.
  Đây là sample query plan, chưa là benchmark quy mô dữ liệu thực tế.
- Outbox mandatory return giữ pending; retry sau confirm giữ message ID.
  Retry_jobs phục hồi logic từ DB, quarantine nguyên tử, content conflict không thay job gốc.
  Restart/kill broker-Mongo vật lý chưa được thực nghiệm.
- Migration additive không drop data/index; active legacy hold thiếu attempt được chặn để owner review.
  Inventory seed chạy lại không reset onHand/reserved đã thay đổi.
- Lease RSA thật trong API tests: action/sub/version/expiry/lifetime; patient owner DTO,
  revocation và web retry/polling abort. Doctor/LAB và full Identity/browser refresh còn chờ owner.

Local suite cuối exit 0: Mongo 94/94; Node 11/11 (1 Patient + 8 Appointment + 2 Pharmacy);
web 13/13 và production build/typecheck qua. Xem log local trong bàn giao tuần 4.
Không dùng số test local làm bằng chứng CI, clean clone hoặc nine-service E2E.

## Công cụ và quy trình nhận

| Mục                    | Artifact / lệnh                                       | Trạng thái                                                        |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| Cài và cấu hình        | infra/compose/README.md; tools/quan/prepare-stack.ps1 | Đã viết, cần clean clone receiver                                 |
| Full local checks      | tools/quan/verify-local.ps1                           | PASS exit 0                                                       |
| Readiness chín service | tools/quan/check-stack.ps1                            | NOT RUN, cần Docker engine/owner env                              |
| CI                     | .github/workflows/quan-node.yml                       | Đã thêm Pharmacy/full Mongo/real RabbitMQ job; chưa có run remote |
| E2E hai hành trình     | tests/e2e/gate4-pharmacy.md                           | Prepared, NOT RUN                                                 |
| Quyền                  | tests/e2e/access-matrix.md                            | Auto subset pass, live owner subset pending                       |
| Recovery               | tests/e2e/recovery.md                                 | Auto subset pass, crash-point matrix pending                      |
| NFR đọc                | tools/quan/measure-read.js                            | Runner 100 GET/30 concurrent, NOT MEASURED                        |
| Source archive         | tools/quan/package-release.ps1                        | Archive HEAD + SHA256; không tạo tag/push                         |
| Bảo vệ                 | local quan-defense-notes.md                           | Notes prepared; group rehearsal NOT DONE                          |

NFR phải đo đúng SRS: p95 read <2s/30 concurrent, cache hit >=80%/100 GET,
100-message projection p95<5s và recovery<=60s; web 360/768/1440.
Runner hiện chỉ đo read latency/error; các metric cache/projection/recovery và screenshot cần evidence riêng.

## Checklist trước release

- [ ] Huy/Hưng chạy lại receiver actual wire, chốt contract và không còn bug P0/P1.
- [ ] Docker image build, Envoy binary validation, 9 health và hai hành trình trên clean seed thật.
- [ ] Refund/recollect/RETURN, unassigned doctor, lease revocation trong partition, Android/Web đồng bộ.
- [ ] CI đúng commit cuối xanh; ghi URL run/PR, code owner review; feature freeze theo lịch.
- [ ] Diễn tập 21/11 có một success và một failure/recovery với correlationId đã lược nhạy cảm.
- [ ] Mỗi owner backup DB và chứng minh restore trên DB mới; không export secret/token/bệnh án thật vào Git.
- [ ] Hưng build APK, ghi commit/version/checksum; source, docs và APK cùng bản khóa.
- [ ] Huy điều phối PR develop→main/tag sau review; Quân không tự push main/develop.
- [ ] Tạo archive local khi working tree sạch; kiểm SHA256, giải nén và clean setup từ artifact.
- [ ] Receiver ghi ngày/kết quả/chữ ký trước khi chuyển DONE và nộp 22–23/11.

## Phiếu receiver release

```text
Task: Q4-11 / Q5-03..09
Owner giao: Quân
Owner nhận: Huy / Hưng
Source commit:
PR / CI run URL:
Docker versions / images:
Nine-service readiness evidence:
Gate4 no-LAB / LAB / failure evidence:
NFR environment/workload/results:
Database backup and restore evidence per owner:
APK commit/version/SHA256:
Source archive SHA256:
Known issues + owner:
Receiver clean-clone rerun:
Review / rehearsal date:
Final status: BLOCKED / REVIEW / INTEGRATED / DONE
```

Hiện các ô chưa có bằng chứng được giữ pending; không điền kết quả giả hoặc ký thay thành viên khác.
