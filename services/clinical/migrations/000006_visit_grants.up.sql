ALTER TABLE ticket_projection DROP CONSTRAINT ticket_projection_state_check;
ALTER TABLE ticket_projection ADD CONSTRAINT ticket_projection_state_check
    CHECK (state IN ('WAITING','CALLED','CLAIMED','IN_SERVICE','NO_SHOW','DONE'));

CREATE TABLE visit_grant_stream (
    singleton boolean PRIMARY KEY CHECK (singleton),
    sequence bigint NOT NULL CHECK (sequence >= 0)
);
INSERT INTO visit_grant_stream(singleton, sequence) VALUES (true, 0);

CREATE TABLE visit_doctor_grants (
    visit_id uuid PRIMARY KEY REFERENCES visits(id),
    active boolean NOT NULL
);
