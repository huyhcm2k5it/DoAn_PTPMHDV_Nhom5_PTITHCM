import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthIntro } from './AuthIntro';
import './login.css';

export function ForgotPasswordPage() {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedPhone = phone.trim().replace(/ /g, '');

    if (!/^\d{9,11}$/.test(normalizedPhone)) {
      setError(
        normalizedPhone
          ? 'Số điện thoại phải gồm từ 9 đến 11 chữ số.'
          : 'Vui lòng nhập số điện thoại.',
      );
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/v1/auth/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizedPhone }),
      });

      if (response.status === 429) {
        setError('Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.');
        return;
      }
      if (!response.ok) throw new Error('Recovery request failed');

      const result = await response.json();
      if (result?.data?.accepted !== true) {
        throw new Error('Unexpected recovery response');
      }

      navigate('/forgot-password/reset', {
        state: { phone: normalizedPhone },
      });
    } catch {
      setError('Chưa thể gửi yêu cầu. Vui lòng thử lại sau.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <AuthIntro />

      <section className="login-form-panel">
        <div className="login-form-wrapper">
          <h2>Quên mật khẩu</h2>
          <p className="login-subtitle">
            Nhập số điện thoại đã đăng ký để nhận mã xác thực qua email.
          </p>

          <form onSubmit={handleSubmit} noValidate>
            <div className="login-field">
              <label htmlFor="forgot-phone">
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
                  id="forgot-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel-national"
                  placeholder="Nhập số điện thoại"
                  required
                  readOnly={isSubmitting}
                  value={phone}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'forgot-phone-error' : undefined}
                  onChange={(event) => {
                    setPhone(event.target.value);
                    setError('');
                  }}
                />
              </div>

              {error && (
                <p id="forgot-phone-error" className="login-error" role="alert">
                  {error}
                </p>
              )}
            </div>

            <button
              className="login-submit"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Đang gửi yêu cầu…' : 'Gửi mã xác thực qua email'}
            </button>
          </form>

          <div className="login-register">
            <Link className="login-text-button" to="/login">
              Quay lại đăng nhập
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
