import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PatientApi, PatientProfile } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';

export function ProfileForm({ api, initial }: { api: PatientApi; initial?: PatientProfile }) {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? '');
  const [relation, setRelation] = useState<'SELF' | 'OTHER'>(initial?.relation ?? 'SELF');
  const [sex, setSex] = useState(initial?.sex ?? '');
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [bhytSelfDeclared, setBhytSelfDeclared] = useState(initial?.bhytSelfDeclared ?? '');
  const [error, setError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError(undefined);
    try {
      const input = { fullName, birthDate, relation, sex, contactPhone, address, bhytSelfDeclared };
      const result = initial
        ? await api.update!(initial.id, { ...input, expectedVersion: initial.version ?? 1 })
        : await api.create!(input);
      navigate(`/patient/profiles/${encodeURIComponent(result.id)}`);
    } catch (caught) { setError(caught); } finally { setSaving(false); }
  }
  return <section className="page-content" aria-labelledby="profile-form-heading">
    <Link className="back-link" to="/patient/profiles">← Danh sách hồ sơ</Link>
    <div className="page-heading"><div><p className="eyebrow">HỒ SƠ BỆNH NHÂN</p><h1 id="profile-form-heading">{initial ? 'Cập nhật hồ sơ' : 'Tạo hồ sơ mới'}</h1></div></div>
    {error != null && <ErrorPanel error={error} />}
    <form className="search-panel" onSubmit={(event) => void submit(event)}>
      <label>Họ và tên<input required minLength={2} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
      <label>Ngày sinh<input required type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>
      <label>Quan hệ<select value={relation} onChange={(event) => setRelation(event.target.value as 'SELF' | 'OTHER')}><option value="SELF">Bản thân</option><option value="OTHER">Người thân</option></select></label>
      <label>Giới tính<input value={sex} onChange={(event) => setSex(event.target.value)} /></label>
      <label>Số điện thoại<input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} /></label>
      <label>Địa chỉ<input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
      <label>BHYT tự khai<input value={bhytSelfDeclared} onChange={(event) => setBhytSelfDeclared(event.target.value)} /></label>
      <button className="button button-primary" disabled={saving} type="submit">{saving ? 'Đang lưu…' : 'Lưu hồ sơ'}</button>
    </form>
  </section>;
}
