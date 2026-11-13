import copy
import uuid
from unittest.mock import patch
from django.test import TestCase, RequestFactory
from django.db import OperationalError
from django.utils import timezone
from app.worker.consumer import route_event
from app.api.authz import authenticate, AuthError
from app.domain.models import MessageInbox, Notification

ROUTE = 'identity.identity-access-changed.v1'

class IdentityAccessTests(TestCase):
    def event(self, version=1, **changes):
        user = str(uuid.uuid4())
        payload = dict(userId=user, status='ACTIVE', actorType='PATIENT', capabilities=[],
                       tokenVersion=1, phoneVerified=True, version=version)
        payload.update(changes)
        return dict(messageId=str(uuid.uuid4()), messageKind='EVENT', messageType='IdentityAccessChanged',
                    schemaVersion=1, producer='identity', aggregateId=payload['userId'], aggregateVersion=version,
                    correlationId=str(uuid.uuid4()), causationId=None, requestId=None,
                    occurredAt=timezone.now().isoformat(), payload=payload)

    def test_projection_is_monotonic_idempotent_and_records_stale_delivery(self):
        from app.domain.models import IdentityAccessProjection
        event = self.event(2, tokenVersion=2)
        self.assertEqual(route_event(ROUTE, event), 'APPLIED')
        self.assertEqual(route_event(ROUTE, event), 'REPLAYED')
        stale = self.event(1, userId=event['aggregateId'])
        self.assertEqual(route_event(ROUTE, stale), 'STALE')
        row = IdentityAccessProjection.objects.get(user_id=event['aggregateId'])
        self.assertEqual((row.version, row.token_version), (2, 2))
        self.assertEqual(MessageInbox.objects.count(), 2)
        self.assertEqual(Notification.objects.count(), 0)

    def test_message_and_equal_version_conflicts_rollback(self):
        event = self.event()
        route_event(ROUTE, event)
        changed = copy.deepcopy(event)
        changed['payload']['status'] = 'BLOCKED'
        with self.assertRaises(ValueError):
            route_event(ROUTE, changed)
        changed['messageId'] = str(uuid.uuid4())
        with self.assertRaises(ValueError):
            route_event(ROUTE, changed)
        self.assertEqual(MessageInbox.objects.count(), 1)

    def test_untrusted_or_invalid_identity_event_has_no_effect(self):
        mutations = [('producer', 'billing'), ('aggregateId', str(uuid.uuid4())),
                     ('aggregateVersion', True), ('messageId', 123)]
        for key, value in mutations:
            event = self.event()
            event[key] = value
            with self.assertRaises(ValueError):
                route_event(ROUTE, event)
        for key, value in [('tokenVersion', True), ('status', 'UNKNOWN'), ('version', 0),
                           ('phoneVerified', 'true'), ('capabilities', [1]), ('userId', 123)]:
            event = self.event()
            event['payload'][key] = value
            with self.assertRaises(ValueError):
                route_event(ROUTE, event)
        self.assertFalse(MessageInbox.objects.exists())

    def authenticate_claims(self, event, **changes):
        claims = dict(sub=event['aggregateId'], actorType='PATIENT', tokenVersion=1, capabilities=[])
        claims.update(changes)
        with patch('app.api.authz.jwt.decode', return_value=claims), patch('app.api.authz._public_key', return_value='test'):
            return authenticate(RequestFactory().get('/', HTTP_AUTHORIZATION='Bearer test'))

    def test_authentication_fails_closed_until_projection_and_rejects_revoked_access(self):
        event = self.event()
        with self.assertRaises(AuthError) as failure:
            self.authenticate_claims(event)
        self.assertEqual(failure.exception.status, 503)
        route_event(ROUTE, event)
        self.assertEqual(self.authenticate_claims(event).user_id, event['aggregateId'])
        for changes in [dict(tokenVersion=0), dict(tokenVersion=True), dict(tokenVersion='1'),
                        dict(tokenVersion=2), dict(actorType='STAFF'), dict(tokenType='LEASE'),
                        dict(action='NO-001')]:
            with self.assertRaises(AuthError):
                self.authenticate_claims(event, **changes)
        blocked = self.event(2, userId=event['aggregateId'], status='BLOCKED', tokenVersion=2)
        route_event(ROUTE, blocked)
        with self.assertRaises(AuthError) as failure:
            self.authenticate_claims(event, tokenVersion=2)
        self.assertEqual(failure.exception.status, 403)

    def test_projection_storage_failure_returns_service_unavailable(self):
        event = self.event()
        with patch('app.domain.models.IdentityAccessProjection.objects.filter', side_effect=OperationalError):
            with self.assertRaises(AuthError) as failure:
                self.authenticate_claims(event)
        self.assertEqual(failure.exception.status, 503)

    def test_worker_binding_contains_identity_access(self):
        from app.worker.event_bus import BINDINGS
        self.assertIn(('umc.events.identity.v1', ROUTE), BINDINGS)

    def test_new_active_token_version_revokes_previous_access_token(self):
        event = self.event()
        route_event(ROUTE, event)
        newer = self.event(2, userId=event['aggregateId'], tokenVersion=2)
        route_event(ROUTE, newer)
        with self.assertRaises(AuthError) as failure:
            self.authenticate_claims(event)
        self.assertEqual(failure.exception.code, 'TOKEN_REVOKED')
        self.assertEqual(self.authenticate_claims(event, tokenVersion=2).token_version, 2)
        decrease = self.event(3, userId=event['aggregateId'], tokenVersion=1)
        with self.assertRaises(ValueError):
            route_event(ROUTE, decrease)
        self.assertFalse(MessageInbox.objects.filter(message_id=decrease['messageId']).exists())

    def test_every_inactive_status_denies_current_token(self):
        for status in ('UNVERIFIED', 'LOCKED', 'BLOCKED'):
            event = self.event(status=status)
            route_event(ROUTE, event)
            with self.assertRaises(AuthError) as failure:
                self.authenticate_claims(event)
            self.assertEqual(failure.exception.status, 403)

    def test_projection_save_failure_rolls_back_inbox_and_projection(self):
        from app.domain.models import IdentityAccessProjection
        event = self.event()
        with patch.object(IdentityAccessProjection, 'save', side_effect=OperationalError):
            with self.assertRaises(OperationalError):
                route_event(ROUTE, event)
        self.assertFalse(MessageInbox.objects.exists())
        self.assertFalse(IdentityAccessProjection.objects.exists())
