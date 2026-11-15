import django.db.models.deletion
from django.db import migrations, models


def add_source_fk(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute(
            "ALTER TABLE charges ADD CONSTRAINT fk_charges_source "
            "FOREIGN KEY (source_type, source_id) REFERENCES charge_sources (source_type, source_id)"
        )


def remove_source_fk(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute("ALTER TABLE charges DROP CONSTRAINT fk_charges_source")


class Migration(migrations.Migration):
    dependencies = [("app", "0006_backfill_3nf")]
    operations = [
        migrations.RemoveIndex("charge", "idx_charges_patient_created"),
        migrations.RemoveField("charge", "patient_id"),
        migrations.RemoveField("charge", "settlement_id"),
        migrations.RemoveField("charge", "settlement_state"),
        migrations.RemoveField("charge", "legacy_saga_id"),
        migrations.RemoveField("settlementsaga", "source_type"),
        migrations.RemoveField("settlementsaga", "source_id"),
        migrations.RemoveField("settlementsaga", "source_revision"),
        migrations.RemoveField("settlementsaga", "amount_hash"),
        migrations.AlterField("settlementsaga", "deadline_at", models.DateTimeField()),
        migrations.RemoveField("payment", "amount_vnd"),
        migrations.RemoveField("payment", "source_revision"),
        migrations.RemoveField("payment", "settlement_id"),
        migrations.AlterField(
            "payment", "saga",
            models.OneToOneField(
                to="app.settlementsaga", on_delete=django.db.models.deletion.CASCADE,
                related_name="payment",
            ),
        ),
        migrations.AddConstraint(
            "payment", models.UniqueConstraint(
                fields=("charge",), condition=models.Q(state="SUCCEEDED"),
                name="uq_billing_successful_payment",
            ),
        ),
        migrations.AlterField(
            "receipt", "charge",
            models.OneToOneField(
                to="app.charge", on_delete=django.db.models.deletion.CASCADE, related_name="receipt",
            ),
        ),
        migrations.AddField(
            "charge", "source",
            models.ForeignObject(
                to="app.chargesource", on_delete=django.db.models.deletion.PROTECT,
                from_fields=("source_type", "source_id"), to_fields=("source_type", "source_id"),
                related_name="charges",
            ),
        ),
        migrations.RunPython(add_source_fk, remove_source_fk),
    ]
