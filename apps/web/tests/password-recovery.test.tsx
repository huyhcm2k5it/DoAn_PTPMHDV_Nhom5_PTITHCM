import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { ForgotPasswordPage } from '../src/features/identity/ForgotPasswordPage';
import { ResetPasswordPage } from '../src/features/identity/ResetPasswordPage';

it('carries the requested phone into reset and confirms only after the API accepts the new password', async () => {
  const request = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ data: { accepted: true } }))
    .mockResolvedValueOnce(
      Response.json({ error: { code: 'OTP_EXPIRED' } }, { status: 409 }),
    )
    .mockResolvedValueOnce(Response.json({ data: { changed: true } }));

  render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/forgot-password/reset" element={<ResetPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  );

  fireEvent.change(screen.getByLabelText(/Số điện thoại/), {
    target: { value: '0912 345 678' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Gửi mã xác thực qua email' }),
  );

  fireEvent.change(await screen.findByLabelText(/Mã xác thực/), {
    target: { value: '123456' },
  });
  fireEvent.change(screen.getByLabelText(/Mật khẩu mới/), {
    target: { value: 'demo-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
  expect((await screen.findByRole('alert')).textContent).toContain('hết hạn');
  expect(request).toHaveBeenNthCalledWith(
    2,
    '/api/v1/auth/password/reset',
    expect.objectContaining({
      body: JSON.stringify({
        phone: '0912345678',
        otpCode: '123456',
        newPassword: 'demo-password',
      }),
    }),
  );

  fireEvent.change(screen.getByLabelText(/Mã xác thực/), {
    target: { value: '654321' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
  await screen.findByRole('heading', { name: 'Đặt lại mật khẩu thành công' });
  expect(
    screen
      .getByRole('link', { name: 'Quay lại đăng nhập' })
      .getAttribute('href'),
  ).toBe('/login');
});
