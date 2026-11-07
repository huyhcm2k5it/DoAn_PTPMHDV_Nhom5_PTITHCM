import uuid
from django.db import migrations, models

class Migration(migrations.Migration):
    initial = True
    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Notification",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("user_id", models.UUIDField(help_text="LREF sang Identity users.id")),
                ("kind", models.CharField(default="SYSTEM", max_length=40)),
                ("title", models.CharField(max_length=200)),
                ("body", models.TextField(blank=True)),
                ("payload", models.JSONField(blank=True, default=dict)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "notifications",
                "indexes": [
                    models.Index(fields=["user_id", "created_at"], name="idx_notif_user_created"),
                    models.Index(fields=["user_id", "read_at"], name="idx_notif_user_unread"),
                ],
            },
        ),
    ]
