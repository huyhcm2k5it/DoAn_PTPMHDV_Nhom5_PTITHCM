# identity

- **Purpose:** Identity feature or service.
- **Owner:** Hung
- **Add or change:** Keep source code, configuration, migrations, and tests within this folder's scope.

## Khóa ký JWT

`jwt_private.pem` **không nằm trong git** (quy định nhóm cấm commit private key).
Sau khi clone, máy nào chạy service Identity thì chạy một lần:

```bash
python services/identity/scripts/generate_keys.py generate
