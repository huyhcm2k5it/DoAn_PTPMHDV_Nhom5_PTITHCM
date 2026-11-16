import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { RegisterPage } from '../src/features/identity/RegisterPage';
import { VerifyOtpPage } from '../src/features/identity/VerifyOtpPage';

it('registers, verifies the same phone, and offers a return to login', async () => {
  const request = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      Response.json(
        { data: { status: 'PENDING_VERIFICATION' } },
        { status: 201 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json({ data: { verified: true, status: 'ACTIVE' } }),
    );

  render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register/verify" element={<VerifyOtpPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText(/Số điện thoại/), {
    target: { value: '0912 345 678' },
  });
  fireEvent.change(screen.getByLabelText(/Email nhận mã/), {
    target: { value: 'demo@example.test' },
  });
  fireEvent.change(screen.getByLabelText(/Mật khẩu \*/), {
    target: { value: 'demo-password' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Gửi mã xác thực qua email' }),
  );

  fireEvent.change(await screen.findByLabelText(/Mã xác thực/), {
    target: { value: '123456' },
  });
  expect(
    (screen.getByRole('button', { name: /Gửi lại sau/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Xác thực tài khoản' }));
  await screen.findByRole('heading', { name: 'Đăng ký thành công' });
  expect(request).toHaveBeenNthCalledWith(
    2,
    '/api/v1/auth/otp/verify',
    expect.objectContaining({
      body: JSON.stringify({
        phone: '0912345678',
        purpose: 'REGISTER',
        otpCode: '123456',
      }),
    }),
  );
  expect(
    screen
      .getByRole('link', { name: 'Quay lại đăng nhập' })
      .getAttribute('href'),
  ).toBe('/login');
});
