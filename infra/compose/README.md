# Stack chung UMC Care — bàn giao tuần 4–5

Bản cấu hình đã qua Compose structural validation. Chưa xác nhận build image/9 health hoặc E2E live
trên máy hiện tại vì Docker engine không chạy. Cấu hình Go API/worker/migrate đã ghép vào cùng private network.

## Chuẩn bị trên máy local

1. Cài dependencies theo lockfile: npm ci ở services/patient, services/appointment, services/pharmacy,
   tests/mongo và apps/web. Node theo CI là 24.14.0.
2. Chạy từ repository root:
   `powershell -NoProfile -ExecutionPolicy Bypass -File tools/quan/prepare-stack.ps1`.
   Script tạo biến còn thiếu và giữ giá trị hiện có; không rotate mật khẩu DB/volume đang dùng.
3. Hưng chuẩn bị services/identity/.env, services/billing/.env và services/notification/.env
   theo .env.example của từng owner: DB host postgres, broker host rabbitmq và đúng vhost/credentials.
   Đối chiếu infra/compose/postgres/hung/init.sql; không dùng mật khẩu placeholder để nghiệm thu.
4. Đặt public key Identity thật vào infra/certs/jwt_public.pem và chạy
   `node tools/quan/prepare-gateway-key.js`. Envoy cần JWKS JSON, không đọc PEM như JWKS.
   Private key chỉ ở owner Identity, không commit.
5. .env root có UMC_AMQP_URL, các Mongo owner URI và năm secret Go/Redis.
   Dùng mật khẩu URL-safe. Giá trị phải khớp user đã khởi tạo trong volume cũ;
   init scripts không tự thay mật khẩu DB cũ.
6. Với broker cũ, xem migration quorum trong tests/e2e/recovery.md trước khi bật worker mới.
   RabbitMQ definitions là artifact import; Compose không tự import hoặc tự cấp ACL producer.
   Owner broker import definitions vào vhost /umc-care và kiểm ACL publish/consume/declare theo ownership.

## Dựng và kiểm tra

```powershell
docker compose --env-file .env -f infra/compose/compose.yaml config --quiet
docker compose --env-file .env -f infra/compose/compose.yaml up -d --build
powershell -File tools/quan/check-stack.ps1
powershell -File tools/quan/verify-local.ps1
```

Mongo bootstrap tạo replica/user trước Node API. Go migrations chạy trước Go API/worker.
Publisher/expiry/reconcile chạy trong worker riêng; chỉ bật API không làm outbox tự drain.
Gateway chỉ public port 8080; Postgres của Huy và Redis ở private network.
Postgres của Hưng hiện còn bind localhost:5432 theo baseline, cần owner review trước môi trường ngoài máy local.
Health thành công chỉ chứng minh dependency sẵn sàng, không chứng minh hành trình nghiệp vụ.

## Pharmacy migration và seed

Trong container pharmacy, MONGODB_URI đã chọn pharmacy_db:

```powershell
docker compose --env-file .env -f infra/compose/compose.yaml exec -T pharmacy node scripts/migrate-storage.js
docker compose --env-file .env -f infra/compose/compose.yaml exec -T pharmacy node scripts/migrate-storage.js --apply
docker compose --env-file .env -f infra/compose/compose.yaml exec -T pharmacy node scripts/seed-demo.js --dry-run
docker compose --env-file .env -f infra/compose/compose.yaml exec -T pharmacy node scripts/seed-demo.js
```

Migration mặc định chỉ report; active legacy hold thiếu attemptNo phải được owner đối soát.
Seed insert-only tồn 30 cho medicine 00000000-0000-4000-8000-000000000301; chạy lại không reset lượng đã dùng.
Đây là seed kho, chưa đủ hành trình E2E: Catalog medicine/price, Identity access, Patient access và
Clinical FINAL phải do owner thật phát. Không seed PAID/COMMITTED để làm evidence.
Không có lệnh reset dữ liệu shared. Thử clean clone trên project/volume mới, giữ project cũ.

## Snapshot FIRST/RETURN giao Clinical

Dùng owner Appointment, cấu hình MONGODB_URI chỉ appointment_db:
`node services/appointment/scripts/export-clinical-tickets.js --date=2026-11-07`.
Output local .runtime/exports, tối đa 1000 ticket/ngày; thiếu mapping bác sĩ/visit thì fail closed.
Không ghi đè output đã có. Huy review/import theo contracts/messages/clinical-ticket-snapshot.v1.schema.json.
Đây là operator snapshot tạm, không phải public event, chưa tự cấp Clinical visit grants.

## Gate và artifact

- tests/e2e/gate4-pharmacy.md: hai hành trình và phiếu người nhận.
- tests/e2e/access-matrix.md, recovery.md: ma trận quyền và crash points.
- UMC_READ_URL + UMC_TEST_TOKEN local rồi chạy node tools/quan/measure-read.js:
  100 GET/30 concurrency, ghi p95 và lỗi; ngưỡng read <2s theo SRS.
  Chưa đo cache hit >=80%, projection p95<5s/recovery<=60s hoặc responsive bằng browser thật.
- powershell -File tools/quan/package-release.ps1 -OutputDirectory <existing-local-directory-outside-repo>:
  yêu cầu working tree sạch, archive đúng HEAD + SHA256 manifest; không tạo tag/push/backup DB.
  Backup DB/restore do từng owner thực hiện, APK do Hưng cấp rồi ghép manifest cùng commit.
