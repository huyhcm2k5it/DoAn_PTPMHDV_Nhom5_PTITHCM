"""Tiện ích truy vấn dùng chung cho các API đọc của Billing.

Gom một chỗ để biên ngày `from`/`to` chỉ được định nghĩa một lần: 02_ThamSo quy
định `from` bao gồm mốc, `to` loại trừ mốc; kỳ báo cáo tính theo ngày Việt Nam.
"""

from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.utils.dateparse import parse_date

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def vn_day_window(date_value):
    """Đầu ngày theo giờ Việt Nam, quy về datetime có múi giờ để so với cột UTC."""
    return datetime.combine(date_value, time.min, tzinfo=VN_TZ)


def parse_date_param(raw):
    """Trả (date, None) khi hợp lệ, (None, "invalid") khi sai, (None, None) khi bỏ trống.

    django.utils.dateparse.parse_date ném ValueError với ngày vô lý (ví dụ tháng 13)
    chứ không trả None, nên phải bọc lại để tránh 500.
    """
    if not raw:
        return None, None
    try:
        parsed = parse_date(raw)
    except ValueError:
        return None, "invalid"
    if parsed is None:
        return None, "invalid"
    return parsed, None
