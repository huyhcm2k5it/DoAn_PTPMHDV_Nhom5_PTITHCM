from datetime import timedelta

from django.utils import timezone

from app.domain.models import Charge, ChargeSource, SettlementSaga


def create_charge(*, patient_id, source_type, source_id, **fields):
    source, _ = ChargeSource.objects.get_or_create(
        source_type=source_type, source_id=source_id, defaults={"patient_id": patient_id},
    )
    return Charge.objects.create(source=source, **fields)


def create_saga(charge, **fields):
    saga = SettlementSaga.objects.create(
        charge=charge, deadline_at=timezone.now() + timedelta(seconds=60), **fields,
    )
    charge.settlement_saga = saga
    charge.save(update_fields=["settlement_saga"])
    return saga
