import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from './ClinicalUI';

/** Keep unfinished writes in their originating workspace until resolved. */
export function LeaveGuard({
  active,
  pending = false,
}: {
  active: boolean;
  pending?: boolean;
}) {
  const [destination, setDestination] = useState('');
  const leaving = useRef(false);
  useEffect(() => {
    if (!active) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element).closest?.(
        'a[href]',
      ) as HTMLAnchorElement | null;
      if (
        link &&
        link.target !== '_blank' &&
        !link.hasAttribute('download') &&
        link.href !== window.location.href
      ) {
        event.preventDefault();
        setDestination(link.href);
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, [active]);
  return destination ? (
    <ConfirmDialog
      title="Rời màn hình đang làm?"
      confirmDisabled={pending}
      onClose={() => setDestination('')}
      onConfirm={() => {
        leaving.current = true;
        window.location.assign(destination);
      }}
    >
      <p>
        {pending
          ? 'Yêu cầu đang được xử lý hoặc chưa xác định kết quả. Hãy quay lại và thử lại cùng yêu cầu trước khi rời màn hình.'
          : 'Nội dung chưa lưu sẽ bị bỏ. Chọn quay lại để lưu nháp trước.'}
      </p>
    </ConfirmDialog>
  ) : null;
}
