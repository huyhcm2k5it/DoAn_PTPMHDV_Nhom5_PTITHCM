import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app", "0002_billing_event_outbox"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="charge",
            index=models.Index(
                fields=["patient_id", "created_at"], name="idx_charges_patient_created"
            ),
        ),
        migrations.AddIndex(
            model_name="charge",
            index=models.Index(
                fields=["state", "created_at"], name="idx_charges_state_created"
            ),
        ),
        migrations.AddIndex(
            model_name="payment",
            index=models.Index(
                fields=["state", "paid_at"], name="idx_payments_state_paid"
            ),
        ),
        migrations.AddIndex(
            model_name="refund",
            index=models.Index(
                fields=["state", "updated_at"], name="idx_refunds_state_updated"
            ),
        ),
        migrations.CreateModel(
            name="IdempotencyRecord",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("scope", models.CharField(help_text="API ID sở hữu khóa, ví dụ BI-004", max_length=40)),
                ("key", models.CharField(max_length=100)),
                ("request_hash", models.CharField(max_length=64)),
                ("response", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "idempotency_records",
                "indexes": [models.Index(fields=["created_at"], name="idx_idem_created")],
                "constraints": [
                    models.UniqueConstraint(fields=("scope", "key"), name="uq_idem_scope_key")
                ],
            },
        ),
        migrations.CreateModel(
            name="BillingAuditEvent",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("action", models.CharField(max_length=60)),
                ("actor_user_id", models.UUIDField(blank=True, null=True)),
                ("target_id", models.UUIDField(blank=True, null=True)),
                ("payload", models.JSONField(default=dict)),
                ("correlation_id", models.CharField(blank=True, max_length=64)),
                ("at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "billing_audit_events",
                "indexes": [
                    models.Index(fields=["action", "at"], name="idx_billing_audit_action_at")
                ],
            },
        ),
    ]
