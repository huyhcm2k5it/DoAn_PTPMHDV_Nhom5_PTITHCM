# Preview độc lập W03 của Huy

Đây là công cụ phát triển, không phải shell/login thứ hai. Giao diện gọi HTTP thật qua Vite proxy đến `127.0.0.1:8081`; không chứa dữ liệu giả hoặc cơ chế cấp quyền giả.

Node 24.14+ (hoặc Node phiên bản đáp ứng engines trong lockfile), npm. Từ repo:

```powershell
npm ci --prefix tools/catalog-preview
npm run dev --prefix tools/catalog-preview
```

Mở địa chỉ Vite in ra (mặc định `http://127.0.0.1:5173`). Catalog phải chạy và migrate/seed trước. Public không cần token. Panel phát triển chỉ nhận token/lease từ Identity, giữ trong bộ nhớ; refresh sẽ xóa. Chưa ghép Identity thì chỉ demo public, protected API vẫn đóng.

```powershell
npm run typecheck --prefix tools/catalog-preview
npm test --prefix tools/catalog-preview
npm run build --prefix tools/catalog-preview
```

`dist/` là bản build thử; proxy chỉ hoạt động ở dev server. Khi ghép thật, Quân import feature và Hưng inject shared transport, không đưa panel token này vào sản phẩm. Xem `apps/web/src/features/catalog/README.md`.
