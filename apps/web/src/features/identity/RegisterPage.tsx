import { useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthIntro } from './AuthIntro';
import './login.css';

export function RegisterPage() {
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedPhone = phone.trim().replace(/ /g, '');
    const normalizedEmail = email.trim();

    if (!normalizedPhone || !normalizedEmail || !password) {
      setError('Vui lòng nhập đầy đủ thông tin.');
      return;
    }

    if (!/^\d{9,11}$/.test(normalizedPhone)) {
      setError('Số điện thoại phải gồm từ 9 đến 11 chữ số.');
      return;
    }

    const emailInput = event.currentTarget.elements.namedItem('email');

    if (emailInput instanceof HTMLInputElement && !emailInput.validity.valid) {
      setError('Email không hợp lệ. Vui lòng kiểm tra lại.');
      return;
    }

    const passwordLength = Array.from(password).length;
    if (passwordLength < 8 || passwordLength > 128) {
      setError('Mật khẩu phải có từ 8 đến 128 ký tự.');
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: normalizedPhone,
          email: normalizedEmail,
          password,
        }),
      });
      const result = await response.json();
      if (result?.error?.code === 'PHONE_ALREADY_REGISTERED') {
        setError('Số điện thoại này đã được đăng ký.');
        return;
      }
      if (response.status === 400) {
        setError('Thông tin đăng ký không hợp lệ. Vui lòng kiểm tra lại.');
        return;
      }
      if (response.status === 429) {
        setError('Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.');
        return;
      }
      if (!response.ok || result?.data?.status !== 'PENDING_VERIFICATION') {
        throw new Error('Registration request failed');
      }
      navigate('/register/verify', {
        state: { phone: normalizedPhone, resendAt: Date.now() + 60_000 },
      });
    } catch {
      setError('Chưa thể gửi mã xác thực. Vui lòng thử lại sau.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <AuthIntro />

      <section className="login-form-panel">
        <div className="login-form-wrapper">
          <h2>Đăng ký tài khoản</h2>

          <p className="login-subtitle">
            Xác thực tài khoản qua email, không gửi OTP qua SMS.
          </p>

          <form onSubmit={handleSubmit} noValidate>
            <div className="login-field">
              <label htmlFor="register-phone">
                Số điện thoại{' '}
                <span className="required-mark" aria-hidden="true">
                  *
                </span>
              </label>

              <div className="login-phone-field">
                <span className="login-phone-prefix" aria-hidden="true">
                  +84
                </span>

                <input
                  id="register-phone"
                  name="phone"
                  type="tel"
                  required
                  readOnly={isSubmitting}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="Nhập số điện thoại"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="register-email">
                Email nhận mã xác thực{' '}
                <span className="required-mark" aria-hidden="true">
                  *
                </span>
              </label>

              <input
                id="register-email"
                name="email"
                type="email"
                required
                readOnly={isSubmitting}
                autoComplete="email"
                placeholder="Nhập email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="login-field">
              <label htmlFor="register-password">
                Mật khẩu{' '}
                <span className="required-mark" aria-hidden="true">
                  *
                </span>
              </label>

              <div className="login-password-field">
                <input
                  id="register-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  readOnly={isSubmitting}
                  autoComplete="new-password"
                  placeholder="Từ 8 đến 128 ký tự"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />

                <button
                  className="login-password-toggle"
                  type="button"
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
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

            <button
              className="login-submit"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Đang gửi mã…' : 'Gửi mã xác thực qua email'}
            </button>
          </form>

          <div className="login-register">
            <Link className="login-text-button" to="/login">
              Quay lại đăng nhập
            </Link>
          </div>

          <div className="login-security">
            <strong>Thông tin của bạn luôn được bảo mật</strong>
            <span>Kết nối an toàn · Quyền riêng tư được ưu tiên</span>
          </div>
        </div>
      </section>
    </main>
  );
}
