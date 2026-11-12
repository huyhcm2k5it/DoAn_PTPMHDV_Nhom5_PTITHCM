DROP TABLE visit_doctor_grants;
DROP TABLE visit_grant_stream;
UPDATE ticket_projection SET state='CLAIMED' WHERE state='IN_SERVICE';
ALTER TABLE ticket_projection DROP CONSTRAINT ticket_projection_state_check;
ALTER TABLE ticket_projection ADD CONSTRAINT ticket_projection_state_check
    CHECK (state IN ('WAITING','CALLED','CLAIMED','NO_SHOW','DONE'));
