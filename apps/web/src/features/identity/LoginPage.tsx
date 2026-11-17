import { useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { AuthIntro } from './AuthIntro';
import { Link, useNavigate } from 'react-router-dom';
import { loginUser } from '../../app/runtime';
import './login.css';

export function LoginPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [loginView, setLoginView] = useState<'patient' | 'staff'>('patient');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    // Bỏ khoảng trắng như cách backend đang chuẩn hóa số điện thoại.
    const normalizedPhone = phone.trim().replace(/\s/g, '');

    if (!normalizedPhone || !password) {
      setError('Vui lòng nhập số điện thoại và mật khẩu.');
      setNotice('');
      return;
    }

    if (!/^\d{9,11}$/.test(normalizedPhone)) {
      setError('Số điện thoại phải gồm từ 9 đến 11 chữ số.');
      setNotice('');
      return;
    }

    const passwordLength = Array.from(password).length;
    if (passwordLength < 8 || passwordLength > 128) {
      setError('Mật khẩu phải có từ 8 đến 128 ký tự.');
      setNotice('');
      return;
    }

    setError('');
    setNotice('');
    setIsSubmitting(true);

    try {
      const session = await loginUser(normalizedPhone, password, rememberMe);

      // Phân quyền điều hướng theo quyền thực nhận từ server
      if (session.actorType === 'DOCTOR') {
        navigate('/doctor/clinical');
      } else if (session.actorType === 'STAFF') {
        if (session.capabilities.includes('RECEPTION')) {
          navigate('/staff/reception');
        } else if (session.capabilities.includes('CASHIER')) {
          navigate('/staff/cashier');
        } else if (session.capabilities.includes('PHARMACY')) {
          navigate('/staff/pharmacy');
        } else if (session.capabilities.includes('ADMIN')) {
          navigate('/staff/schedules');
        } else if (
          session.capabilities.some(
            (c) => c === 'LAB_TECH' || c === 'LAB_REVIEW',
          )
        ) {
          navigate('/staff/diagnostic');
        } else {
          setError(
            'Tài khoản nhân viên chưa được cấp quyền truy cập module nào.',
          );
        }
      } else {
        // PATIENT
        navigate('/patient/profiles');
      }
    } catch (err: unknown) {
      const errorObj = err as {
        status?: number;
        code?: string;
        message?: string;
      };
      if (errorObj?.code === 'UNAUTHENTICATED' || errorObj?.status === 401) {
        setError('Số điện thoại hoặc mật khẩu không chính xác.');
      } else if (
        errorObj?.code === 'RATE_LIMITED' ||
        errorObj?.status === 429
      ) {
        setError('Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau.');
      } else if (
        errorObj?.code === 'VALIDATION_ERROR' ||
        errorObj?.status === 400
      ) {
        setError('Thông tin đăng nhập không hợp lệ. Vui lòng kiểm tra lại.');
      } else {
        setError(
          errorObj?.message ||
            'Không thể kết nối đến máy chủ xác thực. Vui lòng thử lại sau.',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <AuthIntro />

      <section className="login-form-panel">
        <div className="login-language">
          <label className="login-language-label" htmlFor="login-language">
            Ngôn ngữ
          </label>

          <select id="login-language" defaultValue="vi">
            <option value="vi">Tiếng Việt</option>
          </select>
        </div>

        <div className="login-form-wrapper">
          <h2>
            {loginView === 'patient'
              ? 'Chào mừng trở lại!'
              : 'Đăng nhập nhân viên'}
          </h2>

          <p className="login-subtitle">
            {loginView === 'patient'
              ? 'Đăng nhập để bắt đầu hành trình chăm sóc sức khỏe.'
              : 'Quyền được cấp từ tài khoản, không chọn quyền khi đăng nhập.'}
          </p>

          <fieldset
            className={`login-view-selector ${
              loginView === 'staff' ? 'is-staff' : ''
            }`}
            aria-label="Loại giao diện đăng nhập"
          >
            <button
              type="button"
              className={loginView === 'patient' ? 'is-active' : ''}
              aria-pressed={loginView === 'patient'}
              onClick={() => {
                setLoginView('patient');
                setError('');
                setNotice('');
              }}
            >
              Bệnh nhân
            </button>

            <button
              type="button"
              className={loginView === 'staff' ? 'is-active' : ''}
              aria-pressed={loginView === 'staff'}
              onClick={() => {
                setLoginView('staff');
                setError('');
                setNotice('');
              }}
            >
              Bác sĩ / Nhân viên y tế
            </button>
          </fieldset>

          <form onSubmit={handleSubmit} noValidate>
            <div className="login-field">
              <label htmlFor="login-phone">
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
                  id="login-phone"
                  name="phone"
                  type="tel"
                  required
                  inputMode="tel"
                  autoComplete="username"
                  placeholder="Nhập số điện thoại"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="login-password">
                Mật khẩu{' '}
                <span className="required-mark" aria-hidden="true">
                  *
                </span>
              </label>

              <div className="login-password-field">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="Nhập mật khẩu"
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

            <div className="login-options">
              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span>Ghi nhớ đăng nhập</span>
              </label>

              <Link className="login-text-button" to="/forgot-password">
                Quên mật khẩu?
              </Link>
            </div>

            {error && (
              <p className="login-error" role="alert">
                {error}
              </p>
            )}

            {notice && (
              <p className="login-notice" role="status">
                {notice}
              </p>
            )}

            <button
              className="login-submit"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập ngay'}{' '}
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <div className="login-register">
            {loginView === 'patient' ? (
              <>
                <span>Chưa có tài khoản? </span>
                <Link className="login-text-button" to="/register">
                  Đăng ký
                </Link>
              </>
            ) : (
              <button
                className="login-text-button"
                type="button"
                onClick={() => {
                  setLoginView('patient');
                  setError('');
                  setNotice('');
                }}
              >
                Quay lại đăng nhập
              </button>
            )}
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
