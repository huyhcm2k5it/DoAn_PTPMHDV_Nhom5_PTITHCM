import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("notification_app", "0003_identity_access_projection")]
    operations = [
        # Preserve original IDs, read timestamps and replay fingerprints without inventing event links.
        migrations.RenameModel("Notification", "LegacyNotification"),
        migrations.AlterModelTable("legacynotification", "legacy_notifications"),
        migrations.RenameModel("MessageInbox", "LegacyMessageInbox"),
        migrations.AlterModelTable("legacymessageinbox", "legacy_notification_inbox"),
        migrations.CreateModel(
            name="ReceivedMessage",
            fields=[
                ("message_id", models.UUIDField(primary_key=True, serialize=False)),
                ("command_id", models.UUIDField(null=True)),
                ("payload_hash", models.CharField(max_length=64)),
                ("source_aggregate_id", models.UUIDField()),
                ("source_version", models.PositiveBigIntegerField()),
            ],
            options={"db_table": "received_messages"},
        ),
        migrations.CreateModel(
            name="MessageInbox",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("consumer_name", models.CharField(max_length=48)),
                ("state", models.CharField(default="PROCESSED", max_length=20)),
                ("outcome_ref", models.CharField(max_length=80, null=True)),
                ("processed_at", models.DateTimeField(auto_now_add=True)),
                ("message", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT, to="notification_app.receivedmessage",
                )),
            ],
            options={
                "db_table": "inbox",
                "constraints": [models.UniqueConstraint(
                    fields=("message", "consumer_name"), name="uq_notif_consumer_message",
                )],
            },
        ),
        migrations.CreateModel(
            name="Notification",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("recipient_user_id", models.UUIDField()),
                ("kind", models.CharField(max_length=40)),
                ("subject_ref", models.CharField(max_length=80)),
                ("message_code", models.CharField(max_length=48)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("event", models.OneToOneField(
                    on_delete=django.db.models.deletion.PROTECT, to="notification_app.receivedmessage",
                )),
            ],
            options={
                "db_table": "notifications",
                "indexes": [models.Index(
                    fields=["recipient_user_id", "-created_at"], name="idx_notif_recipient_created",
                )],
            },
        ),
        migrations.CreateModel(
            name="NotificationDeliveryKey",
            fields=[("key", models.CharField(max_length=64, primary_key=True, serialize=False))],
            options={"db_table": "notification_delivery_keys"},
        ),
    ]
