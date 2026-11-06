import uuid
from django.db import migrations
from django.contrib.auth.hashers import make_password

def seed_demo_users(apps, schema_editor):
    User = apps.get_model("app", "User")
    StaffCapability = apps.get_model("app", "StaffCapability")

    # 1. Bệnh nhân PATIENT
    patient, _ = User.objects.get_or_create(
        id=uuid.UUID("00000000-0000-4000-8000-000000000801"),
        defaults={
            "phone": "0901234567",
            "password_hash": make_password("password123"),
            "actor_type": "PATIENT",
            "status": "ACTIVE",
            "token_version": 1,
            "version": 1,
            "access_version": 1
        }
    )

    # 2. Bác sĩ DOCTOR
    doctor, _ = User.objects.get_or_create(
        id=uuid.UUID("00000000-0000-4000-8000-000000000911"),
        defaults={
            "phone": "0909999911",
            "password_hash": make_password("password123"),
            "actor_type": "DOCTOR",
            "status": "ACTIVE",
            "token_version": 1,
            "version": 1,
            "access_version": 1
        }
    )

    # 3. Nhân viên quản trị STAFF ADMIN
    staff, created = User.objects.get_or_create(
        id=uuid.UUID("00000000-0000-4000-8000-000000000901"),
        defaults={
            "phone": "0909999901",
            "password_hash": make_password("password123"),
            "actor_type": "STAFF",
            "status": "ACTIVE",
            "token_version": 1,
            "version": 1,
            "access_version": 1
        }
    )

    for cap_name in ["ADMIN", "RECEPTION", "CASHIER"]:
        StaffCapability.objects.get_or_create(
            user=staff,
            capability=cap_name,
            scope_key="GLOBAL",
            defaults={"enabled": True}
        )

def unseed_demo_users(apps, schema_editor):
    pass

class Migration(migrations.Migration):

    dependencies = [
        ("app", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_demo_users, unseed_demo_users),
    ]
