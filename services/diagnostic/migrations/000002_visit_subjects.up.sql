CREATE TABLE diagnostic_visit_subjects (
    visit_id uuid PRIMARY KEY,
    patient_id uuid NOT NULL
);

ALTER TABLE lab_orders ADD COLUMN visit_id uuid;

-- DISTINCT removes repeated visits for the same patient. If old orders assign
-- one visit to different patients, the primary key fails and the whole upgrade
-- rolls back. The migration must never choose one of those patients silently.
INSERT INTO diagnostic_visit_subjects(visit_id, patient_id)
SELECT DISTINCT (body->'order'->>'visitId')::uuid,
                (body->'order'->>'patientId')::uuid
FROM lab_orders;

UPDATE lab_orders
SET visit_id = (body->'order'->>'visitId')::uuid,
    body = body #- '{order,visitId}' #- '{order,patientId}';

ALTER TABLE lab_orders
    ALTER COLUMN visit_id SET NOT NULL,
    ADD CONSTRAINT lab_orders_visit_subject_fk
        FOREIGN KEY (visit_id) REFERENCES diagnostic_visit_subjects(visit_id),
    ADD CONSTRAINT lab_orders_subject_outside_body
        CHECK (NOT (body->'order' ?| ARRAY['visitId', 'patientId']));

CREATE INDEX diagnostic_visit_subjects_patient ON diagnostic_visit_subjects(patient_id, visit_id);
CREATE INDEX lab_orders_visit ON lab_orders(visit_id);
