-- Reversal intentionally fails while revisioned replacement evidence exists.
ALTER TABLE lab_requests DROP CONSTRAINT lab_requests_state_check;
ALTER TABLE lab_requests ADD CONSTRAINT lab_requests_state_check CHECK(state IN ('PENDING','CREATED','REJECTED','PUBLISHED','CANCELLED'));
