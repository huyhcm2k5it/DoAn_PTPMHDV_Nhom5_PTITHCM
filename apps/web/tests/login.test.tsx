import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../src/features/identity/LoginPage';
import { clearAuthSession } from '../src/app/runtime';

describe('LoginPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearAuthSession();
  });

  it('validates phone number and password before submitting', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Empty fields
    fireEvent.click(screen.getByRole('button', { name: /Đăng nhập ngay/ }));
    expect(
      screen.getByText('Vui lòng nhập số điện thoại và mật khẩu.'),
    ).toBeTruthy();

    // Invalid phone
    fireEvent.change(screen.getByLabelText(/Số điện thoại/), {
      target: { value: '123' },
    });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Đăng nhập ngay/ }));
    expect(
      screen.getByText('Số điện thoại phải gồm từ 9 đến 11 chữ số.'),
    ).toBeTruthy();

    // Short password (< 8 chars)
    fireEvent.change(screen.getByLabelText(/Số điện thoại/), {
      target: { value: '0912345678' },
    });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Đăng nhập ngay/ }));
    expect(screen.getByText('Mật khẩu phải có từ 8 đến 128 ký tự.')).toBeTruthy();
  });

  it('shows error message on 401 unauthenticated response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Sai mật khẩu' } },
        { status: 401 },
      ),
    );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/Số điện thoại/), {
      target: { value: '0912 345 678' },
    });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Đăng nhập ngay/ }));

    expect(
      await screen.findByText('Số điện thoại hoặc mật khẩu không chính xác.'),
    ).toBeTruthy();
  });

  it('logs in successfully and navigates to role destination', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // POST /api/v1/auth/login
      .mockResolvedValueOnce(
        Response.json({
          data: {
            accessToken: 'mock-access-token',
            refreshToken: 'mock-refresh-token',
            actorType: 'PATIENT',
            expiresInSeconds: 900,
          },
          meta: { correlationId: 'c-1' },
        }),
      )
      // GET /api/v1/auth/session
      .mockResolvedValueOnce(
        Response.json({
          data: {
            userId: 'user-patient-1',
            actorType: 'PATIENT',
            capabilities: [],
            expiresAt: '2026-11-17T20:00:00Z',
          },
          meta: { correlationId: 'c-2' },
        }),
      );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/patient/profiles"
            element={<h1>Hồ sơ của tôi (Patient)</h1>}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/Số điện thoại/), {
      target: { value: '0912 345 678' },
    });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), {
      target: { value: 'valid-password-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Đăng nhập ngay/ }));

    expect(
      await screen.findByRole('heading', { name: 'Hồ sơ của tôi (Patient)' }),
    ).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          phone: '0912345678',
          password: 'valid-password-123',
        }),
      }),
    );
  });
});
