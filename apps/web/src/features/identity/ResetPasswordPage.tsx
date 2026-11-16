import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { AuthIntro } from './AuthIntro';
import { OtpField } from './OtpField';
import './login.css';

export function ResetPasswordPage() {
  const { state } = useLocation();
  const phone = state?.phone;

  if (typeof phone !== 'string' || !/^\d{9,11}$/.test(phone)) {
    return <Navigate to="/forgot-password" replace />;
  }

  return <ResetPasswordForm key={phone} phone={phone} />;
}

function ResetPasswordForm({ phone }: { phone: string }) {
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [changed, setChanged] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    if (!/^\d{6}$/.test(otp)) {
      setError('Vui lòng nhập mã xác thực gồm 6 chữ số.');
      return;
    }

    const passwordLength = Array.from(newPassword).length;
    if (passwordLength < 8 || passwordLength > 128) {
      setError('Mật khẩu phải có từ 8 đến 128 ký tự.');
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/v1/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otpCode: otp, newPassword }),
      });
      const result = await response.json();

      if (response.ok && result?.data?.changed === true) {
        setOtp('');
        setNewPassword('');
        setChanged(true);
        return;
      }

      if (result?.error?.code === 'OTP_EXPIRED') {
        setError('Mã đã hết hạn. Hãy quay lại để yêu cầu mã mới.');
      } else if (result?.error?.code === 'OTP_ALREADY_USED') {
        setError('Mã đã được sử dụng. Hãy quay lại để yêu cầu mã mới.');
      } else if (response.status === 429) {
        setError('Đã vượt quá giới hạn thử. Vui lòng thử lại sau.');
      } else if (response.status === 400) {
        setError('Không xác thực được mã. Kiểm tra mã hoặc yêu cầu mã mới.');
      } else {
        throw new Error('Unexpected password reset response');
      }
    } catch {
      setError('Chưa thể xác nhận kết quả đặt lại mật khẩu. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <AuthIntro />

      <section className="login-form-panel" aria-labelledby="reset-title">
        <div className="login-form-wrapper">
          <h2 id="reset-title">
            {changed ? 'Đặt lại mật khẩu thành công' : 'Đặt lại mật khẩu'}
          </h2>
          {changed ? (
            <>
              <p className="login-notice" role="status">
                Bạn có thể đăng nhập bằng mật khẩu mới.
              </p>
              <Link className="login-text-button" to="/login" replace>
                Quay lại đăng nhập
              </Link>
            </>
          ) : (
            <>
              <p className="login-subtitle">
                Nếu số điện thoại đã đăng ký, hãy kiểm tra email liên kết để lấy
                mã.
              </p>

              <form onSubmit={handleSubmit} noValidate>
                <fieldset
                  className="reset-password-fields"
                  disabled={isSubmitting}
                >
                  <OtpField id="reset-otp" value={otp} onChange={setOtp} />

                  <div className="login-field">
                    <label htmlFor="reset-new-password">
                      Mật khẩu mới{' '}
                      <span className="required-mark" aria-hidden="true">
                        *
                      </span>
                    </label>

                    <div className="login-password-field">
                      <input
                        id="reset-new-password"
                        name="newPassword"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="Từ 8 đến 128 ký tự"
                        required
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                      />

                      <button
                        className="login-password-toggle"
                        type="button"
                        aria-label={
                          showPassword ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'
                        }
                        onClick={() => setShowPassword((current) => !current)}
                      >
                        {showPassword ? (
                          <Eye size={18} aria-hidden="true" />
                        ) : (
                          <EyeOff size={18} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <p className="login-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="login-submit" type="submit">
                    {isSubmitting ? 'Đang đặt lại…' : 'Đặt lại mật khẩu'}
                  </button>
                </fieldset>
              </form>

              <div className="login-register">
                <Link className="login-text-button" to="/forgot-password">
                  Quay lại bước nhập số điện thoại
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
