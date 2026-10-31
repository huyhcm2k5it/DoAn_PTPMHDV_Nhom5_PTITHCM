# RabbitMQ

RabbitMQ is started on the private Compose network and has a health check. Appointment week 2 proposes the reviewed topology in `definitions.json`:

- `umc.commands.appointment.v1` / `billing.request-charge.v1` -> `cmd.billing.v1`.
- `umc.events.billing.v1` / explicit Billing event keys -> `evt.appointment.v1`.

The definitions are a handoff proposal, not evidence that Billing has provisioned the exchanges in a shared environment. Hưng must review the names, ACLs, schema versions and service credentials before integration. The local management credential is not passed to application containers; use scoped service users only after the owners agree.
