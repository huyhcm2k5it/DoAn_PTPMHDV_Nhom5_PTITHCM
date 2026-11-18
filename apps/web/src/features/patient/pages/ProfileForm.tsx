import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PatientApi, PatientProfile } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import '../patient.css';

export function ProfileForm({
  api,
  initial,
}: {
  api: PatientApi;
  initial?: PatientProfile;
}) {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? '');
  const [relation, setRelation] = useState<'SELF' | 'OTHER'>(
    initial?.relation ?? 'SELF',
  );
  const [sex, setSex] = useState(initial?.sex ?? '');
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [bhytSelfDeclared, setBhytSelfDeclared] = useState(
    initial?.bhytSelfDeclared ?? '',
  );
  const [error, setError] = useState<unknown>();
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);

    try {
      const input = {
        fullName: fullName.trim(),
        birthDate,
        relation,
        ...(sex ? { sex } : {}),
        contactPhone: contactPhone.trim(),
        address: address.trim(),
        bhytSelfDeclared: bhytSelfDeclared.trim(),
      };

      const result = initial
        ? await api.update!(initial.id, {
            ...input,
            expectedVersion: initial.version ?? 1,
          })
        : await api.create!(input);

      navigate(`/patient/profiles/${encodeURIComponent(result.id)}`);
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="page-content quan-workflow"
      aria-labelledby="profile-form-heading"
    >
      <Link className="back-link" to="/patient/profiles">
        ← Danh sách hồ sơ
      </Link>

      <div style={{ marginTop: '16px' }} className="profile-detail-panel">
        <div className="profile-detail-header">
          <div>
            <p className="eyebrow">HỒ SƠ BỆNH NHÂN</p>
            <h1 id="profile-form-heading" className="profile-detail-title">
              {initial ? 'Cập nhật hồ sơ bệnh nhân' : 'Tạo hồ sơ bệnh nhân mới'}
            </h1>
            <p className="profile-detail-desc">
              {initial
                ? 'Chỉnh sửa thông tin hành chính đã đăng ký trên hồ sơ.'
                : 'Khai báo thông tin chính xác để thuận tiện cho việc thăm khám và lập lịch hẹn.'}
            </p>
          </div>

          {initial && (
            <span className="profile-badge">
              {initial.relation === 'SELF'
                ? 'Hồ sơ mặc định'
                : 'Hồ sơ người thân'}
            </span>
          )}
        </div>

        {error != null && <ErrorPanel error={error} />}

        <form onSubmit={(event) => void submit(event)} noValidate>
          <div className="profile-form-grid">
            <div className="profile-form-field">
              <label htmlFor="form-fullname">
                Họ và tên <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                id="form-fullname"
                required
                minLength={2}
                placeholder="Nguyễn Văn A"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </div>

            <div className="profile-form-field">
              <label htmlFor="form-birthdate">
                Ngày sinh <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                id="form-birthdate"
                required
                type="date"
                value={birthDate}
                onChange={(event) => setBirthDate(event.target.value)}
              />
            </div>

            <div className="profile-form-field">
              <label htmlFor="form-relation">Quan hệ</label>
              <select
                id="form-relation"
                value={relation}
                disabled={Boolean(initial)}
                onChange={(event) =>
                  setRelation(event.target.value as 'SELF' | 'OTHER')
                }
              >
                <option value="SELF">Bản thân</option>
                <option value="OTHER">Người thân</option>
              </select>
            </div>

            <div className="profile-form-field">
              <label htmlFor="form-sex">Giới tính</label>
              <select
                id="form-sex"
                value={sex}
                onChange={(event) => setSex(event.target.value)}
              >
                <option value="">-- Chưa chọn --</option>
                <option value="Nam">Nam</option>
                <option value="Nữ">Nữ</option>
                <option value="Khác">Khác</option>
              </select>
            </div>

            <div className="profile-form-field">
              <label htmlFor="form-phone">Số điện thoại liên hệ</label>
              <input
                id="form-phone"
                type="tel"
                placeholder="0912 345 678"
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
              />
            </div>

            <div className="profile-form-field">
              <label htmlFor="form-bhyt">Mã thẻ BHYT (tự khai)</label>
              <input
                id="form-bhyt"
                type="text"
                placeholder="DN 4 79 1234567890"
                value={bhytSelfDeclared}
                onChange={(event) => setBhytSelfDeclared(event.target.value)}
              />
            </div>

            <div className="profile-form-field is-full">
              <label htmlFor="form-address">Địa chỉ liên hệ</label>
              <input
                id="form-address"
                type="text"
                placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
          </div>

          <div className="profile-form-actions">
            <Link className="button button-secondary" to="/patient/profiles">
              Hủy
            </Link>
            <button
              className="save-profile-btn"
              disabled={saving}
              type="submit"
            >
              {saving ? 'Đang lưu…' : 'Lưu hồ sơ'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
