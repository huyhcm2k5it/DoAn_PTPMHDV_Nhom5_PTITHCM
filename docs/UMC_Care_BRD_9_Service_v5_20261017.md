UMC Care BRD

Tài liệu yêu cầu nghiệp vụ cho hệ thống khám ngoại trú mô phỏng

| **Thông tin** | **Giá trị** |
| --- | --- |
| **Phiên bản** | 5.0 · bản chốt nghiệp vụ nhóm ba người |
| **Ngày lập** | 17/10/2026 |
| **Nhóm thực hiện** | Huy · Quân · Hưng (3 người, 20–24 giờ/người/tuần) |
| **Hạn nộp** | 23/11/2026 |
| **Bối cảnh** | Đồ án mô phỏng hệ thống khám ngoại trú; không kết nối bệnh viện thật |

Bản này xác định phạm vi nghiệp vụ để nhóm ba người xây dựng hệ thống và kiểm thử. Mọi yêu cầu bên dưới nằm trong phạm vi đồ án; cách thực hiện chi tiết nằm trong SRS cùng phiên bản.

# 1 Tóm tắt và quyết định phạm vi

UMC Care mô phỏng một cơ sở khám ngoại trú. Người bệnh tự phục vụ trên web và Android; nhân viên dùng web để tiếp nhận, khám, xét nghiệm, cấp thuốc, thu phí và quản trị. Hệ thống dùng dữ liệu giả, không đại diện cho phần mềm chính thức của bệnh viện và không kết nối hệ thống bệnh viện thật.

Kết quả cần chứng minh là hai hành trình chạy xuyên suốt: khám không LAB và khám có LAB. Cả hai phải đi qua dữ liệu thật của dịch vụ, xử lý được các nhánh đổi/hủy, phí/hoàn và sai sót mẫu/toa; không chỉ là giao diện tĩnh.

# 2 Bối cảnh, mục tiêu và chỉ số

| **Mã** | **Mục tiêu** | **Bằng chứng nghiệm thu** |
| --- | --- | --- |
| **BO-01** | Bệnh nhân tự chọn lịch và hiểu trạng thái phí | Tối đa 6 bước chính từ chọn khoa đến xác nhận; test người dùng với dữ liệu seed. |
| **BO-02** | Không mất chỗ hoặc đặt quá sức chứa | Test tranh slot cuối, hold hết hạn, đổi lịch lỗi và retry. |
| **BO-03** | Một lượt khám có hồ sơ cuối có thể xem lại | Hai hành trình E2E, gồm kết quả LAB và toa nếu có. |
| **BO-04** | Thu/hoàn rõ ràng và không lặp | Mỗi nguồn có một phiếu; retry không tạo khoản thu/hoàn thứ hai. |
| **BO-05** | Đáp ứng kiến trúc 9 context và phân công 3 service/người | Web 3 actor, Android bệnh nhân; 9 DB logic, RabbitMQ và Redis; bằng chứng async, retry, cache mất và transaction cục bộ. |

# 3 Ranh giới sản phẩm

| **Trong phạm vi** | **Ngoài phạm vi** |
| --- | --- |
| **Tài khoản/OTP, hồ sơ người bệnh và phân quyền nhân viên** | Dữ liệu người bệnh thật; xác minh CCCD/BHYT với cơ quan thật |
| **Tra cứu, giữ/đặt/đổi/hủy lịch, tiếp nhận và hàng chờ** | Đặt đa cơ sở, khám từ xa, nội trú |
| **Khám, chỉ định LAB, mẫu, kết quả, toa và nhà thuốc** | Chẩn đoán hình ảnh, AI chẩn đoán, thay thuốc sau toa FINAL |
| **Thu/hoàn mô phỏng, biên nhận và thông báo trong ứng dụng** | Tiền thật, đối soát ngân hàng thật, hóa đơn điện tử pháp lý |
| Web đủ vai trò; Android bệnh nhân gọn; 9 service và DB riêng | iOS, Kubernetes, hệ thống HIS/LIS/PACS chính thức |

# 4 Các bên liên quan và kênh sử dụng

| **Actor** | **Kênh** | **Chức năng** |
| --- | --- | --- |
| **Bệnh nhân** | Web, Android | Tài khoản, hồ sơ bản thân/người thân, lịch, thanh toán mô phỏng, kết quả, toa, biên nhận, thông báo. |
| **Bác sĩ** | Web | Nhận lượt, khám, chỉ định LAB, tiếp tục lượt RETURN, lập/ký kết luận và toa. |
| **Nhân viên bệnh viện** | Web | Các module tiếp nhận, LAB, dược, thu ngân và quản trị hiển thị theo quyền của từng tài khoản. |

Có ba actor: PATIENT, DOCTOR và STAFF. STAFF là nhóm người dùng, quyền được gán theo tác vụ RECEPTION, LAB\_TECH, LAB\_REVIEW, PHARMACY, CASHIER, ADMIN và phạm vi. Để demo gọn, một tài khoản STAFF chính có thể được cấp tất cả capability; quyền ADMIN chỉ cấp cho tài khoản quản trị được chỉ định. Riêng LAB phải có tài khoản STAFF thứ hai: người nhập/sửa một revision kết quả không được tự duyệt revision đó dù có cả LAB\_TECH và LAB\_REVIEW.

# 5 Hành trình nghiệp vụ bắt buộc

## 5.1 Khám không có LAB

1. Đăng ký/OTP, tạo hồ sơ và chọn dịch vụ, bác sĩ, slot còn chỗ.
2. Giữ slot và phát phiếu khám; thanh toán mô phỏng hoặc thu tại quầy, xác nhận lịch.
3. Lễ tân check-in, cấp vé; bác sĩ gọi và bắt đầu một visit.
4. Bác sĩ ghi khám, lập/sửa/xóa toa nháp nếu cần, ký bản cuối.
5. Nếu có toa, dược sĩ giữ toàn toa, thu phí và phát; bệnh nhân xem hồ sơ và biên nhận.

## 5.2 Khám có LAB

1. Bắt đầu như hành trình khám thường, bác sĩ tạo order LAB trong visit.
2. Billing phát phiếu LAB; chỉ khi đủ phí LAB mới tiếp nhận và lấy mẫu.
3. Mẫu lỗi có lý do và lấy lại trong cùng order; kết quả nháp có thể bị người duyệt trả sửa.
4. Người duyệt công bố kết quả; bác sĩ gọi bệnh nhân RETURN vào cùng visit, đọc bản đã công bố, ký kết luận/toa.
5. Nhà thuốc xử lý toa cuối nếu có; bệnh nhân chỉ xem kết quả và toa đã công bố.

## 5.3 Các nhánh cần thể hiện

* Đổi lịch hợp lệ giữ slot mới trước; lỗi không làm mất lịch cũ. Hủy lịch đã thu tạo hoàn có trạng thái riêng.
* Hủy LAB chỉ trước lần lấy mẫu/thực hiện đầu tiên; phí chưa thu được vô hiệu, phí đã thu chưa dùng có căn cứ hoàn.
* Toa DRAFT được sửa hoặc xóa; thiếu thuốc không giữ một phần, có đường nhập bổ sung và giữ lại.
* Mọi thao tác lặp hoặc service tạm lỗi đều có pending/retry rõ, không báo thành công khi chưa có bằng chứng.

# 6 Danh sách yêu cầu nghiệp vụ

## Tài khoản

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-01** | Người bệnh tự đăng ký bằng số điện thoại, nhận và xác minh OTP rồi đăng nhập; có gửi lại OTP và lỗi rõ ràng. Môi trường demo có kênh nhận mã giả lập cho dữ liệu giả. |
| **BR-02** | Người bệnh quên/đặt lại mật khẩu bằng OTP, đổi mật khẩu từ phiên hợp lệ và đăng xuất; đổi hoặc đặt lại thu hồi phiên cũ. |

## Hồ sơ

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-03** | Một tài khoản quản lý hồ sơ bản thân và người thân; thông tin tối thiểu đủ để đặt lịch, mã BHYT chỉ là khai báo. |

## Quyền

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-04** | Ba actor là bệnh nhân, bác sĩ, nhân viên bệnh viện; mỗi tài khoản nhân viên chỉ thao tác theo quyền tác vụ và khoa/phòng được gán. |

## Tra cứu

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-05** | Khách xem khoa, bác sĩ, dịch vụ, lịch còn chỗ, giá và hướng dẫn cơ bản trước đăng nhập. |

## Điều hành

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-06** | Quản trị quản lý ca/phòng/capacity tại Appointment, giá hiệu lực tại Catalog và quyền nhân viên tại Identity; danh mục gốc seed có version. |

## Đặt lịch

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-07** | Bệnh nhân chọn hồ sơ, dịch vụ, bác sĩ/khung giờ và giữ chỗ có hạn; hệ thống xác nhận sau khi phí khám đủ điều kiện. |
| **BR-08** | Hệ thống không vượt sức chứa slot, không đặt trùng giờ cùng hồ sơ và giải phóng hold hết hạn đúng một lần. |

## Lịch hẹn

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-09** | Bệnh nhân xem lịch, chi tiết, mã hẹn, trạng thái phí và bước tiếp theo trên web/Android. |

## Đổi lịch

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-10** | Bệnh nhân đổi lịch hợp lệ sang slot mới; nếu đổi lỗi, lịch và phí cũ vẫn nguyên vẹn. |

## Hủy lịch

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-11** | Bệnh nhân hủy lịch hợp lệ có lý do; lịch và trạng thái hoàn tiền được theo dõi riêng. |

## Tại quầy

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-12** | Lễ tân tìm/tạo hồ sơ thuộc tài khoản đã xác minh bằng account projection hoặc proof từ Identity do bệnh nhân trình; không tạo hồ sơ vô chủ, không gọi chuỗi service trong request. |

## Tiếp nhận

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-13** | Lễ tân xác minh lịch và phí, check-in đúng ngày, cấp một vé hàng chờ; có gọi lượt và xử lý vắng mặt có lý do. |

## Khám

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-14** | Bác sĩ chỉ nhận lượt đã check-in/gọi phù hợp; ghi triệu chứng, khám, nhận định và chẩn đoán nháp. |
| **BR-15** | Bác sĩ tạo chỉ định LAB từ lượt khám đang mở; order gắn đúng visit và có phiếu phí riêng. |
| **BR-20** | Bác sĩ chờ kết quả và tiếp tục cùng một visit khi bệnh nhân quay lại; không thu phí khám mới cho lượt RETURN. |
| **BR-21** | Bác sĩ chỉ ký kết luận khi mọi order LAB đã hoàn tất/công bố hoặc hủy hợp lệ; lưu bản cuối và vết người ký. |

## LAB

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-16** | Kỹ thuật viên chỉ tiếp nhận/lấy mẫu sau khi phí LAB hợp lệ; có mã mẫu và nhật ký thời điểm/người thao tác. |
| **BR-17** | Mẫu không đạt được từ chối kèm lý do và lấy lại không thu phí LAB lần nữa. |
| **BR-18** | Kỹ thuật viên nhập kết quả nháp; người có quyền duyệt được trả sửa hoặc công bố; nháp không lộ cho bệnh nhân. |
| **BR-19** | Bác sĩ hủy order LAB trước bất kỳ lần lấy mẫu/thực hiện nào; phí chưa thu vô hiệu, phí đã thu chưa dùng có căn cứ hoàn. |

## Toa thuốc

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-22** | Bác sĩ tạo, sửa hoặc xóa toa nháp trước ký; toa cuối đã ký không sửa trực tiếp và chỉ bản cuối mới đi nhà thuốc. |

## Nhà thuốc

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-23** | Dược sĩ xem toa cuối, tồn khả dụng, nhập bổ sung và giữ đủ toàn toa; thiếu bất kỳ dòng nào thì không giữ một phần. |
| **BR-24** | Hold thuốc HELD chưa khóa thu có thể nhả/giữ lại; nguồn SETTLEMENT\_LOCKED phải đối soát Billing trước nhả. Thu thành công chốt COMMITTED, chỉ phát đúng một lần theo toa FINAL. |

## Thu phí

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-25** | Owner nguồn ghi snapshot và RequestCharge; Billing tạo duy nhất một phiếu theo source/revision rồi trả ChargePrepared. Chưa đồng bộ phải hiển thị chờ tạo phí. |
| **BR-26** | Thu mô phỏng online/tại quầy trả trạng thái đang xử lý; chỉ sau khi nguồn khóa settlement đúng fence mới thu thành công và cấp biên nhận, chống lặp. |

## Hoàn tiền

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-27** | Thu ngân xử lý hoàn đủ khoản đã thu chưa sử dụng theo căn cứ hủy hợp lệ; kết quả hoàn có trạng thái riêng và không vượt số thu. |

## Thông báo

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-28** | Thông báo trong ứng dụng cho xác nhận/đổi/hủy/hết hạn lịch, kết quả, thu/hoàn và thuốc đã phát; không chứa chi tiết y tế nhạy cảm. |

## Hồ sơ sức khỏe

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-29** | Người bệnh xem lượt khám, kết quả đã công bố, toa cuối, phiếu và thu/hoàn theo đúng hồ sơ. |

## Quản trị

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-30** | STAFF[ADMIN] quản lý quyền tác vụ và xem audit thay đổi quyền/đăng nhập tại Identity; audit nghiệp vụ khác được lưu ở service sở hữu. |

## Vận hành

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-31** | Web có giao diện cho đúng ba actor: bệnh nhân, bác sĩ và nhân viên bệnh viện; menu nhân viên được lọc theo quyền tác vụ. |
| **BR-33** | Cả web và Android dùng cùng API, cùng trạng thái server; loading, lỗi, pending và thử lại được hiển thị đúng. |

## Android

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-32** | Android là ứng dụng bệnh nhân gọn: tài khoản, tra cứu/đặt/đổi/hủy lịch, theo dõi tiền và xem bản đã công bố. |

## Báo cáo

| **Mã** | **Yêu cầu** |
| --- | --- |
| **BR-34** | Quản trị xem lượt đặt/hủy/khám COMPLETED từ Appointment và thu/hoàn từ Billing theo ngày nghiệp vụ Việt Nam; nguồn chưa đồng bộ phải được ghi rõ. |

# 7 Quy tắc nghiệp vụ

| **Mã** | **Quy tắc** |
| --- | --- |
| **RL-01** | Số điện thoại là duy nhất; OTP 6 số, hiệu lực 5 phút, tối đa 5 lần sai và 3 lần gửi lại/giờ theo từng mục đích. |
| **RL-02** | Đổi/đặt lại mật khẩu thu hồi phiên cũ; OTP đăng ký và OTP reset không dùng thay nhau. |
| **RL-03** | Mỗi owner kiểm role/scope và quyền hồ sơ từ dữ liệu gốc hoặc projection có version; lệnh nhạy cảm cần authorization lease ký có hạn 30 giây. Không tin patientId/role từ client. |
| **RL-04** | Slot chỉ được giữ nếu còn capacity; mỗi hồ sơ không có hai lịch hoạt động trùng giờ. Hold 10 phút theo giờ server; khi hết hạn thì trả chỗ. Payment đến sau EXPIRED không xác nhận lịch và phải tạo căn cứ hoàn nếu đã thu. |
| **RL-05** | Lịch ONLINE được đổi/hủy khi chưa check-in và còn ít nhất 2 giờ; đổi tại chỗ chỉ cùng bác sĩ và mức giá. Trường hợp khác dùng hủy + đặt mới với hoàn cũ hiển thị riêng. |
| **RL-06** | Đổi slot phải giành chỗ mới trước khi trả chỗ cũ; lỗi hoặc timeout không làm mất lịch cũ. |
| **RL-07** | Hủy lịch đã thu không đồng nghĩa hoàn tiền đã thành công; khoản hoàn phải có căn cứ, mã nguồn, trạng thái và chống lặp. |
| **RL-08** | Check-in đúng ngày, chưa hủy/hết hạn và đủ phí; mỗi appointment tối đa một visit và một vé FIRST. |
| **RL-09** | Một order LAB chỉ được hủy trước bất kỳ lần lấy mẫu/thực hiện; mẫu REJECTED vẫn là đã từng lấy mẫu. |
| **RL-10** | Mẫu không đạt được lấy lại trong cùng order, không thu phí LAB lần nữa; chỉ kết quả PUBLISHED được bệnh nhân xem. |
| **RL-11** | Visit có LAB chỉ ký khi mọi order đã PUBLISHED hoặc CANCELLED hợp lệ; RETURN tiếp tục cùng visit và không tạo phí khám mới. |
| **RL-12** | Toa DRAFT sửa/xóa được trước ký; toa FINAL có revision và không sửa trực tiếp. Nhà thuốc chỉ cấp theo bản FINAL. |
| **RL-13** | Giữ thuốc toàn toa 15 phút; thiếu một dòng thì không giữ phần còn lại. SETTLEMENT\_LOCKED/COMMITTED không được nhả; attempt cũ không chốt lần giữ mới. |
| **RL-14** | Mỗi source revision một charge; saga khóa nguồn qua RabbitMQ, at-least-once và dedupe mọi message; pending không đồng nghĩa thành công. Hoàn/phát có unique constraint bền vững. |
| **RL-15** | Không dùng dữ liệu bệnh nhân thật, không trả OTP qua API, không ghi dữ liệu y tế/định danh đầy đủ vào log. |
| **RL-16** | Mỗi dịch vụ sở hữu một DB logic; truy cập liên dịch vụ bằng API hoặc sự kiện, không JOIN/ghi DB của owner khác. |

# 8 Kiến trúc và phân công ba service mỗi người

| **Người** | **Ba service sở hữu** | **Đầu ra và tích hợp** |
| --- | --- | --- |
| Huy | Catalog · Clinical · Diagnostic | Danh mục y tế và giá; web bác sĩ/LAB; registry chỉ định và ký; producer CatalogChanged. |
| Quân | Patient · Appointment · Pharmacy | Hồ sơ, lịch/tiếp nhận và dược; tranh slot/tồn; phối hợp màn hình bệnh nhân và Android. |
| Hưng | Identity · Billing · Notification | Auth/Android nền; saga thu/hoàn và hộp thư; Gateway, RabbitMQ và Redis cấu hình dùng chung. |

Đúng 3 service/người là cách phân công, không phải tiêu chí chứng minh microservice. Theo [S1] PDF 44–46, 51 và [S2] slide 23–24, ranh giới đi theo năng lực nghiệp vụ, tính gắn kết và dữ liệu riêng. Một context có thể có nhiều tiến trình; trong demo, mỗi context có một API cùng consumer/publisher trong cùng service. Monorepo được phép nhưng build/deploy/migration riêng và không import domain/entity/repository của service khác.

## Đối chiếu ranh giới với sách

| **Service và owner** | **Context và dữ liệu gốc** | **Cách tổ chức bên trong** |
| --- | --- | --- |
| Identity · Hưng | Xác thực, phiên, capability và authorization lease; PostgreSQL | CRUD có chính sách bảo mật |
| Patient · Quân | Hồ sơ hành chính và quyền quản lý hồ sơ; MongoDB | CRUD và audit |
| Catalog · Huy | Danh mục tham chiếu, định nghĩa test/thuốc và giá version; PostgreSQL | CRUD có version và cache |
| Appointment · Quân | Ca, slot, giữ chỗ, hẹn và hàng chờ; MongoDB | DDD và CQRS đơn giản |
| Clinical · Huy | Lượt khám, registry chỉ định, bệnh án và toa ký; PostgreSQL | DDD và CQRS đơn giản |
| Diagnostic · Huy | Order LAB, mẫu, bản kết quả và duyệt; PostgreSQL | DDD và CQRS đơn giản |
| Pharmacy · Quân | Tồn tổng, giữ toàn toa và cấp phát; MongoDB | DDD và CQRS đơn giản |
| Billing · Hưng | Phiếu phí, thu/hoàn và saga thanh toán; PostgreSQL | DDD và process manager |
| Notification · Hưng | Thông báo trong ứng dụng và trạng thái đã đọc; PostgreSQL | Consumer và read model |

Catalog là context tham chiếu được chấp nhận trong phạm vi đồ án: khoa, hồ sơ nghề nghiệp bác sĩ, định nghĩa dịch vụ/test/thuốc và giá. Catalog không được trở thành nơi chứa lịch, tồn, bệnh án hay thanh toán. User của Identity, Patient của hồ sơ và Doctor của Catalog là ba mô hình khác nhau, chỉ liên kết định danh. Clinical quyết định chỉ định/kết luận; Diagnostic quyết định thực hiện LAB; Pharmacy quyết định giữ/phát; Billing quyết định thu/hoàn. Nếu hai service bắt buộc chia sẻ một transaction hoặc sửa schema cùng nhau thường xuyên, phải xem lại ranh giới.

## Ánh xạ eCommerce sang khám ngoại trú

| **Ý tưởng từ eShop** | **Áp dụng vào UMC Care** | **Điều chỉnh theo miền y tế** |
| --- | --- | --- |
| Catalog | Catalog và projection danh mục/giá | Giá chụp theo thời điểm; định nghĩa test khác kết quả xét nghiệm. |
| Basket dùng Redis | Cache danh mục và slot tham khảo | Giữ chỗ khám/thuốc không được mất khi Redis bị xóa; lưu MongoDB. |
| Ordering và workflow | Appointment và saga thu tại Billing | Lượt khám không phải đơn mua hàng; visit và LAB có trạng thái riêng. |
| Identity và Buyer projection | Identity và access projection tối thiểu | Owner patientId do Patient phát; không coi userId là patientId. |
| Integration event bus | RabbitMQ, outbox/inbox và read model | Nháp y tế không phát cho bệnh nhân; không đưa bệnh án vào Notification. |
| DDD CQRS ở Ordering | Appointment Clinical Diagnostic Pharmacy Billing | Tách command/query logic trong cùng DB; service CRUD dùng kiến trúc đơn giản. |

[S1] PDF 111–115, 147–149, 198–211; [S2] slide 4, 22, 56–62. Đây là ánh xạ thiết kế cho đồ án, không phải eShop có sẵn mô hình bệnh viện. Sách và sample không bảo đảm một thiết kế là hoàn hảo hoặc sẵn sàng vận hành thật.

Baseline có 86 operation HTTP: 83 endpoint client/tác vụ đi Gateway và 3 adapter phục hồi IA-014 DI-001 BI-001 chỉ mạng nội bộ, tắt trong profile chuẩn; loại 10 API nội bộ IN-01..IN-10 của bản 3.0. Giao tiếp chuẩn giữa service bằng 18 integration event và 5 command RabbitMQ. Không có yêu cầu số API phải chia đều theo số service.

# 9 Tiêu chí nghiệm thu

| **Mã** | **Kịch bản đạt** |
| --- | --- |
| **BAC-01** | Đăng ký → OTP → login, quên/đổi mật khẩu chạy trên web và Android; OTP sai/hết hạn/replay không tạo quyền. |
| **BAC-02** | Cùng tài khoản tạo hồ sơ bản thân/người thân; truy cập hồ sơ khác bị 403; nhân viên chỉ thấy phạm vi được gán. |
| **BAC-03** | Hai người tranh chỗ cuối: chỉ một hold/booking thành công; hold hết hạn trả chỗ; tiền đến muộn không xác nhận lịch đã EXPIRED và có đường hoàn; retry không thu lặp. |
| **BAC-04** | Đổi lịch hợp lệ giữ slot mới rồi trả slot cũ; lỗi hoặc timeout vẫn giữ lịch cũ. Hủy có căn cứ và trạng thái hoàn riêng. |
| **BAC-05** | Lễ tân đặt cho hồ sơ thuộc tài khoản hợp lệ, check-in/gọi/start một lần; lịch hủy/hết hạn hoặc chưa đủ phí không check-in; vé vắng mặt có lý do. |
| **BAC-06** | Khám không LAB: bác sĩ sửa/xóa toa nháp, ký kết luận; người bệnh chỉ xem bản cuối. |
| **BAC-07** | Khám có LAB: thu phí → lấy mẫu → từ chối/lấy lại → nháp/trả sửa/duyệt/công bố → RETURN cùng visit → ký. |
| **BAC-08** | Hủy LAB trước mẫu: phiếu chưa thu vô hiệu hoặc phí đã thu chưa dùng tạo hoàn; sau mẫu không hủy được. |
| **BAC-09** | Thiếu thuốc không giữ một phần; nhập bổ sung, giữ lại toàn toa, thu và phát một lần; nhả hold chưa thu đúng trạng thái. |
| **BAC-10** | Web đủ ba actor và các module nhân viên theo quyền; Android đủ luồng bệnh nhân; trạng thái server giống nhau trên hai nền tảng. |
| **BAC-11** | Một Mongo replica set chứa ba DB logic và một PostgreSQL chứa sáu DB logic; service không ghi DB của nhau; event lặp/restart không lặp lịch, tiền, mẫu hoặc phát thuốc. |
| **BAC-12** | Compose dựng đủ Gateway, web, 9 service, Mongo replica set, PostgreSQL, RabbitMQ, Redis và seed. Có bằng chứng 18 event/5 command, outbox/inbox, retry và cache fallback. |

# 10 Ràng buộc, giả định và rủi ro

| **Loại** | **Nội dung** |
| --- | --- |
| **Thời gian** | Hạn 23/11/2026. Cần chốt API/event và dữ liệu seed trước khi chia code; tích hợp liên tục từ tuần đầu. |
| **Dữ liệu** | Một Mongo replica set chứa ba DB logic và một PostgreSQL chứa sáu DB logic; mỗi service chỉ ghi DB của mình. Mọi hồ sơ đều giả. |
| **Thanh toán** | Adapter mô phỏng có trạng thái, biên nhận và hoàn; không chuyển tiền thật. |
| **BHYT** | Chỉ lưu khai báo tùy chọn; không tính quyền lợi/đồng chi trả tự động. |
| **Rủi ro lớn** | 9 service và 2 client vẫn là phạm vi rộng cho 3 người; chia đều số lượng không chia đều độ khó. Chốt luồng chính, projection, command/event và test lỗi trước khi làm giao diện phụ. |
| **Kiểm soát** | Gate E2E hàng tuần, test tranh chỗ/thu/hoàn/mẫu/tồn; mọi mục BAC phải có ảnh/log/expected–actual. |

# 11 Nguồn và phê duyệt

Nguồn xây dựng: bốn tài liệu UMC Care v4 do nhóm cung cấp và hai tài liệu học phần microservice [S1] [S2]. Bản 5.0 chốt 9 service, phân công 3 người và hợp đồng dữ liệu/API đồng bộ.

| **Vai trò** | **Người duyệt** | **Ngày / quyết định** |
| --- | --- | --- |
| **Đại diện nhóm** | Huy |  |
| **Thành viên** | Quân |  |
| **Thành viên** | Hưng |  |
| **Giảng viên hướng dẫn** |  |  |

# 12 Đánh giá tổng thể sau áp dụng kiến trúc trong sách

Kết luận: 9 service hợp lý cho đồ án khám ngoại trú khi thực thi quyền sở hữu dữ liệu, giao tiếp bất đồng bộ và invariant cục bộ. Số service hay số công nghệ không tự chứng minh chất lượng. Các bảng sau đánh giá thiết kế và rủi ro cần kiểm chứng, không gán điểm vận hành khi chưa chạy mã nguồn.

| **Khía cạnh** | **Nhận định** | **Điều kiện cần kiểm chứng** |
| --- | --- | --- |
| Ranh giới | Phù hợp có điều kiện | 9 năng lực rõ; Catalog chỉ tham chiếu, không chứa vận hành. Dữ liệu riêng và không import domain chéo mới chứng minh tự trị. |
| Chia người | Đạt 3–3–3 | Huy Catalog/Clinical/Diagnostic; Quân Patient/Appointment/Pharmacy; Hưng Identity/Billing/Notification. Cần review vì độ khó không bằng nhau. |
| Giao tiếp | Đã chuyển async | Loại chuỗi HTTP bản 3.0; 202 + polling, projection và 5 command. Adapter phục hồi không vào luồng chính. |
| RabbitMQ | Có thiết kế vận hành | Confirm khác ack; inbox mọi message; retry DB bền vững, DLQ, ACL exchange và correlation/causation. |
| Redis | Có vai trò cụ thể | Cache Catalog 60 giây, slot 3 giây; mất cache không mất lịch/tiền/tồn. Không dùng Redis lock làm hàng rào duy nhất. |
| Tính nhất quán | Ưu tiên invariant | ACID cục bộ, saga/fence và compensation xuyên service; pending khi chưa có bằng chứng. Không dùng CAP để biện minh thu sai. |
| DDD CQRS | Áp dụng chọn lọc | 5 context phức tạp; CRUD gọn cho context đơn giản. Không bắt buộc event sourcing, đọc DB riêng hay framework .NET. |
| Lịch và hàng chờ | Cần test cạnh tranh | Patient interval lock, capacity, giữ/đổi nguyên tử; claim ticket async; FIRST/RETURN và kết thúc lịch theo event. |
| Clinical và LAB | Cần test hai pha | Registry pending chặn ký; order tạo từ command; contributor khác reviewer; nháp không lộ; hủy tranh lấy mẫu. |
| Dược | Phạm vi tồn tổng | Toa FINAL, hold toàn toa, attempt/fence; chưa có lô/hạn dùng, FEFO hay thuốc kiểm soát. |
| Tiền và hoàn | Rủi ro cao nhất | Saga durable, quyết định terminal và tombstone cho reserve đến muộn; không receipt khi PENDING; hoàn không vượt đã thu. |
| Quyền và riêng tư | Có giới hạn minh bạch | Projection tối thiểu; lease 30 giây nên có cửa sổ thu hồi hữu hạn. Không phát OTP/mật khẩu/bệnh án vào broker hoặc cache. |
| Vận hành | Đủ cho demo có đo | Health tách live/ready, backlog metrics, volumes, backup/restore; Compose một node không là HA. |
| Khả thi | Khá nặng | 3 người × khoảng 5,5 tuần ×20–24h ≈330–396h; dành 25% tích hợp còn 248–297h xây tính năng. Ước lượng, chưa đo năng suất. |
| Bằng chứng | Chưa có mã nguồn chạy | Tài liệu mô tả quyết định thiết kế, không xác nhận tính đúng hay hiệu năng đã đạt. Cần E2E và test crash/duplicate/partition. |

# 13 Lộ trình và trách nhiệm tích hợp

| **Mốc** | **Kết quả cần đạt** | **Người phối hợp** |
| --- | --- | --- |
| 15–18/10 | Chốt schemas 18 event/5 command, ownership, seed projection và Compose | Cả nhóm; Hưng hạ tầng, Huy danh mục, Quân dữ liệu seed |
| 19–25/10 | Login hồ sơ danh mục, hold và RequestCharge chạy xuyên service | Quân và Hưng; Huy Catalog |
| 26/10–01/11 | Saga thanh toán, claim ticket, khám không LAB và VisitSigned | Hưng và Huy; Quân Appointment |
| 02–08/11 | LAB command/result/rework/RETURN; Pharmacy projection và giữ thuốc | Huy và Quân; Hưng tiền |
| 09–15/11 | Android, Notification, Redis cache, ACL và observability | Hưng chủ tích hợp; cả nhóm UI/test |
| 16–20/11 | Fault injection, test cạnh tranh, backup restore, sửa lỗi | Cả nhóm review chéo |
| 21–23/11 | Đóng tính năng, đối chiếu code/tài liệu và kịch bản bảo vệ | Cả nhóm |

Ưu tiên P0: transaction và saga đúng; P1: async E2E, quyền và phục hồi; P2: cache/performance và hoàn thiện UI. Không bổ sung Kubernetes, service mesh, Kafka, event sourcing hoặc tách thêm BFF trong baseline. Các công nghệ đó chỉ xem xét khi có nhu cầu đo được.

# 14 Tiêu chí nghiệm thu bổ sung

| **Mã** | **Bằng chứng bắt buộc** |
| --- | --- |
| BAC-13 | Catalog version và projection đúng owner; đổi giá không sửa charge lịch sử. |
| BAC-14 | Thu tiền tranh expiry/hủy lịch hoặc thuốc: chỉ một kết quả hợp lệ, không thu tiền khi nguồn không thể khóa. |
| BAC-15 | VisitReturnReady tạo một RETURN; VisitSigned chuyển COMPLETED; replay/đảo thứ tự không làm lùi trạng thái. |
| BAC-16 | Notification dừng không chặn Billing; restart tạo đúng một thông báo cho recipient/message/kind. |
| BAC-17 | JWT cũ không vượt quyền hoặc lease đã hết 30 giây; role/owner giả bị từ chối. |
| BAC-18 | Tạo LAB tranh ký, hủy tranh lấy mẫu, hoàn song song và phát lặp giữ nguyên invariant. |
| BAC-19 | Mỗi người đúng 3 service; từng service build/migrate/test/deploy riêng; sửa một service không cần build lại 8 service còn lại. |
| BAC-20 | Dừng Diagnostic/Billing khi tạo LAB/phí: owner trả 202 và giữ request; khởi động lại hoàn tất đúng một lần, không chặn HTTP nối tiếp. |
| BAC-21 | Hai bản publish mới cùng messageId với redelivered=false vẫn chỉ tạo một hiệu ứng nghiệp vụ. |
| BAC-22 | Tắt/flush Redis: mất cache chỉ tăng latency đọc; booking đã giữ, tiền, mẫu và tồn vẫn đúng; không oversell với slot cache cũ. |
| BAC-23 | Crash trước publish, sau confirm trước mark, sau DB consumer commit trước ack; outbox/inbox phục hồi không tạo charge/receipt/dispense đôi. |
| BAC-24 | Settlement FAILED đến trước ReserveSettlement bị ghi tombstone; reserve đến muộn không khóa lại. UNKNOWN hoặc broker dừng không tự nhả nguồn đang khóa. |
| BAC-25 | Bootstrap/replay projection có checksum/version; thiếu quyền hoặc checkpoint giá cũ chặn write; không đọc DB owner khác. |
| BAC-26 | Thu hồi quyền được áp dụng trong cửa sổ lease tối đa 30 giây; sau hết hạn lease cũ không dùng cho lệnh nhạy cảm, kể cả event quyền đến trễ. |
| BAC-27 | Retry tối đa 3 lần qua retry\_jobs; schema sai vào quarantine/DLQ; không requeue nóng, ack trước commit hay xóa queue để sửa demo. |

# 15 Quyết định áp dụng sách và giới hạn

| **Chủ đề** | **Nguồn** | **Quyết định của đồ án** |
| --- | --- | --- |
| Ranh giới nghiệp vụ và dữ liệu riêng | [S1] PDF 42–46; [S2] slide 18–24 | 9 context logic và 9 DB; phân công 3 người độc lập với ranh giới. |
| Tự trị và tránh chuỗi HTTP | [S1] PDF 50–51 và 65–66; [S2] slide 30–31, 40 | REST từ client qua Gateway; AMQP cho liên service, read model cục bộ. |
| eShopOnContainers | [S1] PDF 111–115; [S2] slide 4 | Gateway, event bus, database per service; không sao chép miền giỏ hàng sang bệnh án. |
| Redis và dữ liệu tạm | [S1] PDF 147–148; [S2] slide 22 | Cache danh mục và slot tham khảo; giữ chỗ/tiền/tồn vẫn là dữ liệu bền vững. |
| Event bus và outbox | [S1] PDF 148–160; [S2] slide 50–53 | 18 event và 5 command; state + outbox cùng transaction. |
| Idempotency và bản tin cũ | [S1] PDF 164–166; [S2] slide 54 | Inbox mọi message, domain unique, version và fence; không chỉ dựa redelivered. |
| DDD và CQRS đơn giản | [S1] PDF 198–211; [S2] slide 56–62 | Command/domain/query tách logic, cùng DB owner; domain không import broker/ORM. |
| Khả năng phục hồi và health | [S1] PDF 311–330; [S2] slide 64–66 | Timeout, backoff có giới hạn, bulkhead, liveness/readiness và kiểm thử lỗi. |
| Bảo mật và secret | [S2] slide 67–68 | JWT/lease, quyền tại owner, ACL broker/Redis, secret ngoài source. |

Giữ 9 service và hai nền tảng: 86 HTTP operation, 18 event, 5 command. Redis chỉ là cache; dữ liệu giả, một cơ sở và một vòng RETURN. [S1] [S2] là tài liệu đối chiếu nguyên tắc microservice cho thiết kế này.

# Nguồn và cách dẫn chiếu

[S1] Microsoft. .NET Microservices Architecture for Containerized .NET Applications, edition v7.0, bản PDF người dùng cung cấp gồm 351 trang. Trong tài liệu này số PDF là số trang vật lý tính từ 1; từ PDF 16 trở đi số in trong sách thường bằng PDF trừ 15. Ví dụ PDF 111 tương ứng trang in 96.

[S2] Kiến trúc Microservice với .NET và Docker, bộ bài giảng 69 slide do người dùng cung cấp, dựa trên [S1]. Số slide bằng số trang PDF vật lý.

[R1] RabbitMQ acknowledgements và confirms: https://www.rabbitmq.com/docs/confirms; [R2] quorum queues: https://www.rabbitmq.com/docs/quorum-queues; [R3] Redis eviction và persistence: https://redis.io/docs/ (đối chiếu 15/10/2026).