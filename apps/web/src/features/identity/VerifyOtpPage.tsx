import { useEffect, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { AuthIntro } from './AuthIntro';
import './login.css';
import { OtpField } from './OtpField';

export function VerifyOtpPage() {
  const { state } = useLocation();
  const phone = state?.phone;
  if (typeof phone !== 'string' || !/^\d{9,11}$/.test(phone)) {
    return <Navigate to="/register" replace />;
  }
  const resendAt = typeof state?.resendAt === 'number' ? state.resendAt : 0;
  return <VerifyOtpForm key={phone} phone={phone} initialResendAt={resendAt} />;
}

function VerifyOtpForm({
  phone,
  initialResendAt,
}: Readonly<{ phone: string; initialResendAt: number }>) {
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<'verify' | 'resend' | null>(null);
  const [verified, setVerified] = useState(false);
  const [resendAt, setResendAt] = useState(initialResendAt);
  const [now, setNow] = useState(Date.now);
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (!secondsLeft || verified) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [now, secondsLeft, verified]);

  async function submit(action: 'verify' | 'resend') {
    if (pending || verified || (action === 'resend' && Date.now() < resendAt))
      return;

    setError('');
    setNotice('');
    if (action === 'verify' && !/^\d{6}$/.test(otp)) {
      setError('Vui lòng nhập mã xác thực gồm 6 chữ số.');
      return;
    }

    setPending(action);
    try {
      const response = await fetch(`/api/v1/auth/otp/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'verify'
            ? { phone, purpose: 'REGISTER', otpCode: otp }
            : { phone, purpose: 'REGISTER' },
        ),
      });
      if (response.status === 429) {
        setError('Đã vượt quá số lần thử. Vui lòng chờ hoặc yêu cầu mã mới.');
        return;
      }
      const result = await response.json();
      if (
        response.ok &&
        action === 'verify' &&
        result?.data?.verified === true
      ) {
        setOtp('');
        setVerified(true);
      } else if (
        response.ok &&
        action === 'resend' &&
        result?.data?.accepted === true
      ) {
        const currentTime = Date.now();
        const wait = result.data.retryAfterSeconds;
        setNow(currentTime);
        setResendAt(
          currentTime +
            (typeof wait === 'number' && wait > 0 ? wait : 60) * 1000,
        );
        setOtp('');
        setNotice('Đã gửi mã mới. Vui lòng kiểm tra email.');
      } else if (
        result?.error?.code === 'OTP_EXPIRED' ||
        result?.error?.code === 'OTP_ALREADY_USED'
      ) {
        setError('Mã đã hết hạn hoặc đã được sử dụng. Hãy yêu cầu mã mới.');
      } else if (result?.error?.code === 'OTP_NOT_RESENDABLE_YET') {
        setError('Chưa hết thời gian chờ gửi lại mã.');
      } else if (result?.error?.code === 'ACCOUNT_NOT_ACTIVATABLE') {
        setError(
          'Không thể xác thực tài khoản này. Hãy thử đăng nhập hoặc quay lại đăng ký.',
        );
      } else if (action === 'verify' && response.status === 400) {
        setError('Không xác thực được mã. Vui lòng kiểm tra mã trong email.');
      } else {
        throw new Error('Unexpected OTP response');
      }
    } catch {
      setError('Chưa thể xử lý yêu cầu. Vui lòng thử lại sau.');
    } finally {
      setPending(null);
    }
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit('verify');
  }

  return (
    <main className="login-page">
      <AuthIntro />

      <section className="login-form-panel">
        <div className="login-form-wrapper">
          <h2>{verified ? 'Đăng ký thành công' : 'Xác thực tài khoản'}</h2>

          {verified ? (
            <>
              <output className="login-notice">
                Tài khoản đã được xác thực.
              </output>
              <div className="login-register">
                <Link className="login-text-button" to="/login" replace>
                  Quay lại đăng nhập
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="login-subtitle">
                Nhập mã xác thực gồm 6 chữ số nhận qua email.
              </p>

              <form onSubmit={handleSubmit} noValidate>
                <fieldset
                  className="reset-password-fields"
                  disabled={pending !== null}
                >
                  <OtpField id="register-otp" value={otp} onChange={setOtp} />
                  <button
                    className="login-text-button"
                    type="button"
                    disabled={secondsLeft > 0}
                    onClick={() => void submit('resend')}
                  >
                    {pending === 'resend'
                      ? 'Đang gửi mã…'
                      : secondsLeft > 0
                        ? `Gửi lại sau ${secondsLeft} giây`
                        : 'Gửi lại mã'}
                  </button>
                  {error && (
                    <p className="login-error" role="alert">
                      {error}
                    </p>
                  )}
                  {notice && <output className="login-notice">{notice}</output>}
                  <button className="login-submit" type="submit">
                    {pending === 'verify'
                      ? 'Đang xác thực…'
                      : 'Xác thực tài khoản'}
                  </button>
                </fieldset>
              </form>

              <div className="login-register">
                <Link className="login-text-button" to="/register">
                  Quay lại đăng ký
                </Link>
              </div>
            </>
          )}

          <div className="login-security">
            <strong>Thông tin của bạn luôn được bảo mật</strong>
            <span>Kết nối an toàn · Quyền riêng tư được ưu tiên</span>
          </div>
        </div>
      </section>
    </main>
  );
}
