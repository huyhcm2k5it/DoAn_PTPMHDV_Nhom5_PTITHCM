import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PatientApi, PatientPage, PatientProfile } from '../types';
import { Loading } from '../../../shared/ui/Loading';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import '../patient.css';

export function ProfileList({
  api,
  initialSelectedId,
}: {
  api: PatientApi;
  initialSelectedId?: string;
}) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    loading: boolean;
    data?: PatientPage;
    error?: unknown;
  }>({ loading: true });

  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId ?? null,
  );
  const [createdProfile, setCreatedProfile] = useState<PatientProfile | null>(
    null,
  );
  const [isCreating, setIsCreating] = useState(false);

  // Form states cho panel bên phải
  const [formData, setFormData] = useState({
    fullName: '',
    birthDate: '',
    relation: 'SELF' as 'SELF' | 'OTHER',
    sex: '',
    contactPhone: '',
    address: '',
    bhytSelfDeclared: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [formError, setFormError] = useState<unknown>(null);

  const activeProfile =
    state.data?.items.find((p) => p.id === selectedId) ??
    (createdProfile?.id === selectedId ? createdProfile : undefined);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState({ loading: true });

    api.list(page, 20, controller.signal).then(
      (data) => {
        if (current) {
          setState({ loading: false, data });
          if (!isCreating) {
            const hasCurrentSelected =
              Boolean(
                selectedId && data.items.some((p) => p.id === selectedId),
              ) ||
              (createdProfile && createdProfile.id === selectedId);

            if (!hasCurrentSelected) {
              if (data.items.length > 0) {
                const defaultProfile =
                  data.items.find((p) => p.relation === 'SELF') ??
                  data.items[0];
                setSelectedId(defaultProfile.id);
              } else {
                setSelectedId(null);
              }
            }
          }
        }
      },
      (error) => {
        if (current && !controller.signal.aborted) {
          setState({ loading: false, error });
        }
      },
    );

    return () => {
      current = false;
      controller.abort();
    };
  }, [api, page, retry, createdProfile]);

  // Xóa feedback khi người dùng chuyển đổi hồ sơ hoặc chế độ form
  useEffect(() => {
    setSaveSuccess('');
    setFormError(null);
  }, [selectedId, isCreating]);

  // Đồng bộ formData khi activeProfile hoặc isCreating thay đổi (không xóa saveSuccess)
  useEffect(() => {
    if (isCreating) {
      setFormData({
        fullName: '',
        birthDate: '',
        relation: 'OTHER',
        sex: '',
        contactPhone: '',
        address: '',
        bhytSelfDeclared: '',
      });
      return;
    }

    if (activeProfile) {
      setFormData({
        fullName: activeProfile.fullName,
        birthDate: activeProfile.birthDate,
        relation: activeProfile.relation,
        sex: activeProfile.sex || '',
        contactPhone: activeProfile.contactPhone || '',
        address: activeProfile.address || '',
        bhytSelfDeclared: activeProfile.bhytSelfDeclared || '',
      });
    }
  }, [selectedId, isCreating, activeProfile]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess('');
    setFormError(null);

    const saveOriginatingMode = isCreating;
    const saveTargetId = activeProfile?.id;

    try {
      if (isCreating) {
        if (!api.create) {
          throw new Error('Chức năng tạo hồ sơ chưa sẵn sàng.');
        }
        const created = await api.create({
          fullName: formData.fullName.trim(),
          birthDate: formData.birthDate,
          relation: formData.relation,
          ...(formData.sex ? { sex: formData.sex } : {}),
          contactPhone: formData.contactPhone.trim(),
          address: formData.address.trim(),
          bhytSelfDeclared: formData.bhytSelfDeclared.trim(),
        });
        setCreatedProfile(created);
        setIsCreating(false);
        setSelectedId(created.id);
        setSaveSuccess('Tạo hồ sơ người thân thành công!');
        setRetry((v) => v + 1);
      } else if (activeProfile) {
        if (!api.update) {
          throw new Error('Chức năng cập nhật hồ sơ chưa sẵn sàng.');
        }
        const updated = await api.update(activeProfile.id, {
          fullName: formData.fullName.trim(),
          birthDate: formData.birthDate,
          ...(formData.sex ? { sex: formData.sex } : {}),
          contactPhone: formData.contactPhone.trim(),
          address: formData.address.trim(),
          bhytSelfDeclared: formData.bhytSelfDeclared.trim(),
          expectedVersion: activeProfile.version ?? 1,
        });

        // Xác nhận trạng thái vẫn khớp trước khi cập nhật
        setState((current) => {
          if (!current.data || isCreating !== saveOriginatingMode) {
            return current;
          }
          const itemExists = current.data.items.some(
            (item) => item.id === saveTargetId,
          );
          if (!itemExists) {
            return current;
          }
          const newItems = current.data.items.map((item) =>
            item.id === updated.id ? { ...item, ...updated } : item,
          );
          return {
            ...current,
            data: { ...current.data, items: newItems },
          };
        });

        if (createdProfile && createdProfile.id === updated.id) {
          setCreatedProfile({ ...createdProfile, ...updated });
        }
        setSaveSuccess('Cập nhật thông tin hồ sơ thành công!');
      }
    } catch (err) {
      setFormError(err);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      className="page-content quan-workflow"
      aria-labelledby="profiles-heading"
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">CHĂM SÓC SỨC KHỎE</p>
          <h1 id="profiles-heading">Hồ sơ của tôi</h1>
          <p>Quản lý hồ sơ bản thân và người thân để đặt lịch khám.</p>
        </div>
        <Link to="/patient/profiles/new" className="button button-primary">
          Tạo hồ sơ mới
        </Link>
      </div>

      {state.loading ? (
        <Loading label="Đang tải hồ sơ" />
      ) : state.error ? (
        <ErrorPanel
          error={state.error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : state.data?.items.length === 0 ? (
        <EmptyState
          title="Bạn chưa có hồ sơ nào"
          description="Hồ sơ được liên kết với tài khoản sẽ xuất hiện tại đây."
        />
      ) : (
        <div className="patient-master-detail">
          {/* CỘT TRÁI: Gia đình của bạn */}
          <aside className="family-panel" aria-label="Danh sách hồ sơ gia đình">
            <h2 className="family-panel-title">Gia đình của bạn</h2>
            <p className="family-panel-subtitle">
              {state.data?.total ?? state.data?.items.length ?? 0} hồ sơ đã liên
              kết
            </p>

            <div className="family-list">
              {state.data?.items.map((profile) => {
                const isSelected = !isCreating && profile.id === selectedId;
                return (
                  <article
                    key={profile.id}
                    className={`family-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => {
                      if (isSaving) return;
                      setIsCreating(false);
                      setSelectedId(profile.id);
                    }}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        if (isSaving) return;
                        setIsCreating(false);
                        setSelectedId(profile.id);
                      }
                    }}
                  >
                    <div className="family-card-name">{profile.fullName}</div>
                    <div className="family-card-meta">
                      {profile.relation === 'SELF'
                        ? 'Chính chủ · Mặc định'
                        : `Người thân · ${profile.birthDate}`}
                    </div>
                    <div className="family-card-sub">
                      {profile.bhytSelfDeclared
                        ? `BHYT: ${profile.bhytSelfDeclared}`
                        : profile.contactPhone
                          ? `SĐT: ${profile.contactPhone}`
                          : 'Chưa cập nhật BHYT'}
                    </div>

                    <div className="quan-actions" style={{ marginTop: '8px' }}>
                      <Link
                        className="text-link"
                        to={`/patient/profiles/${encodeURIComponent(profile.id)}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Xem hồ sơ <span aria-hidden="true">→</span>
                      </Link>
                      {profile.active !== false && (
                        <Link
                          className="text-link"
                          to={
                            '/patient/appointments/new?' +
                            new URLSearchParams({ patientId: profile.id })
                          }
                          onClick={(event) => event.stopPropagation()}
                        >
                          Đặt lịch khám
                        </Link>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            <button
              type="button"
              className="add-family-btn"
              disabled={isSaving}
              onClick={() => {
                if (isSaving) return;
                setIsCreating(true);
                setSelectedId(null);
              }}
            >
              + Thêm hồ sơ người thân
            </button>

            <p className="family-panel-note">
              Chỉ sử dụng thông tin khi thăm khám.
            </p>

            {/* Phân trang */}
            {(state.data?.total ?? 0) > 20 && (
              <nav
                className="pagination"
                aria-label="Phân trang hồ sơ"
                style={{ marginTop: '16px' }}
              >
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={isSaving || page <= 1}
                  onClick={() => setPage((v) => v - 1)}
                >
                  Trước
                </button>
                <span>Trang {page}</span>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={
                    isSaving ||
                    (state.data?.items.length ?? 0) < 20 ||
                    page * 20 >= (state.data?.total ?? 0)
                  }
                  onClick={() => setPage((v) => v + 1)}
                >
                  Sau
                </button>
              </nav>
            )}
          </aside>

          {/* CỘT PHẢI: Chi tiết & Form chỉnh sửa/tạo mới */}
          <main
            key={selectedId ?? 'creating'}
            className="profile-detail-panel animate-panel-slide"
            aria-label="Chi tiết hồ sơ bệnh nhân"
          >
            <div className="profile-detail-header">
              <div>
                <h2 className="profile-detail-title">
                  {isCreating ? 'Thêm hồ sơ người thân' : 'Thông tin cá nhân'}
                </h2>
                <p className="profile-detail-desc">
                  {isCreating
                    ? 'Khai báo thông tin chính xác của người thân để liên kết đặt khám.'
                    : 'Cập nhật chính xác để được tiếp nhận nhanh hơn.'}
                </p>
              </div>

              {!isCreating && activeProfile && (
                <span className="profile-badge">
                  {activeProfile.relation === 'SELF'
                    ? 'Hồ sơ mặc định'
                    : 'Hồ sơ người thân'}
                </span>
              )}
            </div>

            {formError != null && <ErrorPanel error={formError} />}

            {saveSuccess && (
              <div
                className="profile-save-success"
                role="status"
                style={{ marginBottom: '16px' }}
              >
                ✓ {saveSuccess}
              </div>
            )}

            <form onSubmit={handleSave} noValidate>
              <div className="profile-form-grid">
                <div className="profile-form-field">
                  <label htmlFor="pf-fullname">
                    Họ và tên <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    id="pf-fullname"
                    type="text"
                    required
                    placeholder="Nguyễn Văn A"
                    value={formData.fullName}
                    onChange={(e) =>
                      setFormData({ ...formData, fullName: e.target.value })
                    }
                  />
                </div>

                <div className="profile-form-field">
                  <label htmlFor="pf-birthdate">
                    Ngày sinh <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    id="pf-birthdate"
                    type="date"
                    required
                    value={formData.birthDate}
                    onChange={(e) =>
                      setFormData({ ...formData, birthDate: e.target.value })
                    }
                  />
                </div>

                <div className="profile-form-field">
                  <label htmlFor="pf-gender">Giới tính</label>
                  <select
                    id="pf-gender"
                    value={formData.sex}
                    onChange={(e) =>
                      setFormData({ ...formData, sex: e.target.value })
                    }
                  >
                    <option value="">-- Chưa chọn --</option>
                    <option value="Nam">Nam</option>
                    <option value="Nữ">Nữ</option>
                    <option value="Khác">Khác</option>
                  </select>
                </div>

                <div className="profile-form-field">
                  <label htmlFor="pf-relation">Quan hệ</label>
                  <select
                    id="pf-relation"
                    value={formData.relation}
                    disabled={!isCreating}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        relation: e.target.value as 'SELF' | 'OTHER',
                      })
                    }
                  >
                    <option value="SELF">Bản thân</option>
                    <option value="OTHER">Người thân</option>
                  </select>
                </div>

                <div className="profile-form-field">
                  <label htmlFor="pf-phone">Số điện thoại liên hệ</label>
                  <input
                    id="pf-phone"
                    type="tel"
                    placeholder="0912 345 678"
                    value={formData.contactPhone}
                    onChange={(e) =>
                      setFormData({ ...formData, contactPhone: e.target.value })
                    }
                  />
                </div>

                <div className="profile-form-field">
                  <label htmlFor="pf-bhyt">Mã thẻ BHYT (tự khai)</label>
                  <input
                    id="pf-bhyt"
                    type="text"
                    placeholder="DN 4 79 1234567890"
                    value={formData.bhytSelfDeclared}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        bhytSelfDeclared: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="profile-form-field is-full">
                  <label htmlFor="pf-address">Địa chỉ liên hệ</label>
                  <input
                    id="pf-address"
                    type="text"
                    placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="profile-form-actions">
                {isCreating && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      setIsCreating(false);
                      if (state.data?.items.length) {
                        setSelectedId(state.data.items[0].id);
                      }
                    }}
                  >
                    Hủy bỏ
                  </button>
                )}

                <button
                  type="submit"
                  className="save-profile-btn"
                  disabled={isSaving}
                >
                  {isSaving
                    ? 'Đang lưu…'
                    : isCreating
                      ? 'Tạo hồ sơ người thân'
                      : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </main>
        </div>
      )}
    </section>
  );
}
