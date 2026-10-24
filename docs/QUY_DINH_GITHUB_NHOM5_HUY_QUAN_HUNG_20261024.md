# QUY ĐỊNH GITHUB VÀ PHÂN QUYỀN THƯ MỤC — UMC CARE, NHÓM 5

**Thành viên:** Huy, Quân, Hưng. **Ngày lập:** 24/10/2026.

**Mục đích:** mỗi người biết mình được sửa đâu, phải bàn giao cho ai, ai review và ai đưa code vào nhánh chung; giảm conflict và tránh ghi đè phần của nhau.

**Phạm vi của file:** quy ước làm việc để nhóm áp dụng. Bản này được đưa vào thư mục docs/ của repository theo yêu cầu ngày 24/10/2026. Việc viết tài liệu chưa tạo tài khoản/quyền, CODEOWNERS, pull request hoặc cấu hình bảo vệ nhánh trên GitHub. Huy chịu trách nhiệm triển khai các cài đặt ở mục 10 khi nhóm cho phép.

## 1. Ai phụ trách việc gì trên GitHub?

| Công việc | Người chịu trách nhiệm chính | Người phối hợp/kiểm tra | Đầu ra phải có |
| --- | --- | --- | --- |
| Quản lý repository, thành viên và quyền truy cập | **Huy** | Quân, Hưng xác nhận truy cập được | Cả ba clone/fetch/push nhánh cá nhân được |
| Viết và duy trì quy định GitHub, bảng owner, mẫu PR | **Huy** | Quân và Hưng đọc, xác nhận | Một bản quy định chung có ngày cập nhật |
| Cấu hình bảo vệ `main`, `develop` và CODEOWNERS | **Huy** | Quân kiểm thử bằng PR | PR không tự duyệt; quy tắc review/check hoạt động đúng |
| Điều phối PR, thứ tự merge và xử lý lỗi tích hợp | **Huy** | Quân là người dự phòng khi Huy bàn giao | PR được review, kiểm tra và merge có lịch sử |
| Đưa bản ổn định từ `develop` sang `main`, gắn tag | **Huy** | Ít nhất một thành viên khác review | PR release, test và hướng dẫn demo đúng phiên bản |
| Chia task thành issue và ghi tiêu chí hoàn thành | **Huy** | Từng owner xác nhận task của mình | Issue ghi người làm, thư mục, API/màn hình, test và dependency |
| Cập nhật tiến độ, bằng chứng test và lỗi của task | **Người thực hiện task** | Người review | Comment/PR thể hiện việc đã chạy và phần chưa kiểm |
| Sửa code bị CI báo lỗi | **Tác giả PR** | Huy hỗ trợ nếu lỗi workflow | Commit sửa lỗi; không bỏ test chỉ để CI xanh |

**Huy không tự approve PR do Huy tạo.** Quân review PR của Huy; Huy review PR của Quân/Hưng. Nếu người review chính bận hoặc là tác giả PR, thành viên còn lại review. Phần liên quan một service khác phải có owner của service đó kiểm tra hợp đồng bị ảnh hưởng.

**Người bấm merge mặc định là Huy.** Quân chỉ merge thay khi Huy bàn giao rõ trong PR hoặc buổi làm việc. Tác giả đã được approve vẫn không tự ý đổi nội dung rồi merge mà thiếu lượt kiểm tra thay đổi mới.

## 2. Dùng những nhánh nào?

| Nhánh | Mục đích | Ai được đẩy code? | Đưa code vào bằng cách nào? |
| --- | --- | --- | --- |
| `main` | Bản ổn định dùng nộp/demo | Không push trực tiếp theo quy định này | PR `develop → main`, Huy điều phối |
| `develop` | Bản tích hợp chung của nhóm | Không push trực tiếp trong quy trình thường ngày | PR từ nhánh cá nhân, review và test rồi merge |
| `huy` | Huy làm phần của Huy | Huy | Commit/push task của Huy, tạo PR vào `develop` |
| `quan` | Quân làm phần của Quân | Quân | Commit/push task của Quân, tạo PR vào `develop` |
| `hung` | Hưng làm phần của Hưng | Hưng | Commit/push task của Hưng, tạo PR vào `develop` |

Quy ước này dùng ba nhánh cá nhân vì nhóm hiện đã yêu cầu tạo và sử dụng `huy`; thay cho hướng dẫn cũ chỉ có `main` và `develop`. `quan` và `hung` là nhánh cần tạo nếu chưa tồn tại, không phải xác nhận đã có trên remote.

Không xóa, đổi tên nhánh của bạn khác; không force-push `main`/`develop`. Không dùng `reset --hard` hoặc chọn đè code người khác để giải quyết push bị từ chối.

Lần merge trực tiếp `huy → develop` ngày 24/10 được thực hiện theo yêu cầu cụ thể của Huy. Các lần sau dùng quy trình PR trong tài liệu này; ngoại lệ phải có yêu cầu rõ, được ghi lại và vẫn phải kiểm thử.

## 3. Ai được sửa thư mục nào?

Owner chính viết code, migration, seed, unit/integration test, worker và README trong phạm vi của mình. Người khác muốn sửa phải trao đổi trước và để owner kiểm tra trong PR.

| Người | Backend sở hữu | Web feature sở hữu | Phần riêng khác |
| --- | --- | --- | --- |
| **Huy** | `services/catalog/`, `services/clinical/`, `services/diagnostic/` | `apps/web/src/features/catalog/`, `clinical/`, `diagnostic/` | `tools/huy/`, `tools/catalog-preview/`, cấu hình riêng trong `infra/compose/postgres/huy/` |
| **Quân** | `services/patient/`, `services/appointment/`, `services/pharmacy/` | `apps/web/src/features/patient/`, `appointment/`, `pharmacy/` | Các công cụ riêng của ba service trên |
| **Hưng** | `services/identity/`, `services/billing/`, `services/notification/` | `apps/web/src/features/identity/`, `billing/`, `notification/` | Toàn bộ `apps/android/` |

Các tên `clinical/`, `diagnostic/`... viết ngắn trong cột web đều nằm dưới `apps/web/src/features/`. Màn hồ sơ y tế do Huy làm đặt trong feature Clinical/Diagnostic và ghép vào menu bệnh nhân của Quân qua route/callback đã thống nhất. Không tạo hai màn cùng chức năng ở hai owner.

Không lấy code backend của service khác import trực tiếp vào service mình; không sửa migration/DB của service khác để phục vụ API của mình. Mỗi service sở hữu DB và dữ liệu của nó; kết nối qua HTTP/message contract.

## 4. File dùng chung: ai cầm chính?

| Phạm vi | Owner chính | Khi nào cần người khác review? |
| --- | --- | --- |
| `apps/web/src/app/`: entry, layout, router, menu, ghép các feature | **Quân** | Thêm route/permission/menu cho feature của owner nào thì owner đó review |
| `apps/web/src/shared/ui/`, public asset/style dùng toàn web | **Quân** | Thay component/style chung có ảnh hưởng các màn khác |
| `apps/web/src/shared/api/`: transport HTTP, bearer/lease, lỗi chung | **Hưng** | Quân và Huy kiểm cách gọi từ feature; thay envelope phải cùng thống nhất |
| Web session/auth dùng chung; code login nằm trong feature Identity | **Hưng** | Quân review cách gắn shell/router; Huy kiểm nhu cầu quyền API |
| `apps/web/package.json`, lockfile, Vite/TypeScript config của web chung | **Quân** | Người đề nghị dependency nêu lý do; Hưng review thay auth/network dependency |
| `envoy/`: route Gateway, cấu hình auth/rate limit | **Hưng** | Owner service bị đổi route/quyền review |
| `infra/compose/`: Compose tích hợp toàn nhóm, network, port, volume | **Quân** | Huy kiểm PostgreSQL/Go; Hưng kiểm Gateway/Django/Android endpoint |
| `rabbitmq/`: broker, exchange/queue/policy dùng chung | **Quân** | Các producer/consumer bị đổi binding cùng review |
| `mongo/`: init/config MongoDB dùng chung | **Quân** | Owner DB/service sử dụng kiểm lại |
| `postgres/`: init/role/config PostgreSQL dùng chung | **Huy** | Hưng review phần DB cho Identity/Billing/Notification |
| Redis dùng chung: Compose/service config | **Quân** | Huy review TTL/generation/fallback phần Catalog; owner khác kiểm prefix của mình |
| `.github/workflows/`, CODEOWNERS, PR template, `.gitignore`, `.gitattributes` gốc | **Huy** | Ít nhất một thành viên khác review; từng owner cung cấp lệnh test thật |
| `contracts/http/` | **Owner API tương ứng**; Huy điều phối danh sách chung | Client/consumer bị ảnh hưởng review; auth/Gateway đổi phải có Hưng |
| `contracts/messages/` | **Owner producer của message**; Huy điều phối danh sách chung | Consumer bị ảnh hưởng review trước khi ghép |
| `tests/e2e/`, `tests/performance/` | **Huy điều phối** | Từng owner cung cấp dữ liệu seed, test case và sửa lỗi thuộc service mình |
| `docs/` và README gốc | **Huy ghép bản chung** | Quân/Hưng viết và kiểm phần của mình; sửa chức năng/quyền phải trao đổi |

**Điểm cần cập nhật khi đưa quy định vào repo:** README `shared/api/` hiện còn ghi Quân. Theo bảng này, Hưng phụ trách shared API; Quân phụ trách ghép nó vào web shell. Không coi README cũ đã được sửa chỉ vì đã viết file này.

File cấu hình riêng của Huy, ví dụ `infra/compose/huy.catalog.yml` và workflow `huy-go.yml`, là đầu vào để tích hợp, không thay thế Compose/CI toàn nhóm. Đổi file riêng nhưng ảnh hưởng port/network/check của nhóm vẫn cần owner phần chung review.

## 5. Quy trình mỗi người làm một task

### Bước 1 — Nhận việc và ghi phạm vi

- Issue/task ghi tên người làm, mục tiêu, API/màn hình, danh sách thư mục sẽ sửa, đầu vào cần từ bạn khác và điều kiện hoàn thành.
- Nếu phải sửa file dùng chung, comment rõ **file nào, đổi gì, ai phụ trách** trước khi bắt đầu. Không để hai người đồng thời sửa một lockfile/router/Compose mà không biết nhau.
- Task đủ nhỏ để review một mục đích; không gom nhiều ngày code không liên quan vào một PR lớn.

### Bước 2 — Cập nhật nhánh cá nhân trước khi code

Ví dụ cho Huy, chạy từ gốc repo:

```powershell
git status --short
git fetch origin
git switch huy
git merge origin/develop
```

Trước khi switch/merge, bảo toàn thay đổi chưa commit của mình. Không xóa/stash toàn bộ file cá nhân hoặc code người khác. File Word untracked có thể giữ ngoài commit; không cần xóa để làm Git. Nếu local và remote nhánh cá nhân khác nhau, kiểm log và tích hợp thay đổi remote trước khi push, không force-push.

Nếu Quân/Hưng chưa có nhánh cá nhân, tạo từ `origin/develop` đã fetch bằng `git switch -c quan origin/develop` hoặc `git switch -c hung origin/develop`; dùng `git push -u origin quan` / `hung` sau commit đầu tiên. Không chạy lệnh tạo lại nếu nhánh đã tồn tại.

### Bước 3 — Code và tự kiểm thử

- Chỉ sửa file đúng phạm vi task; cần mở rộng thì ghi trong issue/PR và báo owner liên quan.
- Chạy test/build đúng service và web feature bị đổi. Thay hợp đồng phải kiểm request/response/message cùng consumer liên quan.
- Phân biệt kết quả: test local đã chạy, tích hợp đã chạy, CI đang chạy hoặc chưa có môi trường. Không ghi tất cả PASS khi mới test bằng mock.
- Không để AI tự sửa service bạn khác, push, merge hoặc thay quy định khi chưa được người phụ trách yêu cầu cụ thể. Người giao AI vẫn chịu trách nhiệm đọc diff và giải thích code.

### Bước 4 — Commit đúng file

```powershell
git diff --check
git diff
git add -- services/catalog/internal/application/usecase/catalog.go
git diff --cached --name-only
git diff --cached
git commit -m "feat(catalog): implement price validation"
git push origin huy
```

Đây là ví dụ cho một file; phải stage đủ các source/test/migration/config liên quan thật của task. Không sao chép lệnh để commit một file không thay đổi. Không dùng `git add .` khi repo có file cá nhân hoặc thay đổi ngoài task.

Commit ngắn theo mẫu `feat(scope): ...`, `fix(scope): ...`, `test(scope): ...`, `docs(scope): ...`, `chore(scope): ...`. Không dùng một commit như “update all” cho nhiều mục đích không liên quan.

Không commit `.env` có secret, private key, access/refresh token, dữ liệu bệnh nhân thật, `.runtime/`, `node_modules/`, thư mục build và log. `.env.example` chỉ chứa tên biến và giá trị mẫu. Word/tài liệu chỉ thêm khi task tài liệu yêu cầu, không trộn vào commit code.

### Bước 5 — Tạo pull request vào `develop`

PR phải có: task/API/màn hình nào; thay đổi hành vi gì; file chung/contract nào bị ảnh hưởng; test đã chạy và kết quả; migration/env mới; ảnh giao diện nếu sửa UI; dependency/chỗ chưa tích hợp.

Người review đọc diff, kiểm quyền/thư mục, hợp đồng và test. Khi sửa tài nguyên nhạy cảm phải kiểm scope/ownership; khi sửa giá/workflow phải kiểm retry, idempotency, version, transaction và message. Không chỉ nhìn số test xanh rồi approve.

Không đưa commit/task tiếp theo không liên quan lên nhánh cá nhân khi PR hiện tại chưa ghép. Nếu cần làm nhiều task song song bằng nhánh task riêng, nhóm thống nhất trước thay vì trộn vào cùng PR.

### Bước 6 — Đồng bộ và merge

- Trước merge, PR phải chứa thay đổi mới cần thiết từ `develop`, hết conflict, hết comment cần sửa và có review độc lập.
- Chạy lại kiểm tra bị ảnh hưởng sau khi tích hợp `develop`. Nếu conflict làm thay đổi hành vi/hợp đồng, owner bên kia review kết quả giải quyết.
- Huy kiểm rồi dùng **Create a merge commit** để giữ lịch sử nhánh cá nhân. Không xóa nhánh cá nhân dùng lâu dài sau PR.
- Sau merge, tác giả fetch và merge `origin/develop` vào nhánh cá nhân trước task mới. Không chép lại cả thư mục từ bản cũ lên nhánh mới.

## 6. Xử lý conflict thế nào?

| Conflict xảy ra ở đâu? | Ai giải quyết chính? | Cách xử lý |
| --- | --- | --- |
| Source trong service/feature của một người | Owner thư mục, cùng tác giả PR | Đối chiếu hành vi và test; giữ đúng cả hai thay đổi cần thiết |
| Router/menu/layout/shared UI | Quân | Ghép route/component của các feature, kiểm điều hướng và quyền |
| Shared API/session hoặc Gateway | Hưng | Giữ đúng contract, token/lease và xử lý lỗi chung |
| Compose/broker/MongoDB config | Quân | Kiểm tên service, port, env, network, volume và consumer binding |
| PostgreSQL init/role, CI, Git config dùng chung | Huy | Kiểm quyền DB, migration, lệnh build/test và phạm vi workflow |
| HTTP/message contract | Producer/API owner cùng consumer bị ảnh hưởng | Giải quyết ý nghĩa nghiệp vụ trước, rồi sửa file schema và tests |

Không chọn “Accept ours/theirs” cho cả file chỉ để hết dấu conflict. Không xóa code của người khác khi chưa hiểu tác dụng. Không đẩy file còn `<<<<<<<`, `=======`, `>>>>>>>` do Git conflict. Sau khi giải quyết: xem toàn bộ diff liên quan, chạy test rồi commit merge.

**Lockfile:** owner web chung là Quân; thống nhất `package.json` trước rồi dùng package manager đã chọn để cập nhật lockfile. Không sửa tay số phiên bản trong lockfile hoặc xóa lockfile để hết conflict. Lockfile riêng trong một service/tool do owner của phần đó quản lý.

**Migration:** chỉ thêm migration mới theo thứ tự trong từng service. Không sửa/xóa migration đã áp dụng vào môi trường chung. Hai service khác nhau có thể cùng số version; hai migration trong cùng service phải được owner kiểm và sắp thứ tự. Mọi thao tác làm mất dữ liệu/volume cần yêu cầu rõ, không dùng để xử lý conflict.

## 7. Quy tắc thay API và message

- Owner API/producer đề xuất thay đổi ở contract trước, ghi consumer bị ảnh hưởng và ví dụ payload trước/sau.
- Không tự đổi URL, field, enum trạng thái, quyền, event name/routing key hoặc đơn vị tiền rồi yêu cầu người khác đoán theo code.
- Thay đổi làm consumer cũ không chạy được phải có kế hoạch tương thích/version và thời điểm ghép; owner liên quan xác nhận trước merge.
- Cùng một PR hoặc nhóm PR liên kết phải cập nhật source, schema, test, tài liệu và mẫu dữ liệu cần thiết. PR nào phụ thuộc PR nào phải ghi rõ.
- Cấu hình auth/lease do Hưng điều phối; từng service vẫn phải kiểm quyền và ownership đúng trách nhiệm của mình.

## 8. Khi CI đỏ, lỗi sau merge hoặc push bị từ chối

- **CI đỏ trước merge:** tác giả PR sửa; Huy hỗ trợ phần workflow. Không merge như thể check đã đạt.
- **Lỗi sau merge:** Huy điều phối, owner bị ảnh hưởng xác định phạm vi. Sửa bằng commit/PR mới; nếu cần quay lại thì dùng revert có trao đổi. Không rewrite lịch sử `develop`/`main`.
- **Push rejected vì remote mới hơn:** fetch, đọc log, bảo toàn commit local, tích hợp thay đổi remote và kiểm lại. Không force-push để vượt lỗi.
- **Dependency chưa có:** phát triển/test phần độc lập với fixture chỉ ở test; ghi rõ gate tích hợp. Không đưa mock auth hoặc fake success vào đường demo thật.

## 9. Khi nào một task được tính Done?

1. Đúng chức năng và phạm vi owner, không làm thay đổi ngầm API/quyền của bạn khác.
2. Có source và test tương ứng; migration/seed/config cần thiết đã bàn giao.
3. Test/build liên quan đạt; phần tích hợp chưa chạy được ghi rõ, không nhận là đã tích hợp.
4. PR được người khác review; file chung/contract có owner liên quan kiểm.
5. Merge vào `develop`, kiểm lại môi trường ghép và cập nhật issue/bằng chứng.

“Code xong local”, “đã push nhánh cá nhân” và “đã chạy tích hợp” là ba trạng thái khác nhau. Chỉ đánh dấu hoàn tất toàn task khi đạt tiêu chí task đã ghi.

## 10. Checklist Huy triển khai trên GitHub

Các mục dưới đây **chưa được thực hiện chỉ bởi việc tạo file này**:

- [ ] Kiểm quyền repository của cả ba; dùng đúng username GitHub thật khi cấu hình owner, không đoán username của Quân/Hưng.
- [ ] Đưa bản quy định được nhóm chốt vào `CONTRIBUTING.md`, liên kết từ README gốc và cập nhật README owner đang lệch.
- [ ] Tạo `.github/CODEOWNERS` theo bảng thư mục; dùng owner chính và ít nhất một người review dự phòng có quyền phù hợp. Nếu bật yêu cầu code-owner review, phải kiểm PR do chính owner tạo vẫn có người khác đủ quyền approve; không cấu hình một owner duy nhất rồi buộc người đó tự duyệt. Nhiều owner trong một dòng không có nghĩa GitHub tự yêu cầu tất cả cùng approve.
- [ ] Tạo PR template theo mục 5; thống nhất labels/task và cách đánh dấu dependency.
- [ ] Bảo vệ `develop`/`main`: yêu cầu PR, ít nhất một approve độc lập, xử lý conversation và review lại thay đổi mới; chặn force-push/xóa nhánh chung. Kiểm giới hạn gói/quyền GitHub thực tế trước khi xác nhận đã bật.
- [ ] Chọn status check bắt buộc theo tên check thực tế trong Actions. Đảm bảo check chạy cho mọi PR thuộc phạm vi bị bắt buộc.
- [ ] **Lưu ý CI hiện tại:** `huy-go.yml` lọc theo đường dẫn phần Huy. Không đặt check lọc path này thành required cho mọi PR nếu PR Quân/Hưng/docs có thể không tạo check và bị chờ vô hạn. Huy cần một gate luôn chạy, đánh giá đúng các job cần cho thay đổi của PR rồi mới bật yêu cầu check toàn repo.
- [ ] Từng owner bàn giao lệnh test/build: Go của Huy; Node.js của Quân; Django/Android của Hưng; Quân cung cấp script của shell web chung.
- [ ] Thử một PR nhỏ: request review đúng người, kiểm job cần thiết, merge được và các nhánh cá nhân đồng bộ lại được.

## 11. Bản ngắn gửi nhóm

> Huy làm Catalog/Clinical/Diagnostic, CI/PostgreSQL và điều phối GitHub/merge. Quân làm Patient/Appointment/Pharmacy, web shell/shared UI, Compose/broker/MongoDB. Hưng làm Identity/Billing/Notification, shared API/auth/Gateway và Android. Mỗi người code nhánh riêng, chỉ commit file đúng phần mình. File chung báo owner trước khi sửa. Tạo PR vào develop, có một người khác review và test đạt rồi Huy merge; Huy làm thì Quân review. Không push thẳng main/develop, không force-push hoặc chép đè thư mục của bạn khác. Sau mỗi lần merge, cập nhật develop về nhánh cá nhân trước task mới.
