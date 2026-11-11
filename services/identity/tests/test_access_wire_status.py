from django.test import TestCase
from app.domain.models import User
from app.application.access_events import publish_access, export_snapshot


class AccessWireStatusTests(TestCase):
    def test_pending_account_emits_canonical_unverified_without_changing_database_state(self):
        user = User.objects.create(phone="0001122334", actor_type="PATIENT", status="PENDING_VERIFICATION")
        event = publish_access(user)
        self.assertEqual(event["payload"]["status"], "UNVERIFIED")
        self.assertFalse(event["payload"]["phoneVerified"])
        user.refresh_from_db()
        self.assertEqual(user.status, "PENDING_VERIFICATION")
        snapshot = next(row for row in export_snapshot() if row["userId"] == str(user.id))
        self.assertEqual(snapshot["status"], "UNVERIFIED")

    def test_canonical_active_locked_and_blocked_states_are_preserved(self):
        for index, status in enumerate(["ACTIVE", "LOCKED", "BLOCKED"]):
            user = User.objects.create(phone="000112234" + str(index), actor_type="PATIENT", status=status)
            self.assertEqual(publish_access(user)["payload"]["status"], status)
