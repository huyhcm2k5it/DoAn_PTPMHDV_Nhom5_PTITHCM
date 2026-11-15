from django.db import migrations, models


ACTORS = ("PATIENT", "DOCTOR", "STAFF")


def validate_existing_actors(apps, schema_editor):
    User = apps.get_model("app", "User")
    invalid = list(
        User.objects.using(schema_editor.connection.alias)
        .exclude(actor_type__in=ACTORS).order_by("pk").values_list("pk", flat=True)[:20]
    )
    if invalid:
        raise RuntimeError(f"Identity 3NF migration: invalid actor_type for users {invalid}")


class Migration(migrations.Migration):
    dependencies = [("app", "0007_otprequest_email_user_email")]
    operations = [
        migrations.RunPython(validate_existing_actors, migrations.RunPython.noop),
        migrations.AddConstraint(
            "user", models.CheckConstraint(
                condition=models.Q(actor_type__in=ACTORS), name="chk_identity_user_actor_type",
            ),
        ),
    ]
