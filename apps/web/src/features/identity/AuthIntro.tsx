export function AuthIntro() {
  return (
    <section className="login-intro" aria-label="Giới thiệu HQH Care">
      <div className="login-brand">
        <span aria-hidden="true">✚</span> HQH CARE
      </div>

      <p className="login-brand-caption">CỔNG Y TẾ THÔNG MINH</p>

      <div className="login-intro-content">
        <h1>
          Sức khỏe của bạn,
          <br />
          sự an tâm của chúng tôi.
        </h1>

        <p>
          Kết nối với đội ngũ chuyên gia. Chủ động đặt khám, quản lý hồ sơ và
          theo dõi sức khỏe tại một nơi.
        </p>

        <div className="login-illustration">
          <img src="/images/login-illustration.png" alt="" />
        </div>

        <div className="login-benefits">
          <span>01 &nbsp; Đặt lịch dễ dàng</span>
          <span>02 &nbsp; Hồ sơ luôn bên bạn</span>
        </div>
      </div>

      <p className="login-intro-footer">An tâm chăm sóc · Vững bước mỗi ngày</p>
    </section>
  );
}
