from datetime import timedelta

import django.db.models.deletion
from django.db import migrations, models


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Source = apps.get_model("app", "ChargeSource")
    Charge = apps.get_model("app", "Charge")
    Saga = apps.get_model("app", "SettlementSaga")
    Payment = apps.get_model("app", "Payment")
    Receipt = apps.get_model("app", "Receipt")

    def rows(model):
        return model.objects.using(alias)

    def invalid(kind, identifier):
        raise RuntimeError(f"Billing 3NF migration: {kind} ({identifier})")

    for charge in rows(Charge).iterator():
        key = (charge.source_type, charge.source_id)
        source, _ = rows(Source).get_or_create(
            source_type=key[0], source_id=key[1], defaults={"patient_id": charge.patient_id},
        )
        if source.patient_id != charge.patient_id:
            invalid("conflicting patient for source", key)
        saga_id = charge.legacy_saga_id or charge.settlement_id
        if charge.legacy_saga_id and charge.settlement_id and charge.legacy_saga_id != charge.settlement_id:
            invalid("conflicting current saga references", charge.pk)
        if saga_id:
            if not rows(Saga).filter(pk=saga_id, charge_id=charge.pk).exists():
                invalid("current saga does not belong to charge", charge.pk)
            rows(Charge).filter(pk=charge.pk).update(settlement_saga_id=saga_id)
        elif charge.settlement_state != "NONE" or rows(Saga).filter(
            charge_id=charge.pk, state__in=("REQUESTED", "RESERVED", "IN_DOUBT", "SUCCEEDED"),
        ).exists():
            invalid("missing current saga", charge.pk)

    for saga in rows(Saga).select_related("charge").iterator():
        charge = saga.charge
        if (
            (saga.source_type, saga.source_id, saga.source_revision)
            != (charge.source_type, charge.source_id, charge.source_revision)
            or saga.amount_hash != charge.snapshot_hash
        ):
            invalid("saga source or hash mismatch", saga.pk)
        if saga.deadline_at is None:
            rows(Saga).filter(pk=saga.pk).update(deadline_at=saga.created_at + timedelta(seconds=60))
        if saga.state in ("REQUESTED", "RESERVED", "IN_DOUBT", "SUCCEEDED") and charge.settlement_saga_id != saga.pk:
            invalid("active or successful saga is not current", saga.pk)

    for payment in rows(Payment).select_related("charge").iterator():
        if (payment.amount_vnd, payment.source_revision) != (
            payment.charge.amount_vnd, payment.charge.source_revision
        ):
            invalid("payment amount or source revision mismatch", payment.pk)
        saga_id = payment.saga_id or payment.settlement_id
        if payment.saga_id and payment.settlement_id and payment.saga_id != payment.settlement_id:
            invalid("conflicting payment saga references", payment.pk)
        if not saga_id or not rows(Saga).filter(pk=saga_id, charge_id=payment.charge_id).exists():
            invalid("cannot resolve payment saga for charge", payment.pk)
        if payment.saga_id is None:
            rows(Payment).filter(pk=payment.pk).update(saga_id=saga_id)

    for saga in rows(Saga).iterator():
        if rows(Payment).filter(saga_id=saga.pk).count() != 1:
            invalid("saga must have exactly one payment", saga.pk)

    duplicate = (
        rows(Payment).filter(state="SUCCEEDED").values("charge_id")
        .annotate(total=models.Count("pk")).filter(total__gt=1).order_by("charge_id").first()
    )
    if duplicate:
        invalid("multiple successful payments for charge", duplicate["charge_id"])
    duplicate = (
        rows(Receipt).values("charge_id").annotate(total=models.Count("pk"))
        .filter(total__gt=1).order_by("charge_id").first()
    )
    if duplicate:
        invalid("multiple receipts for charge", duplicate["charge_id"])
    for receipt in rows(Receipt).select_related("payment").iterator():
        if (
            receipt.charge_id != receipt.payment.charge_id
            or receipt.payment.state != "SUCCEEDED"
            or receipt.amount_vnd != receipt.payment.amount_vnd
        ):
            invalid("receipt does not match successful payment", receipt.pk)


class Migration(migrations.Migration):
    dependencies = [("app", "0005_billingdeadletter_billingretryjob")]
    operations = [
        migrations.CreateModel(
            name="ChargeSource",
            fields=[
                ("pk", models.CompositePrimaryKey(
                    "source_type", "source_id", blank=True, editable=False, primary_key=True, serialize=False,
                )),
                ("source_type", models.CharField(max_length=50)),
                ("source_id", models.UUIDField()),
                ("patient_id", models.UUIDField(db_index=True)),
            ],
            options={"db_table": "charge_sources"},
        ),
        migrations.RenameField("charge", "settlement_saga_id", "legacy_saga_id"),
        migrations.AddField(
            "charge", "settlement_saga",
            models.ForeignKey(
                to="app.settlementsaga", on_delete=django.db.models.deletion.SET_NULL,
                null=True, blank=True, related_name="+",
            ),
        ),
        migrations.RunPython(backfill),
    ]
