-- ADR-0017, amendment of 2026-11-17: a guest's last_visit_at is never later than now. Before it, a booking
-- for a future date, cancelled or not, set it to that date, which kept the guest out of retention until then.
UPDATE "guests" SET "last_visit_at" = now() WHERE "last_visit_at" > now();
