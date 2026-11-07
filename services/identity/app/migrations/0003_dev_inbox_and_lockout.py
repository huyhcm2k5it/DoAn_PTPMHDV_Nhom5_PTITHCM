import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app", "0002_seed_demo_users"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="failed_login_attempts",
            field=models.PositiveIntegerField(
                default=0, help_text="Số lần đăng nhập sai liên tiếp"
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="locked_until",
            field=models.DateTimeField(
                blank=True, help_text="Khoá tạm đăng nhập tới thời điểm này", null=True
            ),
        ),
        migrations.CreateModel(
            name="DevSmsInbox",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("phone", models.CharField(max_length=20)),
                ("purpose", models.CharField(max_length=20)),
                ("body", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "dev_sms_inbox",
                "indexes": [
                    models.Index(fields=["phone", "created_at"], name="idx_dev_sms_phone_created")
                ],
            },
        ),
    ]
