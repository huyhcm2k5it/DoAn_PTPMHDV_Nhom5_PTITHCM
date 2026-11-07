CREATE TABLE catalog_stream_state(
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    sequence bigint NOT NULL DEFAULT 0 CHECK(sequence>=0),
    highest_observed bigint NOT NULL DEFAULT 0 CHECK(highest_observed>=0),
    checkpoint_at timestamptz,
    CHECK(highest_observed>=sequence)
);
INSERT INTO catalog_stream_state(singleton) VALUES(true);
