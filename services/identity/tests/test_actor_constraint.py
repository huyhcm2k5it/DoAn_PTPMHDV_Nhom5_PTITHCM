from django.db import IntegrityError, transaction
from django.test import TestCase

from app.domain.models import User


class ActorConstraintTests(TestCase):
    def test_database_rejects_actor_outside_erd(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create(
                phone="0987654321", password_hash="unused", actor_type="UNKNOWN",
            )
