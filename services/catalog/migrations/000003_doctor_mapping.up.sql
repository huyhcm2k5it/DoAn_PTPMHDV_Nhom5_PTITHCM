ALTER TABLE doctors ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
CREATE TABLE doctor_mapping_audit (
    message_id uuid PRIMARY KEY,
    doctor_id uuid NOT NULL REFERENCES doctors(id),
    previous_identity_user_id uuid NOT NULL,
    identity_user_id uuid NOT NULL,
    revision integer NOT NULL CHECK (revision > 1),
    stream_sequence bigint NOT NULL,
    operator_name text NOT NULL,
    reason text NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(doctor_id, revision)
);
