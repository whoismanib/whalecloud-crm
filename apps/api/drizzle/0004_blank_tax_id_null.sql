-- QA-001 follow-up: accounts created before the fix stored a blank RUT as '' instead of NULL,
-- which collides with the partial unique index (country_code, tax_id) WHERE tax_id IS NOT NULL.
UPDATE accounts SET tax_id = NULL WHERE tax_id IS NOT NULL AND btrim(tax_id) = '';
