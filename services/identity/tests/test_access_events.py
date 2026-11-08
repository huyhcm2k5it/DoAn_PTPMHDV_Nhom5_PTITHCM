import uuid
from django.test import TestCase
from django.db import transaction
from app.domain.models import User, IdentityOutbox
from app.application.access_events import publish_access


class AccessOutboxTests(TestCase):
    def test_access_is_minimal_versioned_and_rolls_back_with_owner(self):
        user = User.objects.create(phone="0900090909",status="ACTIVE")
        event = publish_access(user)
        self.assertEqual(event["messageType"], "IdentityAccessChanged")
        self.assertNotIn("phone", event["payload"])
        self.assertEqual(IdentityOutbox.objects.count(), 1)
        try:
            with transaction.atomic():
                user.status="BLOCKED"
                user.save(update_fields=["status"])
                publish_access(user)
                raise RuntimeError("transaction abort")
        except RuntimeError:
            pass
        user.refresh_from_db()
        self.assertEqual(user.status,"ACTIVE")
        self.assertEqual(IdentityOutbox.objects.count(),1)
