import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { CatalogApi, ItemType, PriceInput } from "./types";
import { errorMessage } from "./api";
export type PriceChoice = { type: ItemType; id: string; name: string };
function localDate(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function PriceForm({
  api,
  choices,
  onSaved,
}: {
  api: CatalogApi;
  choices: PriceChoice[];
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(() =>
    localDate(new Date(Date.now() + 10 * 60000)),
  );
  const [to, setTo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const busy = useRef(false);
  const intent = useRef({ fingerprint: "", key: "" });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    setError("");
    setSaved("");
    const choice =
      choices.find((c) => `${c.type}:${c.id}` === selected) ??
      (!selected ? choices[0] : undefined);
    const value = Number(amount);
    const start = new Date(from);
    const end = to ? new Date(to) : undefined;
    if (
      !choice ||
      !amount.trim() ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      !Number.isFinite(start.getTime()) ||
      (end && (!Number.isFinite(end.getTime()) || end <= start))
    ) {
      setError(
        "Chọn danh mục hợp lệ; tiền VND là số nguyên không âm trong giới hạn an toàn; thời gian bắt đầu sau ít nhất 5 phút và kết thúc sau bắt đầu.",
      );
      return;
    }
    const input: PriceInput = {
      itemType: choice.type,
      itemId: choice.id,
      amountVnd: value,
      effectiveFrom: start.toISOString(),
      ...(end && { effectiveTo: end.toISOString() }),
    };
    const fingerprint = JSON.stringify(input);
    // An uncertain earlier write must reach the server's replay check even after
    // its original lead time elapsed. New/changed intentions still need >=5min.
    if (
      intent.current.fingerprint !== fingerprint &&
      start.getTime() < Date.now() + 5 * 60000
    ) {
      setError("Phiên bản giá mới phải có hiệu lực sau ít nhất 5 phút.");
      return;
    }
    if (intent.current.fingerprint !== fingerprint)
      intent.current = { fingerprint, key: crypto.randomUUID() };
    busy.current = true;
    setPending(true);
    try {
      const result = await api.createPrice(input, intent.current.key);
      setSaved(
        `Đã tạo phiên bản giá #${result.revision}. Hiệu lực từ ${new Date(result.effectiveFrom).toLocaleString("vi-VN")}.`,
      );
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <form
      className="catalog-price-form"
      aria-label="Tạo phiên bản giá"
      onSubmit={submit}
    >
      <h3>Tạo phiên bản giá</h3>
      <p>
        Giá được lưu thành phiên bản mới. Khoảng hiệu lực cũ được giữ nguyên;
        giá chồng thời gian sẽ bị từ chối.
      </p>
      <fieldset disabled={pending || choices.length === 0}>
        <label>
          Danh mục áp dụng
          <select
            value={
              selected ||
              (choices[0] ? `${choices[0].type}:${choices[0].id}` : "")
            }
            onChange={(e) => setSelected(e.target.value)}
          >
            {choices.map((c) => (
              <option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>
                {c.name} ({c.type})
              </option>
            ))}
          </select>
        </label>
        <label>
          Số tiền (VND)
          <input
            inputMode="numeric"
            type="number"
            step="1"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          Hiệu lực từ
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Hiệu lực đến (không bắt buộc)
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Đang lưu…" : "Tạo phiên bản giá"}
        </button>
      </fieldset>
      {error && (
        <p role="alert">
          {error} Nếu chưa rõ giao dịch đã lưu hay chưa, thử lại nguyên nội dung
          để dùng cùng mã yêu cầu.
        </p>
      )}
      {saved && <p role="status">{saved}</p>}
    </form>
  );
}
