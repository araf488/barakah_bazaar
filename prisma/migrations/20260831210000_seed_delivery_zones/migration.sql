-- Seed the launch delivery pricing.
--
-- Separate from 20260831181500_add_delivery_zones (which is DDL only) because
-- that migration is already applied and its checksum cannot change.
--
-- This is not optional decoration: DeliveryService fails closed, so until these
-- rows exist checkout REFUSES every order rather than shipping free. Tables
-- created by a bare `migrate deploy` are empty, which is why the seed has to be
-- a migration and not a hand-applied script.
--
-- Both statements are ON CONFLICT DO NOTHING on fixed UUIDs, so re-running is a
-- no-op and an environment already seeded by hand is left untouched.
--
-- Placeholder prices. Change them in the admin UI, not here.
--
--   Inside Dhaka city   60 BDT, free above 1500 BDT
--   Greater Dhaka       80 BDT, free above 2000 BDT   (Narayanganj, Gazipur, Manikganj)
--   Chattogram         100 BDT, free above 2500 BDT
--   Rest of Bangladesh 130 BDT (default, never free)

INSERT INTO public.delivery_zones
    ("id", "name_en", "name_bn", "fee_poysha", "free_above_poysha", "is_default", "sort_order", "updated_at")
VALUES
    ('11111111-0000-4000-8000-000000000001', 'Inside Dhaka city',  'ঢাকা শহরের ভিতরে', 6000,  150000, false, 1, now()),
    ('11111111-0000-4000-8000-000000000002', 'Greater Dhaka',      'বৃহত্তর ঢাকা',      8000,  200000, false, 2, now()),
    ('11111111-0000-4000-8000-000000000003', 'Chattogram',         'চট্টগ্রাম',          10000, 250000, false, 3, now()),
    ('11111111-0000-4000-8000-000000000004', 'Rest of Bangladesh', 'বাংলাদেশের বাকি অংশ', 13000, NULL,  true,  9, now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO public.delivery_zone_rules ("id", "zone_id", "division", "district", "unit")
VALUES
    ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'Dhaka', 'Dhaka', NULL),
    ('22222222-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000002', 'Dhaka', 'Narayanganj', NULL),
    ('22222222-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000002', 'Dhaka', 'Gazipur', NULL),
    ('22222222-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000002', 'Dhaka', 'Manikganj', NULL),
    ('22222222-0000-4000-8000-000000000005', '11111111-0000-4000-8000-000000000003', 'Chattogram', 'Chattogram', NULL)
ON CONFLICT ("id") DO NOTHING;
