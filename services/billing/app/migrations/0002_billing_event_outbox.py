import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="BillingEventOutbox",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("event_type", models.CharField(max_length=100)),
                ("exchange", models.CharField(max_length=200)),
                ("routing_key", models.CharField(max_length=200)),
                ("payload", models.JSONField()),
                ("attempts", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("published_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={
                "db_table": "billing_event_outbox",
                "indexes": [
                    models.Index(fields=["published_at", "created_at"], name="billing_ev_publis_54e247_idx"),
                ],
            },
        ),
    ]
