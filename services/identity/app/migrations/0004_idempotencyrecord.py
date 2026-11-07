import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app", "0003_dev_inbox_and_lockout"),
    ]

    operations = [
        migrations.CreateModel(
            name="IdempotencyRecord",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("scope", models.CharField(help_text="API ID sở hữu khóa, ví dụ IA-012", max_length=40)),
                ("key", models.CharField(max_length=100)),
                ("request_hash", models.CharField(max_length=64)),
                ("response", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "idempotency_records",
                "indexes": [models.Index(fields=["created_at"], name="idx_identity_idem_created")],
                "constraints": [
                    models.UniqueConstraint(fields=("scope", "key"), name="uq_identity_idem_scope_key")
                ],
            },
        ),
    ]
