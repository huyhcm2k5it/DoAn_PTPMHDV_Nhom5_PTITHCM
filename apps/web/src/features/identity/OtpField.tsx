type OtpFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
};

export function OtpField({ id, value, onChange }: OtpFieldProps) {
  const hintId = `${id}-hint`;

  return (
    <div className="login-field">
      <label htmlFor={id}>
        Mã xác thực{' '}
        <span className="required-mark" aria-hidden="true">
          *
        </span>
      </label>

      <div className="otp-input">
        <input
          id={id}
          className="otp-input-real"
          name="otpCode"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          aria-describedby={hintId}
          value={value}
          onChange={(event) =>
            onChange(event.target.value.replace(/\D/g, '').slice(0, 6))
          }
        />

        <div className="otp-boxes" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span
              className={
                index === value.length ? 'otp-box otp-box-next' : 'otp-box'
              }
              key={index}
            >
              {value[index] ?? ''}
            </span>
          ))}
        </div>
      </div>

      <small id={hintId} className="otp-hint">
        Nhập hoặc dán mã gồm 6 chữ số.
      </small>
    </div>
  );
}
