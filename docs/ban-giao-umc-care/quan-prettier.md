# Format code Node.js của Quân

Áp dụng cho `services/patient`, `services/appointment`, `services/pharmacy`, `apps/web`.
Prettier được pin cùng phiên bản trong devDependencies và package-lock của cả ba service.
Không cần package.json hoặc node_modules ở thư mục gốc.

## Khi phát triển

Trong thư mục service đang làm:

```powershell
npm ci
npm run format
npm run format:check
npm run check
npm test
```

Hoặc chạy từ thư mục gốc:

```powershell
npm run format --prefix services/patient
npm run format --prefix services/appointment
npm run format --prefix services/pharmacy
```

VS Code: cài extension được workspace đề xuất `esbenp.prettier-vscode`.
Workspace bật Format on Save cho JavaScript. Prettier dùng cấu hình gốc,
riêng ba service này ưu tiên độ dài dòng 80 ký tự, thụt lề 2 spaces,
single quotes, dấu chấm phẩy và LF theo quy ước hiện tại.
80 ký tự là hướng dẫn ngắt dòng; chuỗi dài có thể vẫn vượt giới hạn.
Các object ngắn vẫn có thể ở một dòng. Các object đã viết nhiều dòng
được giữ nhiều dòng. Các câu lệnh được tách dòng theo Prettier.

## CI

Workflow `Quan Node Mongo Web`, job `node-services`, chạy `npm ci` rồi
`npm run format:check`, kiểm tra cú pháp và unit test cho từng service.
Thay đổi cấu hình Prettier/EditorConfig cũng kích hoạt workflow.
Lockfile, node_modules, output build và các file env bí mật được bỏ qua
bởi formatter. CI chỉ kiểm tra format, không tự sửa source.

Đợt cập nhật này lấy `origin/develop` tại `d0b2f96` vào `quan`, giữ nguyên
thay đổi env mới của nhánh develop. Không đổi logic nghiệp vụ.

## Windows and Linux CI

Git attributes, EditorConfig and Prettier use LF for the three Node services and web. This avoids core.autocrlf making a Windows-only format check pass while Linux CI fails. The web job also checks TS/TSX/CSS/HTML formatting before typecheck, tests and build.
