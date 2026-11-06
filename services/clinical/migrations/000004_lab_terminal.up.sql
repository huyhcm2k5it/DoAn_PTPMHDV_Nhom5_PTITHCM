CREATE TABLE lab_terminal_projection (
 request_id uuid PRIMARY KEY REFERENCES lab_requests(request_id),
 visit_id uuid NOT NULL REFERENCES visits(id),
 order_id uuid NOT NULL UNIQUE,
 state text NOT NULL CHECK (state IN ('PUBLISHED','CANCELLED')),
 semantic_hash text NOT NULL,
 revision integer,
 published_at timestamptz,
 CHECK ((state='PUBLISHED' AND revision IS NOT NULL AND revision>0 AND published_at IS NOT NULL) OR
        (state='CANCELLED' AND revision IS NULL AND published_at IS NULL))
);
