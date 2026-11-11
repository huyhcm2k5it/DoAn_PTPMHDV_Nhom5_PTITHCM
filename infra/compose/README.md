# Stack chung UMC Care — bàn giao tuần 4–5

## Docker image, dữ liệu và máy của từng thành viên

`docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml up -d --build` tải base image (MongoDB, PostgreSQL, RabbitMQ, Redis) nếu máy chưa có và **build image ứng dụng từ source tại máy**. Không cần push image ứng dụng lên Docker Hub để chạy Compose local. Chỉ cần registry/push/pull nếu nhóm chọn phân phối image đã build thay cho việc build từ source.

Docker Hub lưu image, **không chứa dữ liệu trong named volumes** `mongo_data`, `postgres_be_data`, `rabbitmq_data`. Mỗi máy chạy Compose riêng sẽ có database và broker riêng, nên dữ liệu/event không tự xuất hiện trên máy người khác. Muốn cùng thấy dữ liệu, nhóm phải dùng chung DB/broker có địa chỉ truy cập được và credential thống nhất, hoặc thực hiện backup/restore/seed vào từng môi trường. Dữ liệu Huy đã nhập trên Neon chỉ có ở database Neon tương ứng; Compose mặc định vẫn trỏ Catalog/Clinical/Diagnostic về PostgreSQL container local.

Compose hiện không publish cổng RabbitMQ `5672`/`15672` ra host. Tên `rabbitmq` trong URL local chỉ phân giải bên trong Compose network. Để service ở máy khác kết nối cùng broker, owner hạ tầng phải cung cấp host/port truy cập được, vhost thực tế, user/password và ACL tương ứng; nạp topology tương ứng từ `rabbitmq/definitions.json`, rồi cấu hình URL của từng worker. Vhost online có thể khác `/umc-care` của Compose local. Ba file thật trong `env/` không có trong Git; xem [mẫu theo owner](../../env/README.md).

Bản cấu hình đã qua Compose structural validation. Build image, health của 9 service và E2E live phải được xác nhận trên máy có Docker engine chạy. Go API/worker/migrate đã có trong cùng private network; health thành công vẫn chưa chứng minh hành trình nghiệp vụ.

`docker compose ... config --quiet` chỉ kiểm cú pháp và biến bắt buộc; nó không kết nối DB, broker hay kiểm cặp khóa JWT. Trước khi `up`, xác nhận `services/identity/jwt_private.pem` tồn tại trên máy Identity và khớp `infra/certs/jwt_public.pem`. Với DB online, kiểm schema/migration riêng cho từng owner; không suy ra database đã sẵn sàng chỉ từ việc TCP hoặc TLS kết nối được.

## Chuẩn bị trên máy local

1. Cài dependencies theo lockfile: npm ci ở services/patient, services/appointment, services/pharmacy,
   tests/mongo và apps/web. Node theo CI là 24.14.0.
2. Mỗi owner tạo file của mình từ `env/quan.env.example`, `env/huy.env.example`, `env/hung.env.example`.
   Quân có thể dùng `scripts/dev/bootstrap-local.ps1` để tạo `env/quan.env` và Mongo keyfile local; `tools/quan/prepare-stack.ps1` tạo `env/huy.env` nếu thiếu, giữ file đã có và yêu cầu `env/hung.env` do Hưng chuẩn bị.
3. Hưng điền `env/hung.env`: DB host trong Compose là `postgres`, broker host là `rabbitmq` và đúng vhost/credentials từ `env/quan.env`.
   Đối chiếu infra/compose/postgres/hung/init.sql; không dùng mật khẩu placeholder để nghiệm thu.
4. Đặt public key Identity thật vào infra/certs/jwt_public.pem và chạy
   `node tools/quan/prepare-gateway-key.js`. Envoy cần JWKS JSON, không đọc PEM như JWKS.
   Private key chỉ ở owner Identity, không commit.
5. `env/quan.env` có Mongo owner URI, `UMC_AMQP_URL` dùng chung cho worker Quân và Huy, AMQP host/cổng và Appointment Redis; `env/huy.env` có ba PostgreSQL DSN; `env/hung.env` có DB host/cổng/SSL mode và cùng `UMC_AMQP_URL` của Quân. Bảng cổng service 8001–8009 và quy định bổ sung env nằm trong [env README](../../env/README.md).
   Dùng mật khẩu URL-safe. Giá trị phải khớp user đã khởi tạo trong volume cũ;
   init scripts không tự thay mật khẩu DB cũ.
6. Với broker cũ, xem migration quorum trong tests/e2e/recovery.md trước khi bật worker mới.
   RabbitMQ definitions là artifact import; Compose không tự import hoặc tự cấp ACL producer.
   Owner broker import definitions vào vhost /umc-care và kiểm ACL publish/consume/declare theo ownership.

## Dựng và kiểm tra

```powershell
docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml config --quiet
docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml up -d --build
powershell -File tools/quan/check-stack.ps1
powershell -File tools/quan/verify-local.ps1
```

Mongo bootstrap tạo replica/user trước Node API. Go migrations chạy trước Go API/worker.
Publisher/expiry/reconcile chạy trong worker riêng; chỉ bật API không làm outbox tự drain.
Gateway chỉ public port 8080; Postgres của Huy và Redis ở private network.
Trong Compose chung này, PostgreSQL không publish cổng ra host; cấu hình chạy riêng của từng owner cần được kiểm tra độc lập.
Health thành công chỉ chứng minh dependency sẵn sàng, không chứng minh hành trình nghiệp vụ.

## Pharmacy migration và seed

Trong container pharmacy, MONGODB_URI đã chọn pharmacy_db:

```powershell
docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml exec -T pharmacy node scripts/migrate-storage.js
docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml exec -T pharmacy node scripts/migrate-storage.js --apply
docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml exec -T pharmacy node scripts/seed-demo.js --dry-run
docker compose --env-file env/quan.env --env-file env/huy.env --env-file env/hung.env -f infra/compose/compose.yaml exec -T pharmacy node scripts/seed-demo.js
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
