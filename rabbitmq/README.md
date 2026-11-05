# RabbitMQ

RabbitMQ is started on the private Compose network and has a health check. Appointment and Patient use the reviewed topology in `definitions.json` on vhost `/umc-care`:

- `umc.commands.appointment.v1` / `billing.request-charge.v1` -> `cmd.billing.v1`.
- `umc.commands.billing.v1` and `umc.commands.clinical.v1` -> `cmd.appointment.v1`.
- Billing/Clinical events -> `evt.appointment.v1`; Identity/Patient/Catalog projections -> dedicated Appointment queues.
- Appointment failures -> durable `dlq.appointment.v1` through `umc.deadletters.appointment.v1`.

The definitions are a handoff proposal, not evidence that Billing has provisioned the exchanges in a shared environment. Hưng must review the names, ACLs, schema versions and service credentials before integration. The local management credential is not passed to application containers; use scoped service users only after the owners agree.
