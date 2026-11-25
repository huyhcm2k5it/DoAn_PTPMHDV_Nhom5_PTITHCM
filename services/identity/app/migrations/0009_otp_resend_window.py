from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("app", "0008_user_actor_type_check")]
    operations = [
        migrations.AddField(
            model_name="otprequest", name="is_resend",
            field=models.BooleanField(default=True),
        ),
        migrations.AddIndex(
            model_name="otprequest",
            index=models.Index(
                fields=["phone", "purpose", "created_at"],
                name="idx_otp_send_window",
            ),
        ),
    ]
